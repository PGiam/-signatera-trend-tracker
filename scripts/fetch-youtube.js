import 'dotenv/config';
import { getServiceClient } from './lib/supabase-client.js';
import { youtubeDedupKey, insertMentionsIgnoringDuplicates } from './lib/dedup.js';
import { PRODUCTS } from './lib/products.js';

const RAW_TEXT_CAP = 5000;
const API_BASE = 'https://www.googleapis.com/youtube/v3';

function truncate(text) {
  if (!text) return '';
  return text.length > RAW_TEXT_CAP ? `${text.slice(0, RAW_TEXT_CAP)}…` : text;
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

async function youtubeFetch(path, params) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY must be set');
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set('key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`YouTube API error ${res.status} for ${path}: ${await res.text()}`);
  }
  return res.json();
}

// Step 1: discover new videos about the tracked products (100 units/call —
// budget a handful per run). Tracked video IDs are held in the
// `products` table indirectly via re-discovery each run rather than a
// separate persisted "tracked videos" list, keeping this stateless and
// simple: each product's top ~10 relevant videos (by relevance) are
// re-checked for comments every run.
async function discoverVideos(product) {
  const json = await youtubeFetch('/search', {
    q: product.searchTerms[0],
    part: 'snippet',
    type: 'video',
    order: 'relevance',
    maxResults: '10',
  });
  return (json.items ?? []).map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet?.title ?? '',
  }));
}

// Step 2: pull comment threads for a video (~1 unit/call — cheap, main spend).
async function fetchComments(videoId) {
  const rows = [];
  let pageToken;
  do {
    let json;
    try {
      json = await youtubeFetch('/commentThreads', {
        videoId,
        part: 'snippet',
        maxResults: '100',
        order: 'time',
        ...(pageToken ? { pageToken } : {}),
      });
    } catch (err) {
      // Comments can be disabled on a video — not an error worth failing the run over.
      console.error(`Skipping comments for video ${videoId}: ${err.message}`);
      return rows;
    }
    for (const item of json.items ?? []) {
      const top = item.snippet?.topLevelComment?.snippet;
      if (!top) continue;
      const text = top.textOriginal ?? top.textDisplay ?? '';
      const productId = matchProduct(text);
      if (!productId) continue;
      rows.push({
        source: 'youtube',
        platform: 'youtube',
        url: `https://www.youtube.com/watch?v=${videoId}&lc=${item.snippet.topLevelComment.id}`,
        external_id: item.snippet.topLevelComment.id,
        dedup_key: youtubeDedupKey(item.snippet.topLevelComment.id),
        product_id: productId,
        title: null,
        author_handle: top.authorDisplayName ?? null,
        raw_text: truncate(text),
        published_at: top.publishedAt ?? null,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return rows;
}

async function main() {
  const supabase = getServiceClient();
  const allRows = [];

  for (const product of PRODUCTS) {
    let videos = [];
    try {
      videos = await discoverVideos(product);
    } catch (err) {
      console.error(`Video discovery failed for ${product.slug}:`, err.message);
      continue;
    }
    for (const video of videos) {
      const rows = await fetchComments(video.videoId);
      allRows.push(...rows);
    }
  }

  const insertedCount = await insertMentionsIgnoringDuplicates(supabase, allRows);
  console.log(`YouTube: found ${allRows.length} candidate mentions, inserted ${insertedCount} new rows.`);
}

main().catch((err) => {
  console.error('fetch-youtube.js failed:', err);
  process.exit(1);
});
