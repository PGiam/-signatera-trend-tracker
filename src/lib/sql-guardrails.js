// Layered validation for LLM-generated SQL before it ever reaches Postgres.
// This is defense-in-depth alongside the restricted `app_readonly_query`
// role's own privilege grants (sql/002_readonly_role_and_views.sql) and the
// explicit `BEGIN READ ONLY` transaction wrapper (db-readonly.js) — all
// three have to fail simultaneously for anything to go wrong.

export const ALLOWED_RELATIONS = [
  'mentions_for_query',
  'mention_rollups_daily',
  'mention_rollups_weekly',
  'products',
];

const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COPY|CALL|CREATE|EXECUTE|DO)\b/i;

const DEFAULT_ROW_LIMIT = 500;

/**
 * Returns { valid: true, sql } or { valid: false, error }.
 * `sql` on success has a LIMIT appended if the model didn't include one.
 */
export function validateAndCapSql(rawSql) {
  const sql = (rawSql ?? '').trim();

  if (sql.length === 0) {
    return { valid: false, error: 'Empty query.' };
  }

  if (!/^select\b/i.test(sql)) {
    return { valid: false, error: 'Query must start with SELECT.' };
  }

  // Reject multi-statement input: a ';' followed by any further
  // non-whitespace content. A single trailing ';' is fine.
  const withoutTrailingSemicolon = sql.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    return { valid: false, error: 'Multiple statements are not allowed.' };
  }

  if (FORBIDDEN_KEYWORDS.test(withoutTrailingSemicolon)) {
    return { valid: false, error: 'Query contains a disallowed keyword.' };
  }

  const relationMatches = [...withoutTrailingSemicolon.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w.]*)/gi)];
  for (const match of relationMatches) {
    const relation = match[1].replace(/^public\./i, '');
    if (!ALLOWED_RELATIONS.includes(relation)) {
      return { valid: false, error: `Query references a relation that isn't allowed: ${relation}` };
    }
  }

  let finalSql = withoutTrailingSemicolon;
  if (!/\blimit\s+\d+/i.test(finalSql)) {
    finalSql = `${finalSql} LIMIT ${DEFAULT_ROW_LIMIT}`;
  }

  return { valid: true, sql: finalSql };
}
