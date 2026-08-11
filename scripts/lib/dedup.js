import { createHash } from 'node:crypto';

export function redditDedupKey(fullname) {
  return `reddit:${fullname}`;
}

export function youtubeDedupKey(commentId) {
  return `youtube:${commentId}`;
}

export function normalizeUrl(rawUrl) {
  const u = new URL(rawUrl);
  u.hostname = u.hostname.toLowerCase();
  // Strip common tracking params.
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((p) =>
    u.searchParams.delete(p)
  );
  let normalized = `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

export function webDedupKey(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `web:${hash}`;
}

/**
 * Insert rows, silently skipping ones whose dedup_key already exists.
 * Returns the count of rows actually inserted.
 */
export async function insertMentionsIgnoringDuplicates(supabase, rows) {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('raw_mentions')
    .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}
