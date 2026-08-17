-- product_match_confidence has existed since 001_init_schema.sql and been
-- written by score-results.js since day one, but nothing ever actually read
-- it — every classified row counted toward trends/reports/the mentions feed
-- regardless of confidence. That gap became a real problem once
-- fetch-reddit.js started guessing a product for generic ("ctDNA test",
-- "MRD test") mentions that don't name a brand: a wrong guess needs to
-- actually get filtered out downstream, not just silently stored. Wire the
-- existing column into the one query surface this project's SQL owns
-- (aggregate-trends.js filters raw_mentions directly in JS, not SQL — see
-- its own .gte() call).
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
where m.classified_at is not null
  and m.product_match_confidence >= 0.5;
