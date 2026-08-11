import 'dotenv/config';
import { getServiceClient } from './lib/supabase-client.js';
import { redditPublicFetch } from './lib/reddit-fetch.js';
import { redditDedupKey, insertMentionsIgnoringDuplicates } from './lib/dedup.js';
import { PRODUCTS, TARGET_SUBREDDITS } from './lib/products.js';

const RAW_TEXT_CAP = 5000;

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

function postToRow(post) {
  const text = `${post.title ?? ''}\n\n${post.selftext ?? ''}`.trim();
  const productId = matchProduct(text);
  if (!productId) return null;
  return {
    source: 'reddit',
    platform: `reddit:r/${post.subreddit}`,
    url: `https://reddit.com${post.permalink}`,
    external_id: post.name,
    dedup_key: redditDedupKey(post.name),
    product_id: productId,
    title: post.title ?? null,
    author_handle: post.author ?? null,
    raw_text: truncate(text),
    published_at: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
  };
}

function commentToRow(comment, subreddit) {
  const text = comment.body ?? '';
  const productId = matchProduct(text);
  if (!productId) return null;
  return {
    source: 'reddit',
    platform: `reddit:r/${subreddit}`,
    url: `https://reddit.com${comment.permalink}`,
    external_id: comment.name,
    dedup_key: redditDedupKey(comment.name),
    product_id: productId,
    title: null,
    author_handle: comment.author ?? null,
    raw_text: truncate(text),
    published_at: comment.created_utc ? new Date(comment.created_utc * 1000).toISOString() : null,
  };
}

async function searchSitewide() {
  const rows = [];
  for (const product of PRODUCTS) {
    for (const term of product.searchTerms) {
      const json = await redditPublicFetch('/search', { q: term, sort: 'new', limit: 50, type: 'link' });
      const posts = json?.data?.children ?? [];
      for (const { data: post } of posts) {
        const row = postToRow(post);
        if (row) rows.push(row);
      }
    }
  }
  return rows;
}

async function scanTargetSubreddits() {
  const rows = [];
  for (const subreddit of TARGET_SUBREDDITS) {
    const json = await redditPublicFetch(`/r/${subreddit}/new`, { limit: 50 });
    const posts = json?.data?.children ?? [];
    for (const { data: post } of posts) {
      const postRow = postToRow(post);
      if (postRow) rows.push(postRow);

      // Pull top-level comments for threads that already matched a product —
      // discussion of the actual test experience often lives in the comments,
      // not the OP.
      if (postRow) {
        try {
          const commentsJson = await redditPublicFetch(`/r/${subreddit}/comments/${post.id}`, { limit: 100 });
          const commentListing = commentsJson?.[1]?.data?.children ?? [];
          for (const { data: comment } of commentListing) {
            if (comment?.body) {
              const commentRow = commentToRow(comment, subreddit);
              if (commentRow) rows.push(commentRow);
            }
          }
        } catch (err) {
          console.error(`Failed to fetch comments for ${post.id}:`, err.message);
        }
      }
    }
  }
  return rows;
}

async function main() {
  const supabase = getServiceClient();

  const [sitewideRows, subredditRows] = await Promise.all([searchSitewide(), scanTargetSubreddits()]);
  const allRows = [...sitewideRows, ...subredditRows];

  // De-dupe within this run's own batch before hitting the DB (a post can be
  // discovered both via sitewide search and the subreddit scan).
  const seen = new Map();
  for (const row of allRows) {
    seen.set(row.dedup_key, row);
  }
  const uniqueRows = [...seen.values()];

  const insertedCount = await insertMentionsIgnoringDuplicates(supabase, uniqueRows);
  console.log(`Reddit: found ${uniqueRows.length} candidate mentions, inserted ${insertedCount} new rows.`);
}

main().catch((err) => {
  console.error('fetch-reddit.js failed:', err);
  process.exit(1);
});
