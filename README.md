# Signatera Trend Tracker

Tracks public mentions of Signatera, Guardant360, and FoundationOne Liquid across Reddit, YouTube, and the open web; classifies each mention by author type (patient/caregiver vs. doctor/HCP) and sentiment; retains history for trend charts; and answers natural-language questions against the collected data. See `../.claude/plans/scalable-discovering-bumblebee.md` (or your Claude Code session) for the full design rationale.

## One-time setup (needs your logins — I can't do these for you)

### 1. Supabase project
1. Create a new Supabase project (separate from any other project you run).
2. In the SQL Editor, run `sql/001_init_schema.sql`, then `sql/002_readonly_role_and_views.sql` — **edit the placeholder password in `002_...sql` before running it**, and save the password somewhere safe. Also run `sql/003_disable_rls.sql` and `sql/004_trend_reports.sql`.
3. From Project Settings → API, note the **Project URL**, **anon public key**, and **service_role key**.
4. From Project Settings → Database, get the **connection string** — use the **transaction pooler** (IPv4-compatible, works from serverless functions), not the direct connection — and swap in `app_readonly_query` as the user and the password you set above — this becomes `SUPABASE_READONLY_DB_URL`.

Dashboard access uses a single shared passcode (`DASHBOARD_PASSCODE`, set in Netlify env vars), not Supabase Auth — no email/redirect-URL setup needed.

### 2. Reddit — via Apify
Both Reddit's OAuth script-app registration (requires manual approval for a moderation use case) and unauthenticated `.json` scraping (blocked outright since May 2026 — redirects to a login wall) are dead ends. `scripts/fetch-reddit.js` instead uses Apify's `trudax/reddit-scraper-lite` actor, which automates a real browser to get past that.
1. Create an account at apify.com and set up billing (the actor costs roughly $1.50–2/1,000 results; this project's usage is a few dollars a month).
2. Console → Settings → API & Integrations → copy your personal API token.
3. Set it as `APIFY_API_TOKEN` locally (`.env`) and in the GitHub repo secret of the same name.

### 3. YouTube API key
1. console.cloud.google.com → new project (or reuse one) → API Library → enable **YouTube Data API v3**.
2. Credentials → Create Credentials → API key → restrict it to that API only.
3. Free tier is 10,000 units/day; this project's usage pattern (a handful of `search.list` calls plus per-video `commentThreads.list` calls each run) comfortably fits.

### 4. GitHub repo + Actions secrets
1. Push this folder to a new private GitHub repo.
2. Repo → Settings → Secrets and variables → Actions, add:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `REDDIT_USER_AGENT`, `YOUTUBE_API_KEY`.
3. `.github/workflows/pipeline.yml` runs the full chain — ingest (YouTube + web discovery) → classify → aggregate → generate report — automatically every 3 days once secrets are set, so the dataset keeps growing over time. No further action needed. You can also trigger it manually from the Actions tab (`workflow_dispatch`).

### 5. Netlify site
1. New site from Git → pick the repo → build command `npm run build`, publish directory `dist` (already set in `netlify.toml`).
2. Site settings → Environment variables, add:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_READONLY_DB_URL`, `ANTHROPIC_API_KEY`, `DASHBOARD_PASSCODE` (whatever passcode you want to share with viewers).
3. Deploy. Visit the site, go to `/login`, enter the passcode.

## Local development

```
cp .env.example .env   # fill in the same values as above
npm install
npm run dev
```

To run an ingestion/classification/aggregation pass manually while developing:

```
npm run fetch:reddit
npm run fetch:youtube
npm run fetch:web
npm run classify
npm run aggregate
```

## Known limitations

- **Reddit ingestion runs through a third-party scraper (Apify), not Reddit directly.** Reddit shut down unauthenticated `.json` access entirely and gates OAuth script-app registration behind manual moderation-use-case approval, so `scripts/fetch-reddit.js` uses Apify's `trudax/reddit-scraper-lite` actor instead — a more deliberate workaround than the rest of this pipeline, since Reddit intentionally closed both paths off. It costs a few dollars a month; if Apify ever changes pricing or the actor breaks, this is the source most likely to need attention.
- Doctor-side content will be sparse and skew toward medical-news-site commentary (OncLive, Medscape, Healio, Targeted Oncology) rather than organic reviews — doctors don't generally post public reviews of diagnostic tests the way patients describe their experience.
- Web discovery is the noisiest ingestion source; classification's `product_match_confidence` filters most false positives, but some will get through, especially early on.
- Sentiment and author-type classification is an LLM heuristic with stored reasoning per row (`author_type_reasoning`), not ground truth. Trust the trend *direction* over time more than any single row's label.
