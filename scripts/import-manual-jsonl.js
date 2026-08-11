import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getServiceClient } from './lib/supabase-client.js';
import { normalizeUrl, insertMentionsIgnoringDuplicates } from './lib/dedup.js';
import { PRODUCTS } from './lib/products.js';

// Imports manually-researched mention data (one JSON object per line) that
// didn't come through the automated ingestion scripts — e.g. deep research
// done in a separate session against a source our own scrapers can't reach
// well (paginated forum threads, sites needing JS rendering, etc.).
// Expected fields per line: thread, url, group?, date, author, role, type,
// summary, sentiment? (ignored — reclassified by score-results.js like
// everything else, for one consistent methodology across all sources),
// topics? (ignored).
//
// Usage: node scripts/import-manual-jsonl.js <path-to-file.jsonl>

const RAW_TEXT_CAP = 8000;

function matchProduct(text) {
  const lower = text.toLowerCase();
  for (const product of PRODUCTS) {
    if (product.searchTerms.some((term) => lower.includes(term.toLowerCase()))) {
      return product.id;
    }
  }
  return null;
}

function manualDedupKey(url, indexWithinThread) {
  const normalized = normalizeUrl(url);
  const hash = createHash('sha256').update(`${normalized}#${indexWithinThread}`).digest('hex');
  return `web:${hash}`;
}

function parseDate(raw) {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/import-manual-jsonl.js <path-to-file.jsonl>');
    process.exit(1);
  }

  const lines = readFileSync(filePath, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
  const perThreadIndex = new Map();
  const rows = [];
  let skippedNoProduct = 0;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (err) {
      console.error('Skipping malformed line:', err.message);
      continue;
    }

    const { thread, url, author, role, type, summary, date } = entry;
    const combined = `${thread ?? ''}\n${summary ?? ''}`;
    const productId = matchProduct(combined);
    if (!productId) {
      skippedNoProduct += 1;
      continue;
    }

    const idx = perThreadIndex.get(url) ?? 0;
    perThreadIndex.set(url, idx + 1);

    const normalized = normalizeUrl(url);
    rows.push({
      source: 'web',
      platform: new URL(normalized).hostname,
      url: normalized,
      external_id: `${normalized}#${idx}`,
      dedup_key: manualDedupKey(url, idx),
      product_id: productId,
      title: thread ?? null,
      author_handle: author ?? null,
      raw_text: `[${type ?? 'post'} by ${role ?? 'unknown role'}] ${summary ?? ''}`.slice(0, RAW_TEXT_CAP),
      published_at: parseDate(date),
    });
  }

  const supabase = getServiceClient();
  const insertedCount = await insertMentionsIgnoringDuplicates(supabase, rows);
  console.log(
    `Manual import: ${lines.length} lines, ${rows.length} matched a product (${skippedNoProduct} skipped), ${insertedCount} new rows inserted.`
  );
}

main().catch((err) => {
  console.error('import-manual-jsonl.js failed:', err);
  process.exit(1);
});
