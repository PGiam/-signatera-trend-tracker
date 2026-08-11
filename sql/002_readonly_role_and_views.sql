-- Restricted role + narrow view backing the natural-language query feature
-- (src/pages/api/ask.js). This role is deliberately incapable of writing:
-- no insert/update/delete/truncate/DDL grants anywhere, only SELECT on the
-- three relations below. Run manually in the Supabase SQL Editor after
-- 001_init_schema.sql.

-- Replace the password below before running, then put the resulting
-- connection string in SUPABASE_READONLY_DB_URL (Netlify env var only —
-- never commit it).
create role app_readonly_query with login password '<REPLACE_WITH_STRONG_PASSWORD>';
alter role app_readonly_query set statement_timeout = '5s';
grant connect on database postgres to app_readonly_query;
grant usage on schema public to app_readonly_query;

-- Narrow view instead of the base table: excludes internal bookkeeping
-- columns (dedup_key, classification_model, etc.) and only surfaces
-- classified rows.
create or replace view public.mentions_for_query as
select
  m.id,
  m.source,
  m.platform,
  m.url,
  p.slug as product,
  m.author_type,
  m.author_type_confidence,
  m.sentiment,
  m.sentiment_score,
  m.title,
  m.raw_text as excerpt,
  m.published_at,
  m.discovered_at
from public.raw_mentions m
join public.products p on p.id = m.product_id
where m.classified_at is not null;

grant select on public.mentions_for_query to app_readonly_query;
grant select on public.mention_rollups_daily to app_readonly_query;
grant select on public.mention_rollups_weekly to app_readonly_query;
grant select on public.products to app_readonly_query;
