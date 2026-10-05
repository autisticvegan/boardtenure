# Adding a company

Covering a company has three parts: a researched board file, price history, and a load. The
current board must be complete and verified before a company ships. Older history can be
partial if the `coverage` block says so.

## 1. Research the board → `data/seed/<ticker>_board_research.json`

Use `data/seed/lyft_board_research.json` as the reference shape. Sources, in order of weight:

1. **8-K Item 5.02**: appointment and departure, with effective dates (`high`).
2. **8-K Item 5.07**: the annual-meeting date, which ends the seat of a director who didn't stand.
3. **DEF 14A**: "director since" year, class, independence, committees, chair or lead independent
   director, and other public boards in bios.
4. **Form 3/4 XML**: the director's SEC CIK (`<rptOwnerCik>`). It is required for everyone who
   filed one and is how the same person is recognized across companies. A Form 3 event date is a
   start date only for appointments after the IPO. Every pre-IPO director's Form 3 carries the
   IPO date.
5. **S-1 / 424B4**: the board at IPO and pre-IPO start months.

Rules:

- Store `YYYY`, `YYYY-MM` or `YYYY-MM-DD` with a matching precision. Never pad a year into a day.
- Record a pre-IPO director's true start, not the IPO date.
- Every membership, role and event needs at least one evidence item whose quote is copied
  verbatim from the filing.
- Scope by priority: current board (complete), then departures in the last ~5 years, then older.

Fetch filings only through the shared, rate-limited cache:

```bash
python3 scripts/sec_fetch.py 'https://www.sec.gov/Archives/edgar/data/<cik>/<acc>/<file>'
uv --directory pipeline run python ../scripts/sec_text.py <cached path> -g 'Director since' -C 2
```

Verify until clean (it checks every quote verbatim against the cached filing, plus every reference):

```bash
uv --directory pipeline run bt seed verify ../data/seed/<ticker>_board_research.json
```

## 2. Prices

Production uses the licensed EOD feed (`TIINGO_API_KEY`). `bt daily` backfills a new security from
1990 on its first run. Locally, the prototype CSVs go in `data/seed/prices/<SYMBOL>.csv` (raw
as-traded closes) and `<SYMBOL>_actions.csv` (splits and dividends). See
`docs/research/price-data-verification*.md`.

Make sure the benchmark covers the earliest tenure start. A tenure that starts before stored price
history shows "price history incomplete" (`history_gap`) rather than a wrong number.

## 3. Load, compute, validate

```bash
uv --directory pipeline run bt seed all        # verifies and loads every seed file and price file, recomputes, runs checks
```

Or step by step: `bt seed board <file>`, `bt prices load-csv …`, `bt prices load-actions …`,
`bt analytics recompute --company <slug>`, then `bt quality run`.

Then:

- Open `/admin`: priority-1 issues must be zero.
- Spot-check two current directors' tenure pages against the cited filings.
- Add a reference test like `pipeline/tests/test_lyft_reference.py` if the company has unusual
  corporate actions.

From then on, `bt daily` watches the company's filings. New Forms 3/4, 8-K 5.02/5.07 and proxies
land in the admin review queue.
