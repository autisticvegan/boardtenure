# Architecture

## Shape

```
SEC EDGAR ─┐                     ┌─ raw store (data/raw → S3): every fetched byte, content-addressed
price feed ─┼─▶ ingestion jobs ──┤
research ──┘    (pipeline/bt)    └─ source_document rows (URL, sha256, filing date)
                     │
                     ▼
         extraction (deterministic XML / text, LLM with verified quotes, manual research)
                     │  evidence (verbatim quote + locator + quote_verified)
                     ▼
         staging: extracted_fact ──▶ entity resolution (SEC CIK first, then name)
                     │
                     ▼
         reconciliation ──▶ canonical tables (company, security, person, board_membership,
                     │                         board_role, board_independence, board_event)
                     │       every row linked to evidence; admin edits audited; locked rows untouchable
                     ▼
         validation (bt quality) ──▶ data_issue (prioritized: current board > recent > historical)
                     │
                     ▼
         analytics (bt analytics) ──▶ price_daily.tr_index ──▶ tenure_performance
                     │
                     ▼
         Next.js: server-rendered pages + /api/v1 (rate-limited, page-shaped, derived data only)
```

## Freshness target: historical, not live

The product answers "what did the stock do while this person served?" It is a historical-performance
tool, not a quote service, so **stored prices and filings may lag by up to a week**
(`FRESHNESS_DAYS = 7` in `pipeline/src/bt/config.py`). That shapes everything downstream:

- **No live quotes anywhere.** Pages say "prices through <date>", and open tenures are measured to the
  latest stored close.
- **One weekly refresh job.** No intraday or end-of-day race. Every stage is incremental, so running it
  more often costs only a few requests.
- **Caching.** Pages revalidate daily, and API responses carry `s-maxage=86400`. Nearly all traffic is
  served from the CDN.
- **Price sourcing.** Any historical EOD product works, including weekly bulk downloads. There's no need
  for real-time or same-day feeds or their fees. Display licensing still applies to historical data
  (see cost-analysis.md).
- **Staleness alarms** fire only beyond the target plus a holiday margin (`STALE_AFTER_DAYS = 10`).

## Decisions

| Area | Choice | Why |
|---|---|---|
| Database | PostgreSQL (13+ locally; 16+ in prod) | Relational integrity for memberships and provenance; `pg_trgm` covers typo-tolerant search well past 100k entities. |
| Pipeline | Python (`bt`, uv) | The data-engineering ecosystem (lxml, httpx, psycopg), plus easy LLM SDK use. |
| Web | Next.js 16 + React 19 + Tailwind 4, custom SVG charts (d3-scale/shape) | Server components read Postgres directly, so pages never need a public bulk API. Hand-built charts give the tenure band, markers and benchmark overlay exactly. |
| Returns | Computed once in Python, materialized | One implementation of the methodology. The web layer only reads it. |
| Adjustments | Own forward total-return index from raw closes + actions | Reproducible and vendor-independent. Append-only, so daily updates never rewrite history. |
| Date uncertainty | Store window start + precision; publish return ranges | Never invent precision (see methodology). |
| Person identity | SEC reporting-owner CIK (Forms 3/4/5), then slug | Distinguishes namesakes and merges the same director across companies. |
| Schedules | One weekly refresh job (`bt refresh`), stage-isolated | Matches the ≤ 7-day freshness target. No queue needed yet. `job_run` is the run log. A `FOR UPDATE SKIP LOCKED` work table is the next step if parallelism is ever needed. |
| Audit | Row triggers on canonical tables; `bt.actor`/`bt.reason` session settings | Nothing (pipeline or admin) can change a canonical row without a trace. |

## Data layers

1. **Raw:** `data/raw/` (S3 in production). Files are never modified. SEC paths follow `sec/<cik>/<accession>/<file>`.
2. **Source index:** `source_document`, `sec_filing` (what exists and its processing state).
3. **Evidence:** `evidence` (quote, locator, `quote_verified`, extraction method), linked to facts via `evidence_link`.
4. **Staging:** `extracted_fact` (pending, needs_review, applied, rejected). It is never shown publicly. Other-board disclosures from bios wait here until that company is tracked.
5. **Canonical:** the board tables, with `confidence`, `review_status` and `is_locked`.
6. **Analytics:** `tenure_performance` (one row per seat × benchmark) and `data_issue`.

## Refresh job (`bt refresh`, weekly)

1. **Prices.** For every tracked security plus the benchmarks, fetch from the day after the last stored session (about a week of bars), upsert the bars and any corporate actions, then extend the index (full rebuild only if an action changed).
2. **SEC.** For each tracked company, read the submissions JSON and record new filings:
   - **Form 3/4/5:** parse the XML. A director with no seat becomes a review item; otherwise the filing corroborates the existing seat.
   - **8-K 5.02/5.07 and proxies:** queued for review. AI-assisted extraction with verified quotes is planned.
   - **Baseline:** filings dated on or before a company's last full review are recorded as processed.
3. **Analytics.** Recompute tenure performance. Open tenures move with each new week of prices.
4. **Quality.** Run all checks; issues that stop firing auto-resolve.

At scale, step 2 switches from per-company submissions to the EDGAR daily indexes for the past week (`Edgar.daily_form_index`, five requests), filtered to tracked CIKs.

## Scraping protection

- **Pages are server-rendered.** Charts get downsampled cumulative returns (≤ 520 points), never raw OHLCV.
- **The JSON API is page-shaped.**
  - Capped page sizes; no bulk export.
  - Token-bucket rate limits: 60 burst and 1/s anonymous; API keys get 10×.
  - `X-Robots-Tag: noindex`, and `robots.txt` disallows `/api/` and `/admin`.
- **Production:** CloudFront in front, AWS WAF with rate-based rules and Bot Control managed rules, and CDN caching of pages (`revalidate = 86400`). The in-process limiter moves to Redis/ElastiCache once there is more than one origin instance.
- **ToS** forbids systematic reproduction. Every fact page attributes its sources.

## Production deployment (AWS)

| Component | Service |
|---|---|
| Web | ECS Fargate (or Amplify Hosting) behind ALB + CloudFront + WAF |
| Database | RDS PostgreSQL (start db.t4g.small; read replica when traffic warrants) |
| Raw store | S3 (Intelligent-Tiering), keys identical to `data/raw/` |
| Pipeline | ECS scheduled task via EventBridge Scheduler (weekly, e.g. Saturday after the week's closes) |
| Secrets | Secrets Manager (price-feed key, SEC contact, admin credentials) |
| Admin | `/admin` behind SSO (ALB + Cognito / Okta) in addition to app-level auth |
| Monitoring | CloudWatch alarms on `job_run` failures and staleness checks (> 10 days); Sentry for the web app |
