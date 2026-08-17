import 'dotenv/config';
import { getServiceClient } from './lib/supabase-client.js';

// Recompute the last few days each run (idempotent upsert) rather than
// incrementally accounting — simple, and self-correcting when classification
// lands a bit late on rows discovered a day or two ago.
const LOOKBACK_DAYS = 4;
const FETCH_LIMIT = 5000;

function dayBucket(isoString) {
  return isoString.slice(0, 10); // 'YYYY-MM-DD', UTC
}

function effectiveDate(row) {
  return dayBucket(row.published_at ?? row.discovered_at);
}

// Rows with a weak product_match_confidence (e.g. a generic "ctDNA test"
// mention Reddit ingestion guessed a specific brand for) shouldn't count
// toward that brand's trend numbers — see sql/004_product_match_confidence_filter.sql.
const MIN_PRODUCT_MATCH_CONFIDENCE = 0.5;

async function fetchRecentClassifiedRows(supabase) {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('raw_mentions')
    .select('product_id, author_type, sentiment_score, published_at, discovered_at')
    .not('classified_at', 'is', null)
    .gte('product_match_confidence', MIN_PRODUCT_MATCH_CONFIDENCE)
    .gte('discovered_at', cutoff)
    .limit(FETCH_LIMIT);
  if (error) throw error;
  return data ?? [];
}

function buildRollups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.product_id == null || row.author_type == null) continue;
    const rollupDate = effectiveDate(row);
    const key = `${rollupDate}|${row.product_id}|${row.author_type}`;
    if (!groups.has(key)) {
      groups.set(key, {
        rollup_date: rollupDate,
        product_id: row.product_id,
        author_type: row.author_type,
        mention_count: 0,
        sentiment_sum: 0,
        positive_count: 0,
        neutral_count: 0,
        negative_count: 0,
        mixed_count: 0,
      });
    }
    const g = groups.get(key);
    g.mention_count += 1;
    g.sentiment_sum += row.sentiment_score ?? 0;
    if (row.sentiment && `${row.sentiment}_count` in g) {
      g[`${row.sentiment}_count`] += 1;
    }
  }
  return [...groups.values()].map((g) => ({
    rollup_date: g.rollup_date,
    product_id: g.product_id,
    author_type: g.author_type,
    mention_count: g.mention_count,
    avg_sentiment_score: g.mention_count > 0 ? g.sentiment_sum / g.mention_count : null,
    positive_count: g.positive_count,
    neutral_count: g.neutral_count,
    negative_count: g.negative_count,
    mixed_count: g.mixed_count,
    computed_at: new Date().toISOString(),
  }));
}

async function main() {
  const supabase = getServiceClient();

  const rows = await fetchRecentClassifiedRows(supabase);
  if (rows.length === 0) {
    console.log('No recently classified rows to aggregate.');
    return;
  }

  const rollups = buildRollups(rows);

  const { error } = await supabase
    .from('mention_rollups_daily')
    .upsert(rollups, { onConflict: 'rollup_date,product_id,author_type' });
  if (error) throw error;

  console.log(`Aggregated ${rows.length} mentions into ${rollups.length} daily rollup rows.`);
}

main().catch((err) => {
  console.error('aggregate-trends.js failed:', err);
  process.exit(1);
});
