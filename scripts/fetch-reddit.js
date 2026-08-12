import 'dotenv/config';
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

async function runActor(input) {
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(4 * 60 * 1000), // scraper runs can take a few minutes
  });
  if (!res.ok) {
    throw new Error(`Apify actor run failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function itemToRow(item) {
  const isComment = (item.dataType ?? '').toLowerCase() === 'comment' || Boolean(item.parentId);
  const title = item.title ? decodeHtmlEntities(item.title) : '';
  const body = item.body ? decodeHtmlEntities(item.body) : '';
  const text = isComment ? body : `${title}\n\n${body}`.trim();
  const productId = matchProduct(text);
  if (!productId) return null;

  const subreddit = (item.communityName ?? 'unknown').replace(/^r\//, '');
  const kind = isComment ? 'comment' : 'post';

  return {
    source: 'reddit',
    platform: `reddit:r/${subreddit}`,
    url: item.url,
    external_id: `${kind}_${item.id}`,
    dedup_key: redditDedupKey(`${kind}_${item.id}`),
    product_id: productId,
    title: isComment ? null : title || null,
    author_handle: item.username ?? null,
    raw_text: truncate(text),
    published_at: item.createdAt ? new Date(item.createdAt).toISOString() : null,
  };
}

// Sitewide keyword search across all of Reddit, posts only — same role as
// the old /search?type=link call.
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
  return items.map(itemToRow).filter(Boolean);
}

// Scoped scan of the disease-specific subreddits where actual patient/doctor
// discussion of these tests lives, including comments — same role as the old
// scanTargetSubreddits().
async function fetchSubredditRows() {
  const items = await runActor({
    startUrls: TARGET_SUBREDDITS.map((sub) => ({ url: `https://www.reddit.com/r/${sub}/new/` })),
    maxPostCount: 100,
    maxComments: 25,
    skipComments: false,
    includeNSFW: false,
  });
  return items.map(itemToRow).filter(Boolean);
}

async function main() {
  if (!APIFY_TOKEN) {
    throw new Error('APIFY_API_TOKEN must be set');
  }

  const supabase = getServiceClient();

  const [sitewideRows, subredditRows] = await Promise.all([fetchSitewideRows(), fetchSubredditRows()]);
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
