import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from './lib/supabase-client.js';

const MODEL = 'claude-sonnet-5';
const EXCERPT_CAP = 400;

async function fetchWeeklyRollups(supabase) {
  const { data, error } = await supabase
    .from('mention_rollups_weekly')
    .select('week_start, product_id, author_type, mention_count, avg_sentiment_score')
    .order('week_start', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// See sql/004_product_match_confidence_filter.sql — a weak product_match_confidence
// means ingestion's product guess (e.g. from a generic "ctDNA test" mention) is
// shaky, so don't let it anchor a specific product's narrative.
const MIN_PRODUCT_MATCH_CONFIDENCE = 0.5;

async function fetchClassifiedMentions(supabase) {
  const { data, error } = await supabase
    .from('raw_mentions')
    .select('product_id, author_type, sentiment, sentiment_score, author_type_reasoning, raw_text, published_at, discovered_at, source')
    .not('classified_at', 'is', null)
    .gte('product_match_confidence', MIN_PRODUCT_MATCH_CONFIDENCE)
    .order('published_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

function buildPrompt(products, rollups, mentions) {
  const productsById = Object.fromEntries(products.map((p) => [p.id, p.display_name]));

  const rollupLines = rollups
    .map((r) => `${r.week_start} | ${productsById[r.product_id] ?? r.product_id} | ${r.author_type} | mentions=${r.mention_count} | avg_sentiment=${r.avg_sentiment_score ?? 'n/a'}`)
    .join('\n');

  const mentionLines = mentions
    .map((m) => {
      const date = (m.published_at ?? m.discovered_at ?? '').slice(0, 10);
      const excerpt = (m.raw_text ?? '').replace(/\s+/g, ' ').slice(0, EXCERPT_CAP);
      return `[${date}] ${productsById[m.product_id] ?? m.product_id} | ${m.author_type} | ${m.sentiment} (${m.sentiment_score}) | ${m.source} | ${excerpt}`;
    })
    .join('\n');

  return `You are writing a narrative trend report for an internal dashboard tracking public and clinical discussion of three cancer diagnostic tests: Signatera, Guardant360, and FoundationOne Liquid (ctDNA/MRD tests).

Below is (1) weekly aggregated mention counts and average sentiment per product and author type (patient/caregiver vs doctor/healthcare_professional/other), and (2) individual mention excerpts with their classification.

WEEKLY ROLLUPS:
${rollupLines || '(no rollup data yet)'}

MENTION EXCERPTS (chronological):
${mentionLines || '(no classified mentions yet)'}

Write a concise report (4-6 short paragraphs, plain prose, no headers or bullet lists) covering:
1. Consistent/stable trends visible across the data — what stays true over time.
2. Notable recent changes or shifts in volume, sentiment, or the topics being discussed.
3. Specific observations about usage patterns, clinical acceptance/adoption signals, and patient appreciation or frustration with the actual testing experience (cost, result interpretation, anxiety while waiting, whether it changed treatment decisions, etc.) — this is the most important part, be concrete and cite specific examples from the excerpts rather than generic statements.
4. Where patient-voice and doctor-voice perspectives differ, if the data shows that.

Ground every claim in the data given above — do not invent statistics or examples not supported by it. If the data is sparse for a product or time period, say so explicitly rather than overstating confidence. Write for someone who will read this report regularly, so it's fine to be direct and specific rather than hedging everything.`;
}

async function main() {
  const supabase = getServiceClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { data: products, error: productsError } = await supabase.from('products').select('id, display_name').order('id');
  if (productsError) throw productsError;

  const [rollups, mentions] = await Promise.all([fetchWeeklyRollups(supabase), fetchClassifiedMentions(supabase)]);

  if (mentions.length === 0) {
    console.log('No classified mentions yet — skipping report generation.');
    return;
  }

  const prompt = buildPrompt(products ?? [], rollups, mentions);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  const reportText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const { error: insertError } = await supabase.from('trend_reports').insert({ report_text: reportText, model: MODEL });
  if (insertError) throw insertError;

  console.log(`Generated trend report (${reportText.length} chars) from ${mentions.length} mentions.`);
}

main().catch((err) => {
  console.error('generate-trend-report.js failed:', err);
  process.exit(1);
});
