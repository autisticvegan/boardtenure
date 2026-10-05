# Cost analysis

Monthly run-rate estimates in USD, as of 2026-10. Price-data figures come from
[research/data-sources.md](research/data-sources.md), which has citations. LLM prices are the Claude API
list prices: Opus 5.5 $4/$20 and Sonnet 5.5 $2/$10 per million input/output tokens, with the Batch
API at 50% off. Infrastructure assumes AWS on-demand list prices and moderate traffic (≤ 1M page
views a month at the larger tiers).

## Run-rate by scale

| Component | 20 cos | 100 | 1,000 | 5,000 | 10,000+ |
|---|---|---|---|---|---|
| **EOD price data with display rights** | $250 | $250–500 | $500–1,000 | $1,000–2,500 | $1,250–2,500+ |
| SEC data | $0 | $0 | $0 | $0 | $0 |
| LLM extraction (ongoing, batch) | <$1 | ~$1 | ~$5 | ~$25 | ~$45 |
| Database (RDS Postgres) | $15–30 | $30 | $60–80 | $150 | $200–400 |
| Compute: web (Fargate) + daily job | $20–40 | $40 | $60 | $100 | $150–250 |
| Raw store (S3) | <$1 | ~$1 | ~$3 | ~$12 | ~$25 |
| CDN + WAF (+ Bot Control) | $15–30 | $30 | $40–60 | $60–100 | $100–200 |
| Search | $0 (Postgres) | $0 | $0 | $0 | $0–150 (OpenSearch only if needed) |
| Monitoring (CloudWatch, Sentry) | $0–10 | $10 | $30 | $50 | $50–100 |
| **Total** | **~$300–360** | **~$360–610** | **~$700–1,250** | **~$1,450–3,000** | **~$1,850–3,700+** |

**One-time backfill (LLM).** Reconstructing ~20 years of board history at 10,000 companies costs about
**$5k with Sonnet 5.5 or $10k with Opus 5.5**, using the Batch API. That covers about 100k proxies and 230k
Item 5.02 8-Ks. At 1,000 companies it is roughly a tenth of that. Current boards alone via single-call extraction (one proxy plus recent 8-Ks) cost about
$0.10–0.20 per company. The agentic research used to seed companies by hand-verified research (Lyft and the
first dozen) runs roughly $2–6 per company in model usage.

## How the LLM numbers are derived

Document sizes were measured on Lyft (data-sources.md §5). Filing volumes are EDGAR 2025 counts.

| Document | Input tokens (after deterministic section-cutting) | Output (JSON + verbatim quotes, incl. thinking) | Opus 5.5 / Sonnet 5.5 per doc, batch |
|---|---|---|---|
| DEF 14A, board/nominee section | ~13k + ~1k prompt | ~3–6k | ~$0.06–0.09 / ~$0.03–0.045 |
| 8-K Item 5.02 | ~1.4k + ~1k prompt | ~0.5–1k | ~$0.01 / ~$0.005 |

Market-wide volumes are about 5,200 DEF 14As and 11,500 Item 5.02 8-Ks a year. Processing all of them
costs under $1,000 a year on Opus 5.5 even before cutting officer-only 8-Ks. A deterministic pre-filter
for officer-only 8-Ks halves that. Prompt caching of the fixed instructions saves little here, because
documents dominate the input.

Every extraction is checked deterministically: each quote must appear verbatim in the cached filing,
or the fact is capped at low confidence and queued for review. LLM spend is therefore not the cost
that scales with mistakes. Review time is.

## What gets expensive first

1. **Price display rights.** This is already ~80% of the bill at 20 companies and grows with audience
   and redistribution scope more than with company count. Single-tenure percentages generally count as
   derived data, but a daily chart counts as displaying prices under most licenses, which is the main
   reason the redistribution tier is required.
2. **Human review.** At 1,000+ companies the daily queue (new directors on Form 3, 8-K 5.02, new proxies)
   is roughly 20–60 items a day in proxy season. That is part-time analyst work. Deterministic Form 3/4
   corroboration and verified-quote LLM extraction are the levers that keep it bounded.
3. **Delisted-company history.** Directors' past boards are often long-gone companies, and only
   Sharadar/Nasdaq Data Link and CRSP cover delisted names deeply. Expect the price line to jump to the
   upper end of the ranges above once director track records span acquired or delisted companies.
4. **Database and compute** stay small. 10,000 companies × ~30 years of daily bars is about 75M rows
   (~10–15 GB with indexes), comfortably one Postgres instance with a read replica.

## Cost controls already in the design

- Server-side aggregation and downsampled charts, so no raw-price bulk endpoint exists to scrape.
- Pages cached at the CDN for an hour. Most traffic never reaches the origin.
- An append-only total-return index, so the daily job touches only new rows.
- SEC filings cached forever in the raw store. Re-extraction never re-downloads.
