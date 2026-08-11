import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from './lib/supabase-client.js';

const MODEL = 'claude-haiku-4-5';
const RUN_LIMIT = 50;
const BATCH_SIZE = 15;
const MIN_TEXT_LENGTH = 10;

const CLASSIFY_TOOL = {
  name: 'submit_classifications',
  description: 'Submit classifications for a batch of mentions about medical diagnostic tests.',
  input_schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The mention id, copied exactly from the input.' },
            product_match_confidence: {
              type: 'number',
              description: '0.00-1.00: confidence this text is genuinely discussing the named test as a product/device, not incidental (e.g. company financial news, unrelated homonym).',
            },
            author_type: {
              type: 'string',
              enum: ['patient', 'caregiver', 'doctor', 'healthcare_professional', 'other', 'unknown'],
            },
            author_type_confidence: { type: 'number', description: '0.00-1.00' },
            author_type_reasoning: {
              type: 'string',
              description: 'One sentence justifying the author_type call, citing the specific signal used.',
            },
            sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'mixed'] },
            sentiment_score: { type: 'number', description: '-1.00 (very negative) to 1.00 (very positive)' },
          },
          required: [
            'id',
            'product_match_confidence',
            'author_type',
            'author_type_confidence',
            'author_type_reasoning',
            'sentiment',
            'sentiment_score',
          ],
        },
      },
    },
    required: ['classifications'],
  },
};

const SYSTEM_PROMPT = `You classify public mentions of medical diagnostic tests (Signatera, Guardant360, FoundationOne Liquid — ctDNA/MRD cancer tests) for a sentiment-tracking tool. For each mention, determine:

- product_match_confidence: is this genuinely about the test itself, or incidental (PR/investor news, an unrelated use of the same word)?
- author_type, using these signals:
  - doctor / healthcare_professional: byline credentials (MD, DO, NP, PA), "Dr. X, oncologist at Y" attribution, published as expert commentary on a medical-news site (OncLive, Medscape, Healio, Targeted Oncology, Cancer Therapy Advisor), first-person clinical language ("in my practice", "I order this test for patients with...").
  - patient / caregiver: first-person illness narrative, posted in a patient-support subreddit or as a YouTube comment on a patient testimonial video, questions about cost/insurance/side effects/result interpretation from a recipient's or family member's perspective.
  - other: company PR, investor/financial news, generic journalism with no author-type signal.
  - unknown: too little text or no clear signal either way.
- sentiment / sentiment_score toward the specific product mentioned (not toward cancer, treatment, or the healthcare system in general).

Be conservative: when signals are ambiguous, prefer 'unknown' or 'other' over guessing, and reflect that in the confidence scores. Always call the submit_classifications tool with one entry per input mention, in the same order given.`;

async function fetchUnclassifiedBatch(supabase, limit) {
  const { data, error } = await supabase
    .from('raw_mentions')
    .select('id, source, platform, title, raw_text, product_id, products(display_name)')
    .is('classified_at', null)
    .order('discovered_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function classifyBatch(anthropic, rows) {
  const inputPayload = rows.map((row) => ({
    id: row.id,
    product: row.products?.display_name ?? 'unknown',
    source: row.source,
    platform: row.platform,
    title: row.title,
    text: row.raw_text,
  }));

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'submit_classifications' },
    messages: [
      {
        role: 'user',
        content: `Classify these ${inputPayload.length} mentions:\n\n${JSON.stringify(inputPayload, null, 2)}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return a tool_use block');
  return toolUse.input.classifications ?? [];
}

async function writeClassifications(supabase, classifications) {
  const now = new Date().toISOString();
  for (const c of classifications) {
    const { error } = await supabase
      .from('raw_mentions')
      .update({
        product_match_confidence: c.product_match_confidence,
        author_type: c.author_type,
        author_type_confidence: c.author_type_confidence,
        author_type_reasoning: c.author_type_reasoning,
        sentiment: c.sentiment,
        sentiment_score: c.sentiment_score,
        classified_at: now,
        classification_model: MODEL,
      })
      .eq('id', c.id);
    if (error) console.error(`Failed to write classification for ${c.id}:`, error.message);
  }
}

async function markTooShortAsUnknown(supabase, rows) {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const ids = rows.map((r) => r.id);
  const { error } = await supabase
    .from('raw_mentions')
    .update({
      product_match_confidence: 0.5,
      author_type: 'unknown',
      author_type_confidence: 0,
      author_type_reasoning: 'Text too short to classify.',
      sentiment: 'neutral',
      sentiment_score: 0,
      classified_at: now,
      classification_model: 'heuristic:too-short',
    })
    .in('id', ids);
  if (error) console.error('Failed to mark short rows as unknown:', error.message);
}

async function main() {
  const supabase = getServiceClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const rows = await fetchUnclassifiedBatch(supabase, RUN_LIMIT);
  if (rows.length === 0) {
    console.log('No unclassified rows.');
    return;
  }

  const tooShort = rows.filter((r) => (r.raw_text ?? '').length < MIN_TEXT_LENGTH);
  const classifiable = rows.filter((r) => (r.raw_text ?? '').length >= MIN_TEXT_LENGTH);

  await markTooShortAsUnknown(supabase, tooShort);

  let classifiedCount = 0;
  for (let i = 0; i < classifiable.length; i += BATCH_SIZE) {
    const batch = classifiable.slice(i, i + BATCH_SIZE);
    try {
      const classifications = await classifyBatch(anthropic, batch);
      await writeClassifications(supabase, classifications);
      classifiedCount += classifications.length;
    } catch (err) {
      console.error(`Batch starting at index ${i} failed:`, err.message);
    }
  }

  console.log(
    `Classified ${classifiedCount}/${classifiable.length} mentions via LLM, marked ${tooShort.length} too-short rows as unknown.`
  );
}

main().catch((err) => {
  console.error('score-results.js failed:', err);
  process.exit(1);
});
