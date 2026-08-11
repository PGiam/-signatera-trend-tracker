-- Signatera Trend Tracker — initial schema.
-- Run manually in the Supabase SQL Editor (service-role key can only do
-- row-level REST operations via PostgREST, not DDL).

create extension if not exists pgcrypto;

create table public.products (
  id smallint primary key,
  slug text unique not null,
  display_name text not null
);

insert into public.products (id, slug, display_name) values
  (1, 'signatera', 'Signatera'),
  (2, 'guardant360', 'Guardant360'),
  (3, 'foundationone_liquid', 'FoundationOne Liquid');

create table public.raw_mentions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('reddit', 'youtube', 'web')),
  platform text not null,                 -- e.g. 'reddit:r/cancer', 'youtube', 'onclive.com'
  url text not null,
  external_id text not null,              -- reddit fullname / youtube comment id / normalized-url hash
  dedup_key text not null unique,         -- source || ':' || external_id
  product_id smallint references public.products(id),
  product_match_confidence numeric(3, 2),
  title text,
  author_handle text,
  author_type text check (author_type in
    ('patient', 'caregiver', 'doctor', 'healthcare_professional', 'other', 'unknown')),
  author_type_confidence numeric(3, 2),
  author_type_reasoning text,
  sentiment text check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  sentiment_score numeric(3, 2),
  raw_text text not null,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  classified_at timestamptz,
  classification_model text,
  created_at timestamptz not null default now()
);

create index raw_mentions_product_published_idx on public.raw_mentions (product_id, published_at);
create index raw_mentions_source_idx on public.raw_mentions (source);
create index raw_mentions_unclassified_idx on public.raw_mentions (classified_at) where classified_at is null;
create index raw_mentions_author_type_idx on public.raw_mentions (author_type);

-- Daily rollup for fast dashboard charting. Fully recomputed for the last few
-- days on each aggregation run (idempotent upsert) rather than accounted
-- incrementally — simple, and self-correcting when classification lands late.
create table public.mention_rollups_daily (
  rollup_date date not null,
  product_id smallint not null references public.products(id),
  author_type text not null,
  mention_count integer not null default 0,
  avg_sentiment_score numeric(4, 3),
  positive_count integer not null default 0,
  neutral_count integer not null default 0,
  negative_count integer not null default 0,
  mixed_count integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (rollup_date, product_id, author_type)
);

create index mention_rollups_daily_date_idx on public.mention_rollups_daily (rollup_date);

-- Weekly grain derived on the fly — data volume is small enough that a
-- materialized weekly table isn't worth the extra recompute logic.
create view public.mention_rollups_weekly as
select date_trunc('week', rollup_date)::date as week_start,
       product_id,
       author_type,
       sum(mention_count) as mention_count,
       sum(mention_count * avg_sentiment_score) / nullif(sum(mention_count), 0) as avg_sentiment_score
from public.mention_rollups_daily
group by 1, 2, 3;

-- Audit log for the natural-language query feature (src/pages/api/ask.js).
create table public.query_log (
  id uuid primary key default gen_random_uuid(),
  asked_at timestamptz not null default now(),
  question text not null,
  generated_sql text,
  sql_valid boolean not null,
  validation_error text,
  row_count integer,
  answer text,
  duration_ms integer
);
