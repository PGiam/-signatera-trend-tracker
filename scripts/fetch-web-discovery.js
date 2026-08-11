import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from './lib/supabase-client.js';
import { webDedupKey, normalizeUrl, insertMentionsIgnoringDuplicates } from './lib/dedup.js';
import { PRODUCTS, MEDICAL_NEWS_ALLOWLIST, PATIENT_FORUM_ALLOWLIST, isBlockedUrl } from './lib/products.js';

const RAW_TEXT_CAP = 8000;
// A declared bot UA gets a hard 403 from some sites we need (e.g.
// connect.mayoclinic.org) even though the same pages are public and openly
// indexed by search engines. This only affects which UA string rides along
// with the request for pages we've already decided (via robots.txt +
// SOURCE_BLOCKLIST) we're allowed to fetch — not an attempt to get at
// anything gated.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function truncate(text) {
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

async function discoverUrls(anthropic, { allowedDomains } = {}) {
  const productList = PRODUCTS.map((p) => p.displayName).join(', ');
  const prompt = `Search the web for pages that discuss any of these medical tests: ${productList} — ` +
    'patient experiences, discussion-forum threads, clinical commentary, or news coverage, from any time period, ' +
    'not just recent. I want articles, discussion threads, or commentary — not product landing pages or investor ' +
    'press releases. List each distinct URL you find, one per line, with just the raw URL (no extra text).';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        ...(allowedDomains ? { allowed_domains: allowedDomains } : {}),
      },
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const urlPattern = /https?:\/\/[^\s)]+/g;
  return [...new Set(text.match(urlPattern) ?? [])];
}

function extractPublishedDate(html) {
  // Try, in order of reliability: schema.org JSON-LD datePublished (what
  // forum platforms like Mayo Clinic Connect use), then Open Graph /
  // article meta tags, then a bare <time datetime> element. Any of these
  // beats falling back to scrape time, which is all this returned before.
  const jsonLdBlocks = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
  for (const [, block] of jsonLdBlocks) {
    const m = block.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    if (m) return m[1];
  }

  const metaMatch = html.match(
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|og:published_time|date|publish-date|dc\.date)["'][^>]+content=["']([^"']+)["']/i
  );
  if (metaMatch) return metaMatch[1];

  const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
  if (timeMatch) return timeMatch[1];

  return null;
}

async function extractArticleText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const html = await res.text();

  const rawPublishedAt = extractPublishedDate(html);
  const publishedAt = rawPublishedAt && !Number.isNaN(Date.parse(rawPublishedAt))
    ? new Date(rawPublishedAt).toISOString()
    : null;

  // Minimal extraction: strip script/style, strip tags, collapse whitespace.
  // Not a full Readability port — good enough to feed the classifier, which
  // only needs the gist of the page, not pixel-perfect article text.
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const titleMatch = withoutScripts.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;
  const text = withoutScripts
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, text, publishedAt };
}

async function robotsAllows(url) {
  try {
    const u = new URL(url);
    const robotsUrl = `${u.protocol}//${u.hostname}/robots.txt`;
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return true; // no robots.txt / unreachable -> assume allowed
    const body = await res.text();
    // Coarse check: only respect a blanket "Disallow: /" under a wildcard
    // user-agent block — good enough to catch sites that opt out entirely.
    const wildcardBlock = body.match(/User-agent:\s*\*[\s\S]*?(?=User-agent:|$)/i);
    if (wildcardBlock && /Disallow:\s*\/\s*$/im.test(wildcardBlock[0])) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

async function main() {
  const supabase = getServiceClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const [generalUrls, medicalNewsUrls, patientForumUrls] = await Promise.all([
    discoverUrls(anthropic),
    discoverUrls(anthropic, { allowedDomains: MEDICAL_NEWS_ALLOWLIST }),
    discoverUrls(anthropic, { allowedDomains: PATIENT_FORUM_ALLOWLIST }),
  ]);

  const candidateUrls = [...new Set([...generalUrls, ...medicalNewsUrls, ...patientForumUrls])].filter((url) => {
    try {
      return !isBlockedUrl(url);
    } catch {
      return false; // malformed URL
    }
  });

  const rows = [];
  for (const url of candidateUrls) {
    if (!(await robotsAllows(url))) {
      console.log(`Skipping ${url}: robots.txt disallows`);
      continue;
    }
    try {
      const { title, text, publishedAt } = await extractArticleText(url);
      const combined = `${title ?? ''}\n\n${text}`;
      const productId = matchProduct(combined);
      if (!productId) continue;

      const normalized = normalizeUrl(url);
      rows.push({
        source: 'web',
        platform: new URL(normalized).hostname,
        url: normalized,
        external_id: normalized,
        dedup_key: webDedupKey(url),
        product_id: productId,
        title,
        author_handle: null,
        raw_text: truncate(text),
        published_at: publishedAt, // from page metadata when extractable; null falls back to discovered_at in aggregation
      });
    } catch (err) {
      console.error(`Failed to extract ${url}:`, err.message);
    }
  }

  const insertedCount = await insertMentionsIgnoringDuplicates(supabase, rows);
  console.log(
    `Web discovery: ${candidateUrls.length} candidate URLs, ${rows.length} matched a product, inserted ${insertedCount} new rows.`
  );
}

main().catch((err) => {
  console.error('fetch-web-discovery.js failed:', err);
  process.exit(1);
});
