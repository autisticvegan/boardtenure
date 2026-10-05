# BoardTenure

How did a company's stock perform while each director sat on its board? A historical tool:
prices refresh weekly, and the site shows no live quotes. BoardTenure
measures every director's tenure return against the S&P 500 (via SPY total return). Each
board date cites the SEC filing it came from.

Tenure returns are descriptive. They don't imply that a director caused a company's
performance. See [docs/methodology.md](docs/methodology.md).

## Layout

| path | what |
|---|---|
| `db/migrations/` | PostgreSQL schema (forward-only SQL, applied by `bt db migrate`) |
| `pipeline/` | Python package `bt`: SEC/price ingestion, seed loading, validation, analytics |
| `web/` | Next.js app: pages, `/api/v1` JSON API, admin |
| `data/seed/` | Researched, source-cited board files (committed) |
| `data/raw/` | Raw store of every fetched document (gitignored; re-fetchable) |
| `docs/` | Methodology, architecture, research notes, runbooks |

## Quickstart (local)

Requires PostgreSQL 13+, Python 3.12+ with [uv](https://docs.astral.sh/uv/), and Node 22.

```bash
createdb boardtenure_dev
cp .env.example .env            # set SEC_USER_AGENT to a real contact address
cd pipeline && uv sync
uv run bt db migrate && uv run bt ref init
uv run bt seed board ../data/seed/lyft_board_research.json
# prices: licensed feed in production; prototype CSVs locally (see docs/adding-a-company.md)
uv run bt analytics recompute
cd ../web && npm install && npm run dev
```

## Status

Prototype. Lyft is fully covered: the current board is verified, and history since the IPO is
complete. The price data is from keyless public sources and is **not licensed for public
display**. A licensed end-of-day feed is required before launch; see
[docs/research/data-sources.md](docs/research/data-sources.md).
