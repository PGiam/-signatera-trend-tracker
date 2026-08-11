-- Supabase now auto-enables RLS on new tables created in the public schema.
-- This project's access model is role-based (service_role for writes, the
-- narrowly-scoped app_readonly_query role for reads via /ask — see
-- 002_readonly_role_and_views.sql), not RLS, and service_role already
-- bypasses RLS by default. With RLS left on and no policies defined,
-- app_readonly_query silently sees zero rows on every table. Disable it here
-- so the role grants already in place are what actually govern access.

alter table public.products disable row level security;
alter table public.raw_mentions disable row level security;
alter table public.mention_rollups_daily disable row level security;
alter table public.query_log disable row level security;
