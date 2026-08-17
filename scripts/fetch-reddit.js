import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from './lib/supabase-client.js';
import { redditDedupKey, insertMentionsIgnoringDuplicates } from './lib/dedup.js';
import { PRODUCTS, TARGET_SUBREDDITS } from './lib/products.js';

// Reddit shut down its public .json API in May 2026 and blocks
// unauthenticated access entirely (confirmed 2026-08-11 — both
// www.reddit.com and old.reddit.com redirect to a login wall). Its own
// OAuth script-app registration also requires manual approval for a
// moderation use case this project doesn't have. Apify's trudax/reddit-
// scraper-lite actor automates a real browser to get past that, which is
// why this hits the Apify API instead of Reddit directly.
//
// Mirrors the two-pronged approach the old direct-scraping version used:
// a sitewide keyword search (posts only) plus a scan of disease-specific
// subreddits (posts + their comments, since patient discussion of actual
// test experience tends to live in the comments). The actor can't do both
// in one run — providing startUrls makes it ignore the search params
// entirely — so this makes two separate runs.

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const ACTOR_ID = 'trudax~reddit-scraper-lite';
const RAW_TEXT_CAP = 5000;

function truncate(text) {
  if (!text) return '';
  return text.length > RAW_TEXT_CAP ? `${text.slice(0, RAW_TEXT_CAP)}…` : text;
}

const HTML_ENTITIES = { amp: '&', quot: '"', '#39': "'", apos: "'", lt: '<', gt: '>', nbsp: ' ' };

// The actor's post/comment bodies come through HTML-entity-escaped (e.g.
// "Natera&#39;s Signatera" instead of "Natera's Signatera") rather than as
// plain text — decode so stored raw_text/titles are clean for the
// classifier and trend report.
function decodeHtmlEntities(text) {
  return text.replace(/&(#39|amp|quot|apos|lt|gt|nbsp);/g, (_, entity) => HTML_ENTITIES[entity]);
}

function matchProduct(text) {
  const lower = text.toLowerCase();
  for (const product of PRODUCTS) {
    if (product.searchTerms.some((term) => lower.includes(term.toLowerCase()))) {
      return product.id;
    }
  }
  return null;
}

// These name the diagnostic category, not a specific brand — a post using
// one of them alone can't be attributed to a product by keyword matching.
// Only applied within TARGET_SUBREDDITS (disease-specific, so at least the
// clinical context is relevant), and only after matchProduct() already
// failed to find a brand name — see guessProducts().
const GENERIC_TERMS = [
  'ctdna test',
  'ctdna testing',
  'mrd test',
  'mrd testing',
  'molecular residual disease',
  'liquid biopsy',
  'tumor-informed test',
  'tumor informed test',
  'circulating tumor dna',
];

function matchesGenericTerm(text) {
  const lower = text.toLowerCase();
  return GENERIC_TERMS.some((term) => lower.includes(term));
}

const PRODUCT_GUESS_TOOL = {
  name: 'submit_product_guesses',
  description:
    'Guess which of three ctDNA/MRD diagnostic tests each Reddit post/comment most likely refers to, when the text only uses a generic term instead of naming a specific brand.',
  input_schema: {
    type: 'object',
    properties: {
      guesses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'Index of the item in the input list, copied exactly.' },
            product: { type: 'string', enum: ['signatera', 'guardant360', 'foundationone_liquid', 'unclear'] },
            confidence: {
              type: 'number',
              description:
                '0.00-1.00. Most such posts give no reliable brand signal — default to "unclear" with low confidence rather than guessing, and only score above ~0.5 when the text or context gives a real clue (mentioned company/doctor practice, distinctive phrasing, cancer type strongly associated with one brand).',
            },
          },
          required: ['index', 'product', 'confidence'],
        },
      },
    },
    required: ['guesses'],
  },
};

const PRODUCT_GUESS_SYSTEM = `You help attribute Reddit posts/comments about ctDNA/MRD cancer blood tests to one of three specific commercial products, when the text itself only uses a generic term ("ctDNA test", "MRD test", etc.) rather than naming the brand:
- Signatera (Natera) — dominant in colorectal, breast, and bladder cancer surveillance.
- Guardant360 (Guardant Health) — primarily comprehensive genomic profiling for treatment selection, also used in surveillance.
- FoundationOne Liquid CDx (Foundation Medicine) — primarily comprehensive genomic profiling for treatment selection.

Use whatever weak signals are present (subreddit, cancer type, phrasing, mentioned company/doctor practice, test frequency described), but most such posts genuinely give no reliable signal — default to "unclear" with low confidence rather than guessing. Always call submit_product_guesses with one entry per input item, in the same order given.`;

async function guessProducts(anthropic, candidates) {
  if (candidates.length === 0) return new Map();

  const BATCH_SIZE = 20;
  const results = new Map();

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const payload = batch.map((c, idx) => ({
      index: idx,
      subreddit: c.subreddit,
      title: c.title || null,
      text: c.text.slice(0, 1500),
    }));

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        system: PRODUCT_GUESS_SYSTEM,
        tools: [PRODUCT_GUESS_TOOL],
        tool_choice: { type: 'tool', name: 'submit_product_guesses' },
        messages: [{ role: 'user', content: `Guess the product for these ${payload.length} items:\n\n${JSON.stringify(payload, null, 2)}` }],
      });
      const toolUse = response.content.find((block) => block.type === 'tool_use');
      const guesses = toolUse?.input?.guesses ?? [];
      for (const guess of guesses) {
        const candidate = batch[guess.index];
        if (candidate) results.set(candidate.dedupKey, guess);
      }
    } catch (err) {
      console.error(`Product-guess batch starting at index ${i} failed:`, err.message);
    }
  }

  return results;
}

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000;

// Apify's run-sync-get-dataset-items endpoint 408s past 300 seconds server-side
// (https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post) — the
// widened subreddit caps (100 posts/25 comments x 12 subreddits) routinely run
// longer than that, so this starts the run async and polls instead.
async function runActor(input) {
  const startRes = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!startRes.ok) {
    throw new Error(`Apify actor start failed: ${startRes.status} ${await startRes.text()}`);
  }
  const { data: run } = await startRes.json();

  const deadline = Date.now() + MAX_WAIT_MS;
  let status = run.status;
  let datasetId = run.defaultDatasetId;
  while (status === 'READY' || status === 'RUNNING') {
    if (Date.now() > deadline) {
      throw new Error(`Apify actor run ${run.id} did not finish within ${MAX_WAIT_MS / 1000}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?token=${APIFY_TOKEN}`);
    if (!statusRes.ok) {
      throw new Error(`Apify run status check failed: ${statusRes.status} ${await statusRes.text()}`);
    }
    const { data: current } = await statusRes.json();
    status = current.status;
    datasetId = current.defaultDatasetId;
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify actor run ${run.id} ended with status ${status}`);
  }

  const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`);
  if (!itemsRes.ok) {
    throw new Error(`Apify dataset fetch failed: ${itemsRes.status} ${await itemsRes.text()}`);
  }
  return itemsRes.json();
}

function normalizeItem(item) {
  const isComment = (item.dataType ?? '').toLowerCase() === 'comment' || Boolean(item.parentId);
  const title = item.title ? decodeHtmlEntities(item.title) : '';
  const body = item.body ? decodeHtmlEntities(item.body) : '';
  const text = isComment ? body : `${title}\n\n${body}`.trim();
  const subreddit = (item.communityName ?? 'unknown').replace(/^r\//, '');
  const kind = isComment ? 'comment' : 'post';
  const dedupKey = redditDedupKey(`${kind}_${item.id}`);

  return { item, isComment, title, body, text, subreddit, kind, dedupKey };
}

function buildRow(normalized, productId) {
  const { item, isComment, title, text, subreddit, kind, dedupKey } = normalized;
  return {
    source: 'reddit',
    platform: `reddit:r/${subreddit}`,
    url: item.url,
    external_id: `${kind}_${item.id}`,
    dedup_key: dedupKey,
    product_id: productId,
    title: isComment ? null : title || null,
    author_handle: item.username ?? null,
    raw_text: truncate(text),
    published_at: item.createdAt ? new Date(item.createdAt).toISOString() : null,
  };
}

// Sitewide keyword search across all of Reddit, posts only — same role as
// the old /search?type=link call. Brand-name matches only: without
// subreddit context, a generic "ctDNA test" search would surface too much
// unrelated content sitewide.
async function fetchSitewideRows() {
  const items = await runActor({
    searches: PRODUCTS.flatMap((p) => p.searchTerms),
    searchPosts: true,
    searchComments: false,
    sort: 'new',
    time: 'year', // widened from 'week' — dedup handles repeats across runs, and this project favors full history over rolling windows elsewhere (charts, web discovery)
    maxPostCount: 30,
    skipComments: true,
    includeNSFW: false,
  });
  return items
    .map(normalizeItem)
    .map((n) => {
      const productId = matchProduct(n.text);
      return productId ? buildRow(n, productId) : null;
    })
    .filter(Boolean);
}

// Scoped scan of the disease-specific subreddits where actual patient/doctor
// discussion of these tests lives, including comments — same role as the old
// scanTargetSubreddits(). Brand-name matches are kept as before; items that
// only use a generic term ("ctDNA test", "MRD test", etc.) get a best-effort
// product guess from Claude instead of being dropped, since patients often
// don't name the brand explicitly even when discussing a specific one — the
// subreddit's disease focus at least makes the guess informed. Weak guesses
// get filtered out downstream by product_match_confidence (see
// sql/004_product_match_confidence_filter.sql) rather than trusted outright.
async function fetchSubredditRows(anthropic) {
  const items = await runActor({
    startUrls: TARGET_SUBREDDITS.map((sub) => ({ url: `https://www.reddit.com/r/${sub}/new/` })),
    maxPostCount: 100,
    maxComments: 25,
    skipComments: false,
    includeNSFW: false,
  });

  const normalized = items.map(normalizeItem);
  const brandMatched = [];
  const genericCandidates = [];

  for (const n of normalized) {
    const productId = matchProduct(n.text);
    if (productId) {
      brandMatched.push(buildRow(n, productId));
    } else if (matchesGenericTerm(n.text)) {
      genericCandidates.push(n);
    }
  }

  const productIdBySlug = Object.fromEntries(PRODUCTS.map((p) => [p.slug, p.id]));
  const guesses = await guessProducts(
    anthropic,
    genericCandidates.map((n) => ({ dedupKey: n.dedupKey, subreddit: n.subreddit, title: n.title, text: n.text }))
  );

  const guessedRows = [];
  for (const n of genericCandidates) {
    const guess = guesses.get(n.dedupKey);
    if (!guess || guess.product === 'unclear') continue;
    const productId = productIdBySlug[guess.product];
    if (!productId) continue;
    guessedRows.push(buildRow(n, productId));
  }

  return [...brandMatched, ...guessedRows];
}

async function main() {
  if (!APIFY_TOKEN) {
    throw new Error('APIFY_API_TOKEN must be set');
  }

  const supabase = getServiceClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const [sitewideRows, subredditRows] = await Promise.all([fetchSitewideRows(), fetchSubredditRows(anthropic)]);
  const allRows = [...sitewideRows, ...subredditRows];

  // De-dupe within this run's own batch before hitting the DB (a post can be
  // discovered both via sitewide search and the subreddit scan).
  const seen = new Map();
  for (const row of allRows) seen.set(row.dedup_key, row);
  const uniqueRows = [...seen.values()];

  const insertedCount = await insertMentionsIgnoringDuplicates(supabase, uniqueRows);
  console.log(`Reddit (Apify): found ${uniqueRows.length} candidate mentions, inserted ${insertedCount} new rows.`);
}

main().catch((err) => {
  console.error('fetch-reddit.js failed:', err);
  process.exit(1);
});
