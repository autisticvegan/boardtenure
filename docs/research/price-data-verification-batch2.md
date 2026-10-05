# Price data verification, batch 2: 12 stocks and SPY back to inception

Retrieved 2026-10-05 05:39–06:47 UTC (2026-10-04 evening US Pacific). The last session is Friday
2026-10-02. Batch 1 (LYFT, and SPY from 2019-03-01) is in
[price-data-verification.md](price-data-verification.md); this batch reuses its conventions.

**Status: prototype only.** Every source below was reached without an API key. None of them grants a
license for redistribution or public display.

## TL;DR

| Symbol | Seed range | Rows | Splits | Cash / special dividends | Max TR deviation vs stockanalysis adj. close (2021-10-04..2026-10-02) | Closes confirmed by ≥1 other vendor | Unconfirmed closes (flagged) |
|---|---|---|---|---|---|---|---|
| AAPL | 1990-01-02..2026-10-02 | 9,256 | 4 | 81 / 0 | 0.82 bp ($0.016) | 9,246 | 9 + 1 within one tick |
| MSFT | 1990-01-02..2026-10-02 | 9,256 | 8 | 91 / 1 | 0.90 bp ($0.030) | 9,249 | 7 |
| NVDA | 1999-01-22 (IPO)..2026-10-02 | 6,967 | 6 | 56 / 0 | 0.26 bp ($0.006) | 6,967 | 1 |
| GOOGL | 2004-08-19 (IPO)..2026-10-02 | 5,566 | 2 | 10 / 0 | 0.63 bp ($0.012) | 5,564 | 2 |
| AMZN | 1997-05-15 (IPO)..2026-10-02 | 7,392 | 4 | 0 / 0 | 0 | 7,389 | 3 + 1 within one tick |
| META | 2012-05-18 (IPO, as FB)..2026-10-02 | 3,614 | 0 | 11 / 0 | 2.06 bp ($0.134) | 3,614 | 0 |
| TSLA | 2010-06-29 (IPO)..2026-10-02 | 4,091 | 2 | 0 / 0 | 0 | 4,091 | 0 |
| NFLX | 2002-05-23 (IPO)..2026-10-02 | 6,130 | 3 | 0 / 0 | 0 | 6,129 | 1 |
| UBER | 2019-05-10 (IPO)..2026-10-02 | 1,860 | 0 | 0 / 0 | 0 | 1,860 | 0 |
| ABNB | 2020-12-10 (IPO)..2026-10-02 | 1,459 | 0 | 0 / 0 | 0 | 1,459 | 0 |
| JPM | 1992-01-02..2026-10-02 | 8,750 | 2 | 138 / 0 | 5.07 bp ($0.077) | 8,705 | 34 + 11 within one tick |
| KO | 1990-01-02..2026-10-02 | 9,256 | 4 | 147 / 0 | 3.00 bp ($0.017) | 9,201 | 40 + 15 within one tick |
| SPY | 1993-01-29 (inception)..2026-10-02 | 8,477 | 0 | 136 / 2 | 0.013 bp ($0.0005) | 8,443 | 23 + 11 within one tick |

Notes on the table:
- **Row counts.** Every seed has exactly one row per XNYS session in its range. The XNYS and XNAS
  calendars in `exchange_calendars` 4.13.2 are identical for 1990–2026.
- **TR deviation.** The "Max TR deviation" column uses the pipeline's convention: one share is worth
  split × (close + dividend) / prior close. stockanalysis builds its stock adjusted closes with the
  CRSP/Yahoo multiplier (1 − D / prior close). Recomputed with that multiplier, our closes and actions
  reproduce its adjusted close for all 12 stocks to ≤ 0.0004 bp (≤ $0.000001), which is its rounding.
  So the residual in the table is the convention difference on ex-dates, not a data difference. For
  SPY, stockanalysis uses the pipeline convention, as found in batch 1.
- **Sources.** The base series for every symbol is CNBC's *unadjusted* bars, which are as-traded. The
  corroborating vendors are:
  - Nasdaq: the historical API (10 years) and the chart API (back to 1990), both split-adjusted and
    converted back. This is the second vendor for the full depth.
  - Cboe (2004 onward).
  - stockanalysis.com (5 years).
- **SPY.** The 1,909 batch-1 rows (2019-03-01 onward) are kept byte for byte. The CNBC-based rebuild
  agrees with all 1,909 of their closes. The batch-1 action rows are all present unchanged.
- **Unconfirmed closes.** These are concentrated in **Nov 1999 – Sep 2000 for the NYSE/AMEX names**
  (JPM, KO, SPY), where CNBC and Nasdaq disagree and no third keyless vendor exists. Details are in §4.4.
- **"Confirmed by ≥1 other vendor"** is computed mechanically. On a few flagged rows after 2004 (e.g.,
  NVDA 2010-11-26), Cboe's coarse split-adjusted value fits both candidates. Those rows are counted as
  confirmed there but stay flagged.

New in this batch: SPY made **capital-gain distributions** in the 1990s. They were not zero. See §5.3.

## 1. Depth decisions

| Symbol | Start | Why there and not earlier |
|---|---|---|
| AAPL, MSFT, KO | 1990-01-02 | First session covered by a second independent vendor (the Nasdaq chart API). CNBC alone goes back to 1980 (AAPL, KO) and 1986 (MSFT IPO), but before 1990 nothing independent corroborates it. |
| JPM | 1992-01-02 | Prices are two-vendor from 1990. However, Chemical Banking's 1991 dividends as listed (4 × $0.25) do not reconcile with its 10-K total ($1.05). The total is restated for the 1991 Manufacturers Hanover pooling and Class B stock, so 1991 cannot be confirmed. Every year from 1992 reconciles. |
| NVDA, AMZN, NFLX, GOOGL, TSLA, META, UBER, ABNB | IPO day | Both vendors start on the IPO date. |
| SPY | 1993-01-29 | Inception. |

Tenures that start before these dates should be marked "price history incomplete".

## 2. Sources and retrieval

Raw responses are saved untouched under `data/raw/prices/<source>/`, with a `*_headers.txt` beside
most files and a `retrieval_log.txt` in each folder. There were about 175 requests in total, spaced at
least 3 s apart for market-data hosts and 1 s apart for SEC.

| Source | Endpoint template | What it gives | Coverage used | Adjustment | Raw files |
|---|---|---|---|---|---|
| **CNBC** timeseries | `ts-api.cnbc.com/harmony/app/bars/{SYM}/1D/19800101000000/20261003000000/{unadjusted\|adjusted}/EST5EDT.json` | Daily OHLCV, 4-dp strings | Back to 1980 (KO, JPM, AAPL), 1986 (MSFT), and each IPO | `unadjusted` = as-traded. `adjusted` = split-only (no dividends). | `cnbc/{SYM}_20261004[_unadjusted].json`, SPY as `SPY_full_…`; Class C context `GOOG_classC_201404_…` |
| **Nasdaq** chart API | `api.nasdaq.com/api/quote/{SYM}/chart?assetclass=stocks&fromdate=1980-01-01&todate=2026-10-03` (`etf` for SPY) | Daily OHLCV, split-adjusted floats (about 9 significant digits) | **From 1990-01-02**, or the IPO. Complete, with no missing sessions. | Split-adjusted only | `nasdaq_chart/{SYM}_20261004.json` |
| Nasdaq historical API | `api.nasdaq.com/api/quote/{SYM}/historical?assetclass=stocks&fromdate=1980-01-01&limit=9999&todate=2026-10-03` | Daily OHLCV | **Capped at 10 years** (from 2016-10-03) | **Split-adjusted.** Batch 1 could not see this because LYFT and SPY never split. | `nasdaq/{SYM}_20261004.json`, `nasdaq/SPY_full_20261004.json` |
| Nasdaq dividends | `api.nasdaq.com/api/quote/{SYM}/dividends?assetclass=stocks` | Ex, declaration, record and pay dates; cash amount as declared | Nasdaq-listed names only. NYSE names return "not available". | As declared | `nasdaq/{SYM}_dividends_20261004.json` |
| **Cboe** delayed quotes | `cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/{SYM}.json` | Daily OHLCV, 2-dp | 2004-01-02 onward. GOOGL is incomplete. | Split-adjusted, and partly dividend-adjusted in some periods (e.g., MSFT 2006–2009 ×0.9942) | `cboe/{SYM}_20261004.json`; `_SPX` reused from batch 1 |
| **stockanalysis.com** | `stockanalysis.com/api/symbol/s/{sym}/history?range=Max&period=daily`; `/stocks/{sym}/dividend/`; `/stocks/{sym}/statistics/` | OHLCV plus **adjusted close `a`**; 5-year dividend table; "last split" statement | 2021-10-04 onward | Split-adjusted. `a` is total-return adjusted. | `stockanalysis/{SYM}_20261004.json`, `*_dividend_page_*.html`, `*_statistics_page_*.html` |
| **SEC EDGAR** (company filings) | `data.sec.gov/api/xbrl/companyconcept/CIK…/us-gaap/CommonStockDividendsPerShare{Declared,CashPaid}.json`; KO via `companyfacts`; selected 10-K, 8-K and N-30D full-text filings | Dividends per share by quarter and year (XBRL, 2008+); 10-K dividend totals; quarter-end and year-end prices; SPDR annual reports | Filings from 1994 on | As filed | `sec/` (39 saved responses; the ones used are cited in §5 and §7) |
| **Microsoft IR** | `cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/Microsofts-Dividend-History` (linked from the IR page) | Every dividend since 2003, with announcement, ex, record and payable dates | 2003–2026 | As declared | `ir/MSFT_dividend-history_20261004.xlsx` |
| **dividendhistory.org** | `dividendhistory.org/payout/{SYM}/` | Ex and pay dates, cash amounts | JPM back to 1984, KO back to 1962, SPY from 1995-06 | **Split-adjusted.** Converted back; AAPL amounts before 2000 are inconsistently scaled (§5.2). | `dividendhistory_org/{SYM}_20261004.html` |
| **State Street (SSGA)** workbook | (batch 1) | SPY distributions back to 1993, including ST and LT capital gains | 1993–2026 | As paid | `ssga/spdr-etf-historical-distributions_20261004.xlsx` (reused) |
| Coca-Cola IR | `investors.coca-colacompany.com/stock-info/share-history` | Split history (record dates) | — | — | `ir/KO_share-history_20261004.html` |

**Vendor independence.** FT (`markets.ft.com/.../get-historical-prices`, symbol id 36276 for AAPL) and
MarketWatch's CSV download both worked, but their values and volumes are identical to CNBC's to the
share (e.g., AAPL 1995-03-31 volume 183,243,383). They come from the same upstream as CNBC, so they are
**not used as corroboration** (raw files are in `ft/` and `marketwatch/`). Nasdaq's volumes differ
slightly from CNBC's (e.g., 103,868,468 vs 103,868,904 split-adjusted on AAPL 1995-01-03), which marks
it as a separate feed.

### Sources that failed or were not used
| Source | Result | Evidence |
|---|---|---|
| Yahoo chart API | One polite attempt: 429 again. No further tries. | `yahoo/failed/AAPL_20261004_batch2_attempt1_429*` |
| Macrotrends | 403 Cloudflare challenge. Not attempted further. | `macrotrends/failed/` |
| WSJ CSV download | 401 DataDome "enable JS" page | `wsj/AAPL_1995_20261004.csv` |
| StreetInsider dividend history | 403 Cloudflare challenge | `streetinsider/failed/` |
| Apple IR dividend page | 403 | `ir/failed/` |
| JPMorgan IR dividend history (`jpmorganchaseco.gcs-web.com`) | HTTP/2 reset, then a 180 s timeout; WebFetch also timed out | `ir/retrieval_log.txt` |
| Coca-Cola IR dividends / year-end pages | Data is loaded by a QuoteMedia widget behind an auth handshake. Not used. | `ir/KO_dividends_20261004.html` |
| Cboe `_SPXTR` | 403 | `cboe/failed/` |
| Stooq | Not tried (JS bot check, per batch 1) | — |

## 3. Method (`scripts/prices/build_batch2.py`)

1. **Calendar.** Expected sessions come from `exchange_calendars` XNYS. Every seed's dates equal that
   list exactly.
2. **Base: CNBC unadjusted bars.** These are native as-traded prices: fractions before 2001 (e.g.,
   41.2031 = 41 13/64, kept verbatim at CNBC's 4 dp) and cents after.
3. **Converting the split-adjusted vendors back.** Nasdaq, Cboe and stockanalysis are multiplied by
   the cumulative split factor from the verified split table (§5.1). Each vendor's agreement is tested
   against a local scale: the median vendor/base ratio over ±10 sessions within the same split
   interval. That scale absorbs vendor-specific factors without hiding day-level errors. Examples are
   Cboe's partial dividend adjustments and Nasdaq chart's 39.59 (instead of 40) factor for GOOGL before
   2014. A vendor's converted value is used *as a value* only when its scale is 1 to within 1e-4.
4. **Tolerances.**
   - Closes and other prices agree within $0.01 after decimalization (2001-04-09), the batch-1
     criterion. Before decimalization they must agree exactly, up to rounding.
   - The tolerance widens by the vendor's own rounding times the split factor. Examples: Cboe's 2 dp ×
     120 for NVDA in 2004; Nasdaq chart's relative 2e-5.
   - Before decimalization, a difference of up to 1/16 is published as `close_within_tick`.
5. **Close rule.**
   - The base close is kept when Nasdaq agrees.
   - When Nasdaq disagrees, a third vendor decides (Cboe from 2004, stockanalysis from 2021-10). If the
     third vendor sides with Nasdaq and Nasdaq's own row is internally consistent, Nasdaq's unsplit
     value replaces the base, snapped to its exact tick (1/256 grid before 2001, cents or half-cents
     after).
   - For SPY only, when no third vendor exists, the candidate whose day-over-day return matches the
     S&P 500 index (Cboe `_SPX`) is taken, if exactly one does.
   - Otherwise the base is kept and the row is flagged `close_unverified`.
   - Nothing is interpolated or filled. A close is never absent, because CNBC or Nasdaq has every
     session.
6. **Open/high/low rule.**
   - Same as the close rule, with one change: a two-vendor majority replaces the base only when the base
     value is missing or internally inconsistent, or when the difference is ≤ 1% (a methodology
     difference).
   - A large disagreement with a self-consistent base row is **nulled**. Two vendors can share a bad
     consolidated-tape print. Examples: TSLA 2021-03-01, where Nasdaq and Cboe show a high of 872 vs
     719; the NYSE opening glitch of 2023-01-24 (UBER low, KO high); and 2023-06-05 (UBER low, JPM
     high).
   - Any field left unconfirmed in a disagreement is nulled.
   - Where no second vendor publishes a field at all, the base value is kept and tagged `cnbc_only`.
     This applies to SPY's O/H/L for 1993–2000-05, where Nasdaq chart has zeros.
7. **Volume.**
   - CNBC's as-traded volume is used when it is within 5% of Nasdaq's unsplit volume.
   - Otherwise Nasdaq's volume is used if stockanalysis corroborates it.
   - Otherwise CNBC's volume is kept and tagged `volume=cnbc_unverified` (0–55 rows per symbol).
   - Batch 1's caveat applies: volume is not exact.
8. **`source` column.** The first token says where the close came from: `cnbc`, `nasdaq` (F = 1),
   `nasdaq;unsplit`, `nasdaq_chart;unsplit`, `cnbc;spx_adjudicated`, or `nasdaq_chart;spx_adjudicated`.
   It is followed by flags and field overrides:
   - `close_unverified` and `close_within_tick`
   - `open=null`, `low=nasdaq_chart_unsplit`, `high=cnbc_only`, `volume=nasdaq`
   - `adj_close=stockanalysis` for stocks, or `adj_close=calc_ssga_div` for SPY
9. **`adj_close`.**
   - Stocks: stockanalysis's vendor adjusted close where it exists (2021-10-04 onward, 1,255 rows).
     Earlier rows are empty, because no independent keyless adjusted close was reachable (Yahoo 429,
     Macrotrends 403).
   - SPY: the batch-1 recomputed series (close(E)/(close(E)+D) applied backward), now extended to 1993.
     It is unchanged on every batch-1 row.

## 4. Cross-vendor results

### 4.1 Coverage and calendar
- **CNBC.** All 13 series are missing **2023-04-06**, the known batch-1 defect; it is filled from
  Nasdaq historical, which Cboe and stockanalysis corroborate. All series except UBER and ABNB have
  **zero-volume rows on 2015-06-08 and 2015-06-09**; their prices are corroborated, and volume is taken
  from Nasdaq chart. There are also pre-IPO placeholder bars, which are excluded.
- **Nasdaq chart.** Exactly complete for every symbol from 1990 or the IPO: 9,256 AAPL sessions equals
  the XNYS count for 1990-01-02..2026-10-02.
- **Cboe.** Phantom rows on 2025-05-26 (all symbols) and 2018-11-22 (NYSE names). Most GOOGL rows
  before 2014 are missing.
- **stockanalysis.** Exactly 1,255 sessions.

### 4.2 Close corroboration (rows agreeing with the published close / rows the vendor covers)
| Symbol | Nasdaq hist (2016-10+) | Nasdaq chart | Cboe (2004+) | stockanalysis (2021-10+) |
|---|---|---|---|---|
| AAPL | 2,514/2,514 | 9,246/9,256 | 5,621/5,723 | 1,255/1,255 |
| MSFT | 2,514/2,514 | 9,247/9,256 | 5,706/5,723 | 1,255/1,255 |
| NVDA | 2,514/2,514 | 6,966/6,967 | 5,401/5,723 | 1,255/1,255 |
| GOOGL | 2,514/2,514 | 5,564/5,566 | 3,487/3,490 | 1,255/1,255 |
| AMZN | 2,514/2,514 | 7,387/7,392 | 5,693/5,723 | 1,255/1,255 |
| META | 2,514/2,514 | 3,614/3,614 | 3,613/3,613 | 1,255/1,255 |
| TSLA | 2,514/2,514 | 4,091/4,091 | 4,082/4,090 | 1,255/1,255 |
| NFLX | 2,514/2,514 | 6,129/6,130 | 5,560/5,723 | 1,255/1,255 |
| UBER | 1,860/1,860 | 1,860/1,860 | 1,859/1,859 | 1,255/1,255 |
| ABNB | 1,459/1,459 | 1,459/1,459 | 1,458/1,458 | 1,255/1,255 |
| JPM | 2,514/2,514 | 8,704/8,750 | 5,715/5,723 | 1,255/1,255 |
| KO | 2,514/2,514 | 9,200/9,256 | 5,720/5,723 | 1,255/1,255 |
| SPY | 2,513/2,514 | 8,438/8,477 | 5,707/5,723 | 1,255/1,255 |

Nasdaq chart shortfalls are the flagged rows in §4.4, plus the rows where a third vendor sided with
CNBC against Nasdaq (§4.3). For SPY they also include the batch-1 2026-04-20 row, the Nasdaq defect
found in batch 1.

The Cboe shortfalls come from its 2-dp rounding of tiny split-adjusted values in 2004–2007 (e.g.,
AAPL at $0.38) and its period-wise dividend adjustments. They are not seed errors.

### 4.3 Base values replaced (two vendors against CNBC)
Each item below lists the CNBC value, the replacement, and the source of the replacement.

- **AAPL 2011-08-16, -19, -23, -25.** CNBC's closes are stale (383.41, 376.18, 376.1812, 376.1812), and
  its 08-16 and 08-19 O/H/L are split-adjusted garbage (13.6257, 0.4619). Replaced with 380.48, 356.03,
  373.60 and 373.72 from Nasdaq chart, corroborated by Cboe.
- **2010-11-26 (Thanksgiving half-day), every symbol with data.** CNBC's close differs from Nasdaq and
  Cboe (e.g., AAPL 315.76 → 315.00, SPY 119.29 → 118.80). CNBC appears to use a later price.
- **2005-06-01.** MSFT 25.84 → 25.81. AMZN, NVDA and GOOGL remain flagged (see 4.4).
- **NFLX 2004-06-25.** The whole CNBC row (O 35.70 / C 35.95) contradicts Nasdaq and Cboe (31.27 /
  31.99). The next day's open of 32.04 confirms Nasdaq.
- **JPM 2009-03-24.** 26.22 → 26.40.
- **SPY.** 2005-02-03, 2009-07-16, 2012-01-20 and 2015-08-21.
- **SPY, adjudicated against the S&P 500 index.** 2000-04-14 kept CNBC (136.00 vs 138.375). 2000-09-21
  and 2000-09-28 took Nasdaq.
- **Kept CNBC against Nasdaq, with Cboe on CNBC's side.** MSFT 2007-05-01 and 2007-08-09, AMZN
  2007-05-01, JPM 2007-07-18, KO 2005-06-27, and SPY on three 2004–05 dates.
- **AMZN 1998-08-31.** CNBC 83.75 vs Nasdaq 105.89. Nasdaq's row repeats the prior day's H/L/C exactly,
  so it is stale. CNBC's −21% fits the 1998-08-31 crash and the 09-01 open of 76.13. The row stays
  flagged because no third vendor exists.
- **Other field-level defects.**
  - **GOOGL lows before 2014.** CNBC's lows equal the close on 2,208 of 2,360 days. Nasdaq chart cannot
    supply values because its pre-2014 scale is 39.59, not 40. **2,186 GOOGL lows (2004-08-19..
    2014-04-02) are null.**
  - **AAPL 2025-08-15 high.** CNBC 233.28 is below the open, so it is replaced with 234.28.
  - **Opens through 1991-11-08.** CNBC and Nasdaq chart both have 0 for every open, so AAPL, MSFT and
    KO opens are null through that date.

### 4.4 Closes we could not confirm (`close_unverified`)
Each entry is the published (CNBC) close vs Nasdaq's.

- **AAPL (9).**
  - 1990-08-24 35.75 vs 35.50
  - 1990-10-19 31.375 vs 28.50
  - 1991-02-08 60 vs 59.875
  - 1991-03-05 62.50 vs 63.125
  - 1991-03-14 65.25 vs 65.50
  - 1991-05-23 45.125 vs 45.50
  - 1992-08-21 44.75 vs 44.625
  - 1993-05-06 54 vs 53.75
  - 1994-10-27 42.75 vs 42.50
- **MSFT (7).**
  - 1990-07-17 77 vs 77.75
  - 1990-08-24 56 vs 57.25
  - 1991-03-05 112.001 vs 111.50
  - 1991-03-08 102.626 vs 102.50
  - 1994-09-07 56.875 vs 57.3125
  - 1996-09-12 128.625 vs 128.313
  - 2002-11-19 54.86 vs 54.83
- **NVDA 2010-11-26.** 13.64 vs 13.60. Cboe sits between them.
- **GOOGL.** 2005-06-01 287.23 vs 288.00 and 2005-09-14 302.09 vs 303.00. Cboe ×40 cannot decide at
  ±$0.20.
- **AMZN.** 1998-08-31 (above), 1999-02-25 125 vs 124.25, and 2005-06-01 36.64 vs 36.50.
- **NFLX 2003-05-30.** 22.50 vs 22.45.
- **JPM (34), KO (40), SPY (23).** Except JPM 1992-01-22, KO 1991-01-11, SPY 1997-03-31, SPY
  1999-02-11, SPY 2003-04-29 and SPY 2015-10-20, all fall in **1999-11-02..2000-09-28**. In that span
  CNBC and Nasdaq disagree on NYSE/AMEX closes by 1/16 to $3.25. A third source, TheStreet (search
  snippet), gives a third value for JPM on 2000-09-12: CNBC 52.8125, Nasdaq 56.0625, TheStreet 53.75.
  No keyless vendor covers 1999–2000 NYSE data independently. These rows keep CNBC's value. The full
  list, with both values and Cboe/stockanalysis estimates where they exist, is in
  `verification_batch2_20261004.json` under `symbols.<SYM>.prices.unverified`.
- **Effect on returns.** A wrong close on one day cancels out the next day in a compounded index, so it
  changes only tenures anchored exactly on that date. Treat tenure anchors on flagged dates as
  approximate.

### 4.5 SPY vs the S&P 500 index (sanity)
- **Daily tracking.** Daily |SPY return (with distribution) − SPX return| has a median of 5 bp over
  8,474 days. There are 215 days above 50 bp before 2004 and 69 after.
- **Why gaps exceed 50 bp.**
  - SPY's AMEX close was at 4:15 pm against SPX's 4:00, which matters on days like 2008-10-13.
  - Thin 4:15 prints in 1999–2000: CNBC and Nasdaq both show SPY 2000-01-06 closing at its low of 137.75
    while SPX rose 0.1%.
  - Cboe's own `_SPX` defects, e.g. 2000-12-22, where close = open = the prior close.
- **Conclusion.** This test can adjudicate only gross SPY errors.

## 5. Corporate actions

`data/seed/prices/<SYM>_actions.csv`. Dividends are per share as declared, on the share basis at the
time, consistent with the raw closes.

### 5.1 Splits: 35 in window, all verified three ways
Each split was checked three ways:
- **Every vendor's implied factor.** The median of base/vendor over each split interval, compared
  before and after the split.
- **The raw ex-date move.** The table shows ratio × ex close / prior close − 1.
- **A primary source.** Primary-source URLs were found by a research pass and opened ("read") unless
  marked "snippet".

| Symbol | Ex-date | Ratio (from:to) | Implied by vendors | Prior close → ex close (move) | Primary source |
|---|---|---|---|---|---|
| AAPL | 2000-06-21 | 1:2 | CNBC adj 2.0, Nasdaq chart 2.0 | 101.25 → 55.625 (+9.9%) | Apple IR FAQ split list (read) https://investor.apple.com/faq/default.aspx; 10-K (snippet): record 2000-05-19 |
| AAPL | 2005-02-28 | 1:2 | 2.0 / 2.0 / Cboe 2.0001 | 88.99 → 44.86 (+0.8%) | https://www.apple.com/newsroom/2005/02/11Apple-Announces-Two-for-One-Stock-Split/ (record 2005-02-18) |
| AAPL | 2014-06-09 | 1:7 | 7.0 / 7.0 / 6.9997 | 645.57 → 93.70 (+1.6%) | https://www.apple.com/newsroom/2014/04/23Apple-Expands-Capital-Return-Program-to-Over-130-Billion/ (record 2014-06-02) |
| AAPL | 2020-08-31 | 1:4 | 4.0 ×4 vendors | 499.23 → 129.04 (+3.4%) | 8-K Ex. 99.1 https://www.sec.gov/Archives/edgar/data/320193/000032019320000060/a8-kexhibit991q3202062.htm (record 2020-08-24) |
| MSFT | 1990-04-16 | 1:2 | 2.0 / 2.0 | 120.75 → 60.75 (+0.6%) | Microsoft IR FAQ split table (payable dates; ex = next session) https://www.microsoft.com/en-us/investor/faq |
| MSFT | 1991-06-27 | 2:3 | 1.5 / 1.5 | 100.751 → 68.00 (+1.2%) | same |
| MSFT | 1992-06-15 | 2:3 | 1.5 / 1.5 | 112.50 → 75.75 (+1.0%) | same |
| MSFT | 1994-05-23 | 1:2 | 2.0 / 2.0 | 97.75 → 50.5625 (+3.5%; FAQ: 50.63) | same |
| MSFT | 1996-12-09 | 1:2 | 2.0 / 2.0 | 152.875 → 81.75 (+7.0%) | same + https://news.microsoft.com/source/1996/11/12/microsoft-announces-stock-split/ |
| MSFT | 1998-02-23 | 1:2 | 2.0 / 2.0 | 155.125 → 81.625 (+5.2%) | same + https://news.microsoft.com/source/1998/01/26/microsoft-announces-2-for-1-stock-split/ |
| MSFT | 1999-03-29 | 1:2 | 2.0 / 2.0 | 178.125 → 92.375 (+3.7%) | same + https://news.microsoft.com/source/1999/01/25/microsoft-announces-2-for-1-common-stock-split/ |
| MSFT | 2003-02-18 | 1:2 | 2.0 / 2.0 | 48.30 → 24.96 (+3.4%) | same + https://news.microsoft.com/source/2003/01/16/microsoft-declares-annual-dividend-and-announces-two-for-one-split-on-common-stock/ |
| NVDA | 2000-06-27 | 1:2 | 2.0 / 2.0 | 165.9375 → 71.25 (−14.1%; both vendors) | FY2001 10-Q note (snippet): record 2000-06-12, delivery about 2000-06-26 |
| NVDA | **2001-09-17** | 1:2 | 2.0 / 2.0 | 75.76 (09-10) → 33.99 (−10.3%) | 10-Q https://www.sec.gov/Archives/edgar/data/0001045810/000101287001502932/d10q.txt (record 2001-08-28, distributed 2001-09-17). Many sites show 09-12, but markets were closed 09-11..09-14. |
| NVDA | 2006-04-07 | 1:2 | 2.0 / 2.0 | 61.22 → 30.53 (−0.3%) | https://www.sec.gov/Archives/edgar/data/0001045810/000104581006000010/pressrelease.htm (snippet; record 2006-03-17) |
| NVDA | 2007-09-11 | 2:3 | 1.5 / 1.5 | 50.79 → 34.58 (+2.1%) | https://www.sec.gov/Archives/edgar/data/0001045810/000104581007000042/exhibit.htm (record 2007-08-20) |
| NVDA | 2021-07-20 | 1:4 | 4.0 ×4 vendors | 751.19 → 186.12 (−0.9%) | https://www.sec.gov/Archives/edgar/data/1045810/000104581021000056/pr-may2021.htm (record 2021-06-21) |
| NVDA | 2024-06-10 | 1:10 | 10.0 ×5 vendors | 1208.88 → 121.79 (+0.7%) | 8-K https://www.sec.gov/Archives/edgar/data/1045810/000104581024000113/nvda-20240522.htm (record 2024-06-06) |
| GOOGL | 2014-04-03 | 1:2 (see caveat) | CNBC adj 1.998, Nasdaq chart 1.980, Cboe 2.000 | 1135.10 → 571.50 (+0.7%) | Nasdaq notice https://nasdaqtrader.com/TraderNews.aspx?id=fpnews2014-14 (record 2014-03-27, payment 2014-04-02, ex 2014-04-03); ticker notice https://www.nasdaqtrader.com/MicroNews.aspx?id=OTA2014-08 |
| GOOGL | 2022-07-18 | 1:20 | 20.0 ×5 vendors | 2235.55 → 109.03 (−2.5%) | 8-K https://www.sec.gov/Archives/edgar/data/1652044/000119312522167375/d294315d8k.htm (record 2022-07-01) |
| AMZN | 1998-06-02 | 1:2 | 2.0 / 2.0 | 85.625 → 43.6875 (+2.0%) | https://press.aboutamazon.com/1998/4/amazon-com-announces-two-for-one-split-of-common-shares |
| AMZN | 1999-01-05 | 1:3 | 3.0 / 3.0 | 354.9375 → 124.50 (+5.2%) | https://press.aboutamazon.com/news-releases/news-release-details/amazoncom-announces-3-1-stock-split/ |
| AMZN | 1999-09-02 | 1:2 | 2.0 / 2.0 | 119.0625 → 60.0625 (+0.9%) | https://press.aboutamazon.com/1999/7/amazon-com-announces-2-for-1-stock-split |
| AMZN | 2022-06-06 | 1:20 | 20.0 ×5 | 2447.00 → 124.79 (+2.0%) | 8-K https://www.sec.gov/Archives/edgar/data/1018724/000101872422000009/amzn-20220309.htm |
| TSLA | 2020-08-31 | 1:5 | 5.0 ×4 | 2213.40 → 498.32 (+12.6%, widely reported) | https://www.globenewswire.com/news-release/2020/08/11/2076760/0/en/Tesla-Announces-a-Five-for-One-Stock-Split.html |
| TSLA | 2022-08-25 | 1:3 | 3.0 ×5 | 891.29 → 296.07 (−0.4%) | 8-K Ex. 99.1 https://www.sec.gov/Archives/edgar/data/1318605/000156459022028207/tsla-ex991_6.htm |
| NFLX | 2004-02-12 | 1:2 | 2.0 / 2.0 / Cboe 1.998 | 71.96 → 37.30 (+3.7%) | 8-K Ex. 99.1 https://www.sec.gov/Archives/edgar/data/0001065280/000119312504006813/dex991.htm |
| NFLX | 2015-07-15 | 1:7 | 7.0 / 7.0 / 6.998 | 702.60 → 98.13 (−2.2%) | https://www.sec.gov/Archives/edgar/data/1065280/000106528015000027/a991pressreleaseforstocksp.htm |
| NFLX | 2025-11-17 | 1:10 | 10.0 ×5 | 1112.17 → 110.29 (−0.8%) | 8-K Ex. 99.1 https://www.sec.gov/Archives/edgar/data/1065280/000106528025000407/ex991_q425stocksplit.htm (record 2025-11-10) |
| JPM | 1998-06-15 | 1:2 | 2.0 / 2.0 | 138.875 → 68.1875 (−1.8%) | Chase FY1999 10-K: "two-for-one ... effective as of the close of business on May 20, 1998" (`sec/JPM_10K_FY1999…`); IR split history (snippet): payable 1998-06-12, ex 06-15 |
| JPM | 2000-06-12 | 2:3 | 1.5 / 1.5 | 73.3125 → 48.5859 (−0.6%) | IR split history (snippet): record 2000-05-17, payable 06-09, ex 06-12; https://www.sec.gov/Archives/edgar/data/19617/000095012300007613/ex27.txt |
| KO | 1990-05-14 | 1:2 | 2.0 / 2.0 | 83.25 → 42.00 (+0.9%) | Coca-Cola IR share history (`ir/KO_share-history…`: "Two-for-one stock split effective May 1" in 1990) |
| KO | 1992-05-12 | 1:2 | 2.0 / 2.0 | 85.375 → 42.875 (+0.4%) | same, 1992 |
| KO | 1996-05-13 | 1:2 | 2.0 / 2.0 | 83.875 → 43.00 (+2.5%) | same; FY1996 10-Q (snippet): record 1996-05-01 |
| KO | 2012-08-13 | 1:2 | 2.0 ×3 | 78.79 → 39.30 (−0.2%) | 8-K Ex. 99.1 https://www.sec.gov/Archives/edgar/data/0000021344/000110465912048265/a12-16159_1ex99d1.htm (record 2012-07-27) |

No splits: META, UBER and ABNB. stockanalysis reports "no record of stock splits" for all three, all
vendors show factor 1 throughout, and no day-over-day ratio is near a split ratio. Airbnb's 2020-10-26
2-for-1 split was before its IPO. stockanalysis's "last split" statements match the table for all 9
splitting names.

**Continuity.**
- **META.** The CNBC and Nasdaq series run unbroken from the FB IPO on 2012-05-18; first close 38.2318,
  reported as $38.23. Meta's ticker became META before the open on 2022-06-09
  ([8-K Ex. 99.1](https://www.sec.gov/Archives/edgar/data/1326801/000132680122000070/may312022-exhibit991.htm)).
  The 2022-06-08 close was 196.64 and the 06-09 close 184.00, both matching public reports.
- **GOOGL.** The seed is the original Class A stock from the 2004 IPO (ticker GOOG until 2014-04-02,
  GOOGL from 2014-04-03). The 2015 Class C adjustment payment went only to Class C (GOOG) holders and
  is not a GOOGL action.
- **JPM.** The seed is the Chemical Banking → Chase Manhattan (CMB, 1996) → J.P. Morgan Chase (JPM,
  2001) security.
  - It is one SEC registrant throughout, CIK 19617
    ([1996 8-K](https://www.sec.gov/Archives/edgar/data/19617/0000950123-96-001547.txt);
    [2000 merger 8-K](https://www.sec.gov/Archives/edgar/data/19617/000095012301000064/y44093e8-k.txt)).
  - It is not the old J.P. Morgan & Co. stock (CIK 68100), which traded around $180 in 2000.
  - The level confirms it: 1995-01-03 close 36.25, matching Chemical's price at the time.
  - The FY1995/1999 10-K year-end prices match (§7).

**GOOGL 2014 caveat.** Alphabet calls the April 2014 Class C distribution a stock split effected as a
dividend: one Class C share for each Class A share. The seed records it as 1:2. On the ex-date,
however, Class C closed at 569.74 against Class A's 571.50
(`cnbc/GOOG_classC_201404_20261004_unadjusted.json`). The value-preserving ratio is therefore
1 + 569.74/571.50 = 1.996919, and vendors use about 1.998. Using 2.0 adds **+0.154%** to the GOOGL TR on
2014-04-03 (0.696% vs 0.541% for the day), and so to every tenure spanning that date. Change the action
to split_from=1,000,000 / split_to=1,996,919 if exact economic TR is preferred over the company's
characterization.

### 5.2 Dividends

| Symbol | Base list | Count in window | Amount corroboration | Ex-date corroboration | Notes |
|---|---|---|---|---|---|
| AAPL | Nasdaq dividends | 81 (1990-02-16..2026-08-10) | **69 of 81 have ≥ 2 sources**: Nasdaq, SEC XBRL quarterly/FY (2012+, 16/16 FY totals), 10-K totals for 1993, 1994 and 1995 (4/4), dividendhistory.org, stockanalysis | 78 with ≥ 2 | Nasdaq lacks 2012-08-09, 2012-11-07 and 2013-05-09. Those come from dividendhistory.org (dates) and XBRL (amounts $2.65/$2.65/$3.05). Suspended after 1995-11-21 and resumed 2012-08-09. **The 12 dividends of 1990–1992** ($0.11, then $0.12) rest on Nasdaq's amounts alone, with dates confirmed by dividendhistory.org. Its pre-2000 AAPL amounts match Nasdaq only if un-split by 28 instead of 112, so they are not counted. |
| MSFT | Microsoft IR workbook | 91 + 1 special | All 92 have ≥ 2 sources (Nasdaq, dividendhistory.org, XBRL 19/19 FY, stockanalysis) | All ≥ 2 | Annual $0.08 (2003-02-19) and $0.16 (2003-10-15), then quarterly. **Special $3.00, ex 2004-11-15**, alongside the regular $0.08 on the same date. Nasdaq's list skips 2003–2013. |
| NVDA | Nasdaq dividends | 56 (2012-11-20..2026-09-10) | All ≥ 2 (XBRL 22/23 FY; the one mismatch is an XBRL tagging anomaly) | 53 with ≥ 2 | First three (2012-11-20, 2013-02-26, 2013-05-21, $0.075) come from dividendhistory.org plus XBRL. As declared: $0.16 → $0.04 after the 2021 split, $0.04 → $0.01 after 2024, **$0.25 from 2026-06-04**, which Nasdaq and XBRL 10-Q both confirm. |
| GOOGL | Nasdaq | 10 (2024-06-10..2026-09-04) | All ≥ 3 | All 3 | Nasdaq gives 2026-09-04's record date as 2026-09-07, which is Labor Day; kept as published. |
| META | Nasdaq | 11 (2024-02-21..2026-09-21) | All ≥ 3 | 10 with 3 | First dividend $0.50 ([8-K Ex. 99.1](https://www.sec.gov/Archives/edgar/data/1326801/000132680124000010/meta-12312023xexhibit991.htm)) |
| JPM | dividendhistory.org × split factor | 138 (1992-03-31..2026-07-06) | **All 138 have ≥ 2.** 10-K "cash dividends declared per share" totals match for every year 1992–2008 (19/19: FY1995, FY1996, FY1999, FY2004, FY2008 10-Ks), plus XBRL quarterly/FY 2009+ and stockanalysis 2021+. | **119 single-source**; 19 with 2 (stockanalysis 2021+) | **Added:** 1996-04-02 $0.56. Missing from dividendhistory.org. Record date 1996-04-04 and payable 1996-04-30 come from Chemical's 8-K (`sec/JPM_8K_19960319…`); the ex-date is record − 2 business days under T+3. **Dropped:** a $1.00 row on 2000-09-21, which is the old J.P. Morgan & Co. dividend; the FY2004 10-K's 2000 total of $1.28 excludes it. The XBRL CashPaid facts for JPM carry declared-basis values (7 FY mismatches); the Declared facts and the 10-Ks all agree. |
| KO | dividendhistory.org × split factor | 147 (1990-03-09..2026-09-15) | **All 147 have ≥ 2.** 10-K totals 1990–2008 (FY1999, FY2001, FY2004, FY2008 10-Ks; 19/19) plus XBRL FY 2007–2025 (19/19) plus stockanalysis | **127 single-source**; 20 with 2 | **Ex-date 2001-09-12 was not a session** (markets closed after 9/11). Kept as published; the pipeline applies it to 2001-09-17, the first ex-dividend session. |
| SPY | SSGA workbook | 136 + 2 special | 135 of 138 have ≥ 2 sources (dividendhistory.org from 1995-06, stockanalysis; SPDR annual reports' per-unit totals for 1993–1996 and FY2002–FY2006, 9/9) | 125 with ≥ 2 | 2012-09-21 ($0.77945) is SSGA-only, because dividendhistory.org has a gap. The SSGA pay date for 2006-06-16 (= ex-date, before the record date) is impossible and was dropped. |

Stocks with no cash dividends in the window (10-K dividend-policy text, from search snippets):
- TSLA FY2025 10-K: "We have never declared or paid cash dividends on our common stock."
- NFLX FY2025 10-K: "never declared or paid any cash dividends."
- AMZN FY2017 10-K: same wording. Nasdaq returns no dividend history, and stockanalysis shows "n/a".
- UBER FY2025 10-K: "never declared or paid cash dividends."
- ABNB FY2025 10-K: "do not anticipate declaring or paying any cash dividends." Nasdaq and stockanalysis
  show none.

Other notes:
- **Record dates** are given only where a source states them. Nasdaq's pre-2000 rows repeat the ex-date
  as the record date, which was impossible before T+1, so those were dropped. dividendhistory.org has
  no record dates, so most JPM and KO record dates before 2021 are empty.
- **Ex-date corroboration for JPM and KO before 2021** rests on dividendhistory.org alone. Their
  amounts are confirmed year by year by the companies' own 10-Ks. A wrong ex-date would move a
  dividend by days within the right year.

### 5.3 SPY distributions, including capital gains
- **136 income distributions.** They come from the SSGA workbook, as in batch 1. The batch-1 rows for
  2019 onward are unchanged.
- **Capital-gain distributions were not all zero.**
  - **1996-12-20:** SSGA lists ST $0.080000 + LT $0.040000. The SPDR Trust 1996 annual report shows
    $0.12 per unit "from net realized gains" (`sec/SPY_N30D_FY1996…`). This is written as
    **special_dividend 0.12** alongside the $0.28681 income dividend.
  - **1995-12-15:** SSGA lists no gain, but dividendhistory.org's total of 0.382 exceeds SSGA's income
    of 0.372000 by 0.010. The 1995 annual report shows $0.01 per unit from net realized gains, $128,321
    in total (`sec/SPY_N30D_FY1995…`). This is written as **special_dividend 0.01** (a manual row,
    documented in the script).
  - **1993:** the annual report shows $0.03 per unit from realized gains, $202,429 in total. SSGA lists
    none, and no source gives the date or exact per-unit amount. **It is omitted**, which understates
    SPY TR before 1994 by about 0.07% (0.03 on about $45).
  - **After 1996:** the SSGA ST/LT columns are blank or 0.000000 for every row. No later gains.
- 2004-11-15 ($0.35102) is a real extra distribution, the pass-through of MSFT's special dividend. It is
  kept as cash_dividend.

## 6. Total-return self-check

Method:
- The TR index is computed from raw closes and actions with the pipeline's own rule (split × (close +
  cash) / prior close; an action on a non-session date applies to the next session).
- It is rescaled to end at the last close and compared with stockanalysis `a` on the 1,255 overlapping
  rows.
- The same totals were reproduced by running the seeds through the pipeline's `read_bars_csv`,
  `read_actions_csv` and `build_indexes`. Script and pipeline TR agree to 0.01% on all 13 symbols.

| Symbol | Pipeline convention: max rel. / abs. deviation | Rows > 1 bp | Vendor (multiplier) convention: max rel. deviation | Worst day (pipeline convention) |
|---|---|---|---|---|
| AAPL | 0.82 bp / $0.0157 | 0 | 0.00004 bp | 2025-05-12 ex-date |
| MSFT | 0.90 bp / $0.0298 | 0 | 0.00002 bp | 2022-05-18 |
| NVDA | 0.26 bp / $0.0060 | 0 | 0.0004 bp | 2026-09-10 |
| GOOGL | 0.63 bp / $0.0120 | 0 | 0.00006 bp | 2025-03-10 |
| META | 2.06 bp / $0.1343 | 1,178 | 0.00005 bp | 2026-09-21 |
| JPM | 5.07 bp / $0.0774 | 1,065 | 0.00005 bp | 2025-04-04 (−8% day on the ex-date) |
| KO | 3.00 bp / $0.0174 | 865 | 0.0001 bp | 2021-11-30 |
| AMZN, TSLA, NFLX, UBER, ABNB | 0 (no dividends; splits only) | 0 | 0 to rounding | — |
| SPY | 0.013 bp / $0.0005 | 0 | 1.62 bp | (stockanalysis uses the pipeline convention for SPY) |

The two conventions differ on an ex-date by about (D/P) × (that day's return). For example, JPM on
2025-04-04: $1.40/$210 × 8% ≈ 5 bp. The multiplier-convention column shows that the closes, split
ratios and dates, and dividend amounts and dates all agree with an independent vendor's adjusted
history for 2021–2026.

Long-run totals (pipeline TR, first row to 2026-10-02):

| Symbol | Price return | Total return |
|---|---|---|
| AAPL | +100,231% | +128,140% |
| MSFT | +83,872% | +137,950% |
| NVDA | +570,292% | +623,398% |
| GOOGL | +13,593% | +13,725% |
| AMZN | +256,771% | +256,771% |
| META | +1,804% | +1,822% |
| TSLA | +23,169% | +23,169% |
| NFLX | +55,950% | +55,950% |
| UBER | +63.8% | +63.8% |
| ABNB | +12.2% | +12.2% |
| JPM | +4,166% | +11,500% |
| KO | +1,657% | +4,108% |
| SPY | +1,652% | +3,102% |

## 7. Spot checks against independent reporting and SEC filings

There are 142 checks in `verification_batch2_20261004.json` (`spot_checks`). **135 match** to the
cent, or to the printed precision. The 7 mismatches are listed below the table. Values marked
"snippet" came from search-result text rather than a page read.

| Symbol | Reference point (public value) | Seed | Source |
|---|---|---|---|
| AAPL | 1993–1996 quarterly price ranges in Apple's 10-Ks. FY1994 10-K closing ranges (FY1993 Q2..FY1994 Q4): 13/14 extremes exact. FY1995/FY1996 intraday ranges: 14/16 exact. | match except 3 (below) | `sec/AAPL_10K_FY1994`, `FY1995`, `FY1996` |
| AAPL | 1996-09-27 close 22.31 (proxy statement) | 22.3125 | [DEF 14A](https://www.sec.gov/Archives/edgar/data/0000320193/000091205796030278/0000912057-96-030278.txt) |
| AAPL | 2014-06-06 645.57; 2020-08-28 499.23; 2020-08-31 129.04 | same | [AppleInsider](https://appleinsider.com/articles/14/06/07/apple-increases-issued-shares-for-7-for-1-stock-split-in-official-sec-amendment), [Alpha Spread](https://www.alphaspread.com/security/nasdaq/aapl/investor-returns/i/stock-splits), Benzinga (snippet) |
| MSFT | 16 closes around all 8 splits, 1990–2003 (e.g., 1996-12-06 152.875, 2003-02-18 24.96) | 15/16. 1994-05-23 is 50.5625 vs FAQ 50.63, one tick (1/16) apart; both vendors give 50.5625. | [Microsoft IR FAQ](https://www.microsoft.com/en-us/investor/faq) |
| MSFT | 2000-09-15 64.1875; 2019-04-25 129.15 | same | [DEF 14A](https://www.sec.gov/Archives/edgar/data/789019/000095010900500097/ddef14a.htm), [AFP/phys.org](https://phys.org/news/2019-04-microsoft-tops-trillion-dollar.html) |
| NVDA | IPO 1999-01-22 close 19.69 (Bitget snippet; one blog says "$21 by day's end"); 2021-07-19 751.19; 2024-06-07 1,208.88; 2024-06-18 135.58 | 19.6875; same | [Alpha Spread](https://www.alphaspread.com/security/nasdaq/nvda/investor-returns/i/stock-splits), [Yahoo Finance article](https://finance.yahoo.com/news/nvidia-stock-rises-after-10-for-1-stock-split-204412528.html), [Al Jazeera](https://www.aljazeera.com/economy/2024/6/19/nvidia-becomes-worlds-most-valuable-company-dethroning-microsoft) |
| GOOGL | IPO open 100.00, close 100.34; 2014-04-02 1,135.10; 2014-04-03 571.50; 2022-07-15 2,235.55 | same | [Motley Fool](https://www.fool.com/investing/2019/11/25/if-you-invested-10000-in-googles-ipo-this-is-how-m.aspx), [AFP/phys.org](https://phys.org/news/2014-04-google-exits-stock-club-special.html) |
| AMZN | IPO close 23.50; six 1998–99 split-day closes; 2022-06-03 2,447 (122.35 split-adjusted); 2022-06-06 124.79 | same | [TechCrunch](https://techcrunch.com/?p=1509063), getsplithistory.com (secondary), [StatMuse](https://www.statmuse.com/money/ask/amazon-stock-price-june-2022) |
| META | IPO first trade 42.05, close 38.23; 2022-02-03 237.76; 2022-06-08 196.64; 2022-06-09 184.00 | same (close 38.2318) | [TechCrunch](https://techcrunch.com/2012/05/18/facebook-share-open-10-5-higher-at-42), [CBS/AP](https://www.cbsnews.com/newyork/news/facebook-to-make-stock-market-debut/), [Decrypt](https://decrypt.co/102484/facebook-stock-falls-stock-symbol-change-meta) |
| TSLA | IPO open 19.00, close 23.89, low 17.55; 2020-08-28 2,213.40; 2020-08-31 498.32; 2022-08-24 891.29; 2022-08-25 296.07 | same; low 17.54 | [AP/NBC](https://www.nbcnews.com/id/wbna38000234), [Teslarati](https://www.teslarati.com/tesla-tsla-stock-price-adjustment-5-to-1-split/), [Fool](https://www.fool.com/investing/2020/09/06/why-tesla-shares-skyrocketed-in-august/) |
| NFLX | IPO close 16.75, high 17.40; 2025-11-14 1,112.17 (111.22 split-adjusted); 2025-11-17 110.29 | same | CNNMoney (snippet), [StatMuse](https://www.statmuse.com/money/ask/netflix-stock-price-november-2025) |
| UBER | IPO open 42.00, close 41.57; record close 100.10 on 2025-10-06 | same | [Gulf News](https://gulfnews.com/business/markets/ubers-ipo-joins-ranks-of-wall-street-flops-1.63896775), [StatMuse](https://www.statmuse.com/money/ask?q=uber+stock+price+history+all-time+high) |
| ABNB | IPO open 146.00, high 165.00, close 144.71; record close 216.84 on 2021-02-11 (snippet) | same | [Al Jazeera](https://www.aljazeera.com/economy/2020/12/10/travelling-far-and-wide-airbnbs-ipo-smashes-records) |
| JPM | 1998–1999 quarter-end closes and 1992–1997 year-end prices from the FY1995 and FY1999 10-Ks (14 values, restated for splits) | 14/14 | `sec/JPM_10K_FY1995`, `FY1999` |
| KO | 1998–1999 quarter-end closes; 1990–2004 year-end prices from the FY1999, FY2001 and FY2004 10-Ks (20 values); split-day closes 1996 and 2012 (secondary) | 24/24 | `sec/KO_10K_*`, getsplithistory.com |
| SPY | Inception 1993-01-29: open 43.96875, close 43.9375, volume 1,003,200 (snippet of a dataset; the SEC FWP says "just over 1 million shares") | 43.9688 (CNBC 4-dp), 43.9375, 1,003,200 | — |

Mismatches (7):
1. **AMZN IPO open.** Seed 29.25, where CNBC and Nasdaq agree, vs "$27" in a search snippet of an MIT
   Sloan case. Not resolved; the seed keeps the two-vendor value.
2. **JPM 2000-09-12.** Already flagged unverified (§4.4).
3. **JPM 2026-08-12 "record close $365.31"** (snippet) vs seed 365.18. Nasdaq and stockanalysis also
   give 365.18, and so does Macrotrends: on that date the adjusted and raw closes coincide, because the
   next ex-date is 2026-10-06. The snippet is likely an intraday figure.
4. **MSFT 1994-05-23.** One tick apart (above).
5. **AAPL 10-K extremes, three quarters.**
   - FY1994 Q1 lowest close 22.50 vs 22.625.
   - FY1995 Q2 high 48 vs 48.0625.
   - FY1996 Q1 low 31.44 vs 31.625.
   - These are 1/16–3/16 differences in quarterly extremes. The other 27 of 30 extremes match exactly.

## 8. Caveats and open items
- **Licensing.** None of the vendor back-ends (CNBC, Nasdaq, Cboe, stockanalysis, dividendhistory.org)
  is licensed for display. SEC filings, the SSGA workbook and the Microsoft workbook are public
  documents. The seeds are for local prototyping only, as the `.gitignore` already states.
- **Before 2004 there are only two independent vendors** (CNBC and Nasdaq). Where they disagree, no
  third keyless source exists, and the rows are flagged rather than resolved. Most such rows fall in
  Nov 1999 – Sep 2000 for NYSE/AMEX names. A licensed feed such as CRSP or ICE should settle them.
- **GOOGL lows for 2004-08-19..2014-04-02 are null.** No exact second source exists for that range.
- **Opens through 1991-11-08** for AAPL, MSFT and KO are null: neither vendor publishes them. A few
  hundred more O/H/L values are null where the vendors conflict. SPY's 1993–2000 O/H/L are CNBC-only
  (`cnbc_only`). Returns use closes only.
- **Volume** is CNBC's as-traded consolidated volume. Vendors differ by up to several percent before
  2016, and some rows carry `volume=cnbc_unverified`. Do not treat volume as exact.
- **`adj_close` is empty before 2021-10-04 for the 12 stocks.** No independent keyless adjusted close
  was reachable. stockanalysis's values use the multiplier convention, so the pipeline's TR index will
  differ from them by up to 5 bp on ex-dates (§6). Any validation threshold should allow for that.
- **Single-source items.**
  - JPM and KO ex-dates before 2021 (dividendhistory.org; amounts confirmed by 10-K annual totals).
  - AAPL's 12 dividend amounts in 1990–1992 (Nasdaq; dates confirmed by dividendhistory.org).
  - SPY 2012-09-21 (SSGA).
  - The SPY 1995 capital gain amount (dividendhistory.org total; magnitude confirmed by the annual
    report).
- **Known omission.** SPY's 1993 realized-gain distribution of about $0.03 is missing (§5.3).
- **GOOGL 2014.** Recorded as 1:2, which is +0.154% in TR versus a value-preserving 1.996919 (§5.1).
- **MANUAL rows** are in `MANUAL_DIVIDENDS` in the script, each with its justification:
  - JPM 1996-04-02 added (8-K)
  - JPM 2000-09-21 dropped
  - SPY 1995-12-15 capital gain added

## 9. Reproduce
```
uv run --no-project --with exchange_calendars python scripts/prices/build_batch2.py 20261004
```
The script reads only the raw files above. It rewrites the 13 `<SYMBOL>.csv` and `<SYMBOL>_actions.csv`
seeds, keeping the SPY batch-1 rows from 2019-03-01 onward byte for byte. It also writes the full report
to `data/raw/prices/verification_batch2_20261004.json`, which contains:
- calendars per vendor
- every override, conflict, unverified and nulled value
- vendor split factors by interval
- dividend cross-checks per row
- XBRL and 10-K totals
- TR checks in both conventions
- spot checks

The script takes SPY's batch-1 rows from the existing `SPY.csv`, so that file must be present.
`scripts/prices/verify_prices.py` (batch 1, unchanged) regenerates it from the batch-1 raw files, but
writes only the 2019+ subset, so rerun `build_batch2.py` after it. Running `build_batch2.py` twice
produces byte-identical seeds.
