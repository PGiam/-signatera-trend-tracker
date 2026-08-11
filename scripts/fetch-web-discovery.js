import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from './lib/supabase-client.js';
import { webDedupKey, normalizeUrl, insertMentionsIgnoringDuplicates } from './lib/dedup.js';
import { PRODUCTS, MEDICAL_NEWS_ALLOWLIST, isBlockedUrl } from './lib/products.js';

const RAW_TEXT_CAP = 8000;
const USER_AGENT = 'SignateraTrendTrackerBot/1.0 (+research tool; contact via GitHub repo)';

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
  const prompt = `Search the web for pages published in the last 14 days that discuss any of these medical tests: ${productList}. ` +
    'I want articles, discussion threads, or commentary — not product landing pages or investor press releases. ' +
    'List each distinct URL you find, one per line, with just the raw URL (no extra text).';

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

async function extractArticleText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const html = await res.text();

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

  return { title, text };
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

  const [generalUrls, medicalNewsUrls] = await Promise.all([
    discoverUrls(anthropic),
    discoverUrls(anthropic, { allowedDomains: MEDICAL_NEWS_ALLOWLIST }),
  ]);

  const candidateUrls = [...new Set([...generalUrls, ...medicalNewsUrls])].filter((url) => {
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
      const { title, text } = await extractArticleText(url);
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
        published_at: null, // publish date extraction is unreliable across arbitrary sites; left null
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
