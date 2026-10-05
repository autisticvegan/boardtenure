# Price data verification, batch 3: WMT, COST, CRM, V, INTC, ORCL

Retrieved 2026-10-05 19:57–21:05 UTC (a Monday, during the session). Every request was bounded at
2026-10-03 or filtered to it, so the seeds end on the last completed session, Friday 2026-10-02; no
vendor returned a partial 2026-10-05 bar. Raw files carry the suffix `_20261005` (the retrieval date);
batch 2's files keep `_20261004`. Batch 2 is in
[price-data-verification-batch2.md](price-data-verification-batch2.md). This batch uses its method
unchanged, plus the additions in §3.

**Status: prototype only.** Every vendor below was reached without an API key, and none of them
grants a license for redistribution or public display. SEC filings and company IR pages are public
documents.

## TL;DR

| Symbol | Seed range | Rows | Splits | Cash / special dividends | Max TR deviation vs stockanalysis adj. close (2021-10-04..2026-10-02) | Closes confirmed by ≥1 other vendor | Unconfirmed closes (flagged) | Base source |
|---|---|---|---|---|---|---|---|---|
| WMT | 1990-01-02..2026-10-02 | 9,256 | 4 | 147 / 0 | 0.71 bp ($0.003) | 9,148 | 84 + 24 within one tick | CNBC unadjusted |
| COST | 1993-10-22 (first PriceCostco session)..2026-10-02 | 8,292 | 1 | 90 / 5 | 3.60 bp ($0.203) | 8,292 | 0 | CNBC unadjusted |
| CRM | 2004-06-23 (IPO)..2026-10-02 | 5,606 | 1 | 11 / 0 | 3.35 bp ($0.104) | 5,606 | 0 | CNBC unadjusted |
| V | 2008-03-19 (IPO)..2026-10-02 | 4,665 | 1 | 73 / 0 | 1.08 bp ($0.024) | 4,665 | 0 | CNBC unadjusted |
| INTC | 1990-01-02..2026-10-02 | 9,256 | 5 | 128 / 0 | 6.08 bp ($0.023) | 9,242 | 12 + 2 within one tick | CNBC unadjusted |
| ORCL | 1990-01-02..2026-10-02 | 9,256 | 7 | 69 / 0 | 3.67 bp ($0.062) | 9,245 | 11 | CNBC unadjusted |

Notes on the table:
- **Row counts.** Every seed has exactly one row per XNYS session in its range (`exchange_calendars`
  4.x, checked by the build script).
- **TR deviation** uses the pipeline's convention (one share is worth split × (close + dividend) /
  prior close). Recomputed with stockanalysis's own multiplier convention (1 − D / prior close), our
  closes and actions reproduce its adjusted close for all six symbols to ≤ 0.0003 bp (≤ $0.000002).
  So the residual is the convention difference on ex-dates, as in batch 2, not a data difference.
- **The pipeline's own code** (`read_bars_csv`, `read_actions_csv`, `build_indexes`) gives the same
  total returns as the build script to 1e-14 for all six symbols (§6).
- **Unconfirmed closes** for WMT are concentrated in **1999-10-29..2000-09-28** (74 of 84, plus 23 of
  the 24 within-tick rows). It is the same NYSE-era CNBC/Nasdaq disagreement batch 2 found for JPM, KO
  and SPY. INTC and ORCL (Nasdaq-listed then) have only scattered flags.
- **Dividend amounts.** Every dividend row has at least two agreeing sources. Twenty-one vendor
  amounts were corrected from the companies' own filings, and eight WMT amounts for 1991–1992 are
  inferred (§5.2).

What was asked about specifically:
- **Walmart moved from the NYSE to Nasdaq.** The NYSE listing ended at the close on 2025-12-08 and
  Nasdaq trading began on 2025-12-09, under the same symbol. The series is continuous in every vendor.
- **Costco's special dividends.** There are five ($7, $5, $7, $10, $15), each confirmed by its 8-K.
- **Oracle's 2006 holding-company reorganization** was a 1:1 share exchange, so the ORCL series is
  continuous. Oracle also moved from Nasdaq to the NYSE on 2013-07-15. CNBC is missing that week, and
  it was filled from Nasdaq and confirmed by Cboe.

## 1. Depth decisions

| Symbol | Start | Why there and not earlier |
|---|---|---|
| WMT, INTC, ORCL | 1990-01-02 | The first session covered by the second independent vendor (the Nasdaq chart API), as in batch 2. CNBC alone goes back to 1980 (WMT, INTC) and 1986 (ORCL). |
| COST | 1993-10-22 | **Both vendors start here.** It is the first trading day of Price/Costco, Inc. ("PCCW"), which was formed by the 1993-10-21 merger of Costco Wholesale Corp. and The Price Company. The pre-merger Costco stock (Nasdaq "COST", 1985–1993) is in no keyless vendor. Costco holders received one PriceCostco share per Costco share (FY1994 10-K, `sec/COST_10K_FY1994…`), so a licensed feed could extend the series 1:1. **Tenures before 1993-10-22 must be marked "price history incomplete."** |
| CRM | 2004-06-23 | IPO day (NYSE). |
| V | 2008-03-19 | IPO day (NYSE). CNBC has a placeholder bar on 2008-03-18 (44.00, zero volume) at the IPO price; it is excluded. |

Dividend history needs no extra depth cut.
- **COST** paid no dividend before 2004. Its FY1999 10-K says it "does not pay regular dividends",
  and its FY2000 10-K that it "has never paid regular dividends."
- **ORCL** paid none before 2009. Its 10-Ks for FY1994–FY2001 say it "has not paid dividends."
- **INTC** paid its first in Q4 1992; the FY1993 10-K shows nothing declared or paid before 1992 Q3.
- **CRM** paid its first in 2024 (8-K of 2024-02-28).
- **V** paid its first in 2008.
- **WMT** has paid every year in the window.

## 2. Sources and retrieval

There were about 190 logged requests, spaced ≥3 s apart for market-data hosts and ≥0.3 s apart for SEC, the
EDGAR limit being 10 per second. Each was logged in `data/raw/prices/<source>/retrieval_log.txt`, with
a `*_headers.txt` beside each body. A logging quirk: the first lines of this batch, 19:57–20:02 UTC,
record curl's compressed transfer size. A note line in each log says so, and later lines record the
on-disk size.

| Source | Endpoint | Used for | Files |
|---|---|---|---|
| **CNBC** timeseries | `ts-api.cnbc.com/harmony/app/bars/{SYM}/1D/19800101000000/20261003000000/{unadjusted\|adjusted}/EST5EDT.json` | Base series (as-traded); the `adjusted` series is used only as split-factor evidence | `cnbc/{SYM}_20261005[_unadjusted].json` |
| **Nasdaq** chart API | `api.nasdaq.com/api/quote/{SYM}/chart?assetclass=stocks&fromdate=1980-01-01&todate=2026-10-03` | Second vendor for the full depth (split-adjusted, converted back) | `nasdaq_chart/{SYM}_20261005.json` |
| Nasdaq historical API | `…/historical?assetclass=stocks&fromdate=1980-01-01&limit=9999&todate=2026-10-03` | Second vendor, 2016-10-03 onward | `nasdaq/{SYM}_20261005.json` |
| Nasdaq dividends | `…/dividends?assetclass=stocks` | As-declared amounts and dates. Works for the Nasdaq-listed names (COST, INTC, and **WMT since its move to Nasdaq**); V, CRM and ORCL return "Non-Nasdaq symbols is not available". | `nasdaq/{SYM}_dividends_20261005.json` |
| **Cboe** delayed quotes | `cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/{SYM}.json` | Third vendor, 2004 onward (2 dp) | `cboe/{SYM}_20261005.json` |
| **stockanalysis.com** | `/api/symbol/s/{sym}/history?range=Max&period=daily`, `/stocks/{sym}/dividend/`, `/stocks/{sym}/statistics/` | Fourth vendor, 2021-10-04 onward; adjusted close `a`; "last split" statements | `stockanalysis/…_20261005.*` |
| **dividendhistory.org** | `/payout/{SYM}/` | Dividend ex-dates and amounts (split-adjusted, except INTC) | `dividendhistory_org/{SYM}_20261005.html` |
| **dividendhistory.net** (new) | `/{sym}-dividend-yield` | Declaration, record and pay dates. Its amounts are **not used**: they are the same rounded figures as .org's, so the two share an upstream. | `dividendhistory_net/{SYM}_20261005.html` |
| **SEC EDGAR** | `data.sec.gov` submissions and XBRL companyconcept (Visa: companyfacts); full-submission `.txt` of 10-K, 10-Q, 8-K, 8-A12B, 25 and S-4/A filings; one EDGAR full-text search query | Splits, dividends, listing events and quarterly price ranges | `sec/` (113 batch-3 files; each one used is cited below) |
| **Company IR** | Walmart `stock.walmart.com/stock-data/stock-split-history` and FAQ; Intel `intc.com/stock-info/stock-splits` and dividends page | Split record and distribution dates | `ir/WMT_*`, `ir/INTC_*` |

**Failed or not used.**
- **Yahoo.** One polite attempt, the day after batch 2's: 429 again (`yahoo/failed/WMT_20261005_batch3_attempt1*`).
- **Walmart IR dividend page.** Its table is rendered by a QuoteMedia module, like Coca-Cola's in batch 2. Not pursued.
- **Intel IR dividends page.** It now shows buybacks only.
- **Stooq, Macrotrends, WSJ.** Not retried; batches 1 and 2 found bot checks there.

## 3. Method

This is `scripts/prices/build_batch3.py`. It is standalone: it copies batch 2's merge so that batch
2's configuration is untouched. The close, open/high/low and volume rules, the tolerances and the
`source` tags are batch 2's (its §3).

New in this batch:
1. **Zero-volume placeholder rows in Nasdaq chart are treated as "no data".** These are rows with
   volume 0 and open = high = low = close = the prior close. There are 6 for WMT, 4 for INTC and 5 for
   ORCL, all before 1997. CNBC has a normal bar with real volume on each of those days, and several
   are large moves:
   - ORCL 1990-03-28: CNBC −31%, 20.6M shares.
   - ORCL 1992-01-08: +11%.
   - INTC 1992-01-16: +9%.
   - WMT 1996-01-17: −9%.

   On those days CNBC is the only source, so the close is kept and flagged `close_unverified`, and its
   O/H/L is tagged `cnbc_only`.
2. **A systematically defective base field is treated as missing.** CNBC's ORCL low equals its close
   on every one of the 5,898 sessions from 1990-01-02 to 2013-05-10; from 2013-05-13 on it differs on
   most days. This is the defect batch 2 found in GOOGL's lows. For ORCL, Nasdaq chart's scale is
   exact (40.4999 for 40.5), so:
   - 2004–2013 lows come from Nasdaq chart where Cboe agrees: 2,363 rows, `low=nasdaq_chart`.
   - 1990–2003 lows come from Nasdaq chart alone, snapped to the 1/256 grid: 3,488 rows,
     `low=nasdaq_chart_only`. The mirror image of `cnbc_only`.
   - The 10-K quarterly price ranges (§7) confirm these lows: the ORCL FY1995/FY1997 tables are
     intraday extremes and match 32 of 32 (16 quarterly highs and 16 lows, FY1994–FY1997).
3. **Filing-sourced dividend amounts and dates** (`TENK_QUARTERLY`, `PRIMARY_DATES`).
   - A quarterly dividend printed in a 10-K or 10-Q on the as-declared basis replaces a differing
     vendor amount. It must match exactly; a restated amount must match to its printed precision.
   - Record and pay dates stated in 8-Ks or 10-Ks replace vendor dates.
4. **Settlement-rule check of every ex-date that has a record date.** Ex-date is the first session
   whose trades settle after the record date: T+5 before 1995-06-07, T+3 to 2017-09-04, T+2 to
   2024-05-27, then T+1. Columbus Day and Veterans Day count as non-settlement days.
5. **XBRL dividend facts are compared with sums.** Each quarterly, year-to-date or fiscal-year fact is
   compared with the sum of every dividend declared (or paid) in its period. This is needed because:
   - Intel declares two quarters' dividends in some quarters.
   - Walmart declares its whole year in Q1.
   - Costco's specials share quarters with regular dividends.

   **Visa tags the quarterly rate** for every period length (FY2009 = 0.105, not 0.42), so Visa's
   facts are compared with each dividend in the period.

## 4. Cross-vendor results

### 4.1 Coverage and calendar
- **CNBC.**
  - All six symbols are missing **2023-04-06**, the batch-1/2 defect. Those rows are filled from
    Nasdaq historical and confirmed by Cboe and stockanalysis.
  - ORCL is also missing **2013-07-15..2013-07-19**: CNBC has no bars for Oracle's first five NYSE
    sessions. These are filled from Nasdaq chart and confirmed by Cboe. The first NYSE close was 32.01
    (`source=nasdaq_chart`).
  - The zero-volume rows of 2015-06-08/09 recur for all six symbols. Prices are corroborated; volume
    is taken from Nasdaq chart.
- **Nasdaq chart.** Exactly complete from 1990, or from the IPO / 1993-10-22, apart from the
  placeholders above.
- **Cboe.** Phantom rows on 2025-05-26 (all six symbols) and 2018-11-22 (the NYSE-listed WMT, CRM, V
  and ORCL). V is missing 2008-04-29.
- **stockanalysis.** Exactly 1,255 sessions.

### 4.2 Close corroboration (rows agreeing with the published close / rows the vendor covers)
| Symbol | Nasdaq hist (2016-10+) | Nasdaq chart | Cboe (2004+) | stockanalysis (2021-10+) |
|---|---|---|---|---|
| WMT | 2,513/2,514 | 9,147/9,250 (+6 placeholders) | 5,711/5,724 | 1,255/1,255 |
| COST | 2,514/2,514 | 8,292/8,292 | 5,366/5,724 | 1,255/1,255 |
| CRM | 2,514/2,514 | 5,606/5,606 | 5,604/5,606 | 1,255/1,255 |
| V | 2,514/2,514 | 4,665/4,665 | 4,658/4,664 | 1,255/1,255 |
| INTC | 2,514/2,514 | 9,241/9,252 (+4) | 5,717/5,724 | 1,255/1,255 |
| ORCL | 2,514/2,514 | 9,244/9,251 (+5) | 5,723/5,724 | 1,255/1,255 |

COST's Cboe shortfall comes from Cboe's period-wise adjustment for Costco's large specials and its
2-dp rounding; Nasdaq agrees on every COST close. WMT's single Nasdaq-hist shortfall is 2019-08-12:
Nasdaq has 105.12, while CNBC's 105.22 is kept because Cboe agrees with it.

### 4.3 Base values replaced (two vendors against CNBC)
Each item gives the CNBC close, the replacement, and the vendors that agree with the replacement.

- **2023-04-06**, all six symbols: the row was missing and was filled.
- **ORCL 2013-07-15..19**: missing, and filled.
- **WMT 2009-03-24**: 51.05 → 51.08 (Nasdaq chart and Cboe).
- **V 2009-03-24**: 53.48 → 53.60 (Nasdaq chart and Cboe).
- **INTC 2005-06-01**: 27.33 → 27.29, the same 2005-06-01 CNBC defect batch 2 found.
- **CRM 2004-12-30**: 16.83 → 16.86.
- **Kept CNBC, with Cboe on its side against Nasdaq**: INTC 2007-05-01 (21.80 vs 21.64), ORCL
  2005-06-01 (12.89 vs 12.85), and WMT 2019-08-12.

### 4.4 Closes we could not confirm (`close_unverified`)
Each entry is CNBC's close vs Nasdaq's; "placeholder" means Nasdaq has no data that day.

- **WMT (84).**
  - **74 fall in 1999-10-29..2000-09-28.** In this stretch CNBC and Nasdaq disagree on NYSE closes by
    1/16 to $3.25, exactly as for JPM, KO and SPY in batch 2. One example is 2000-02-24: CNBC 47.875,
    which equals its own high, against Nasdaq 44.625. No third keyless vendor covers it.
  - One of them is weakly adjudicated by a filing: on 1999-12-28 Nasdaq's 69.6875 would exceed the
    FY2000 Q4 closing high printed in the FY2001 10-K (69.44 = 69 7/16), while CNBC's 69.3125 fits.
    The row stays flagged, because the 10-K does not say its table is of closes; §7 shows it behaves
    like one.
  - The others:
    - 1991-02-14 36.125 vs 36.00
    - 1991-06-13 42.50 vs 42.625
    - 1991-10-18 49.125 vs 49.00
    - 1995-10-05 24.125 vs 23.875
    - 1996-01-17, 01-19, 01-22, 01-31, 03-04 and 03-15 (placeholders)
- **INTC (12).**
  - 1990-07-24, 1991-01-17, 1992-01-16 and 1995-12-05 (placeholders).
  - Within 1/8–1/4 of Nasdaq:
    - 1990-08-24 35.75 vs 36.00
    - 1991-03-05 51.25 vs 51.375
    - 1992-11-13 70.00 vs 70.25
    - 1993-05-24 103.75 vs 104.00
    - 1993-10-01 73.00 vs 72.75
    - 1996-03-06 53.25 vs 53.50
    - 1997-11-03 78.625 vs 78.50
  - 2002-11-04 18.75 vs 18.77.
- **ORCL (11).**
  - Placeholders: 1990-03-28, 1990-07-11, 1990-09-07, 1991-02-07 and 1992-01-08. CNBC shows large
    moves on the first three (−31%, −11%, −18%), and in each case the following day's Nasdaq bar
    trades at CNBC's new level.
  - Small disagreements:
    - 1990-11-12 5.875 vs 6.00
    - 1991-03-05 9.375 vs 9.50
    - 1993-04-12 35.875 vs 35.75
    - 1995-09-27 38.625 vs 38.00
  - 2000-04-14 62.50 vs 63.5156.
  - 2003-03-13 11.90 vs 11.93.
- **Effect on returns.** A wrong close on one day cancels out the next day in a compounded index, so it
  matters only for tenures anchored on that date.

## 5. Corporate actions

Dividends in `data/seed/prices/<SYM>_actions.csv` are per share as declared, on the share basis at the
time.

### 5.1 Splits: 19 in window, each verified three ways
Each split was checked three ways: every vendor's implied factor per split interval (CNBC adjusted,
Nasdaq chart, and Nasdaq historical / Cboe / stockanalysis where they reach), the raw ex-date move, and
a primary source. The move column shows ratio × ex close / prior close − 1.

| Symbol | Ex-date | Ratio (from:to) | Vendor factors | Prior close → ex close (move) | Primary source (saved) |
|---|---|---|---|---|---|
| WMT | 1990-07-09 | 1:2 | 24 → 12 (CNBC adj, Nasdaq chart) | 62.50 → 32.75 (+4.8%) | Walmart IR split history: record 6/15/90, distributed 7/6/90 (`ir/WMT_stock-split-history_20261005.html`; read) |
| WMT | 1993-02-26 | 1:2 | 12 → 6 | 63.625 → 32.50 (+2.2%) | IR: record 2/2/93, distributed 2/25/93; FY1995 10-K equity statement "Two-for-one stock split" (`sec/WMT_10K_FY1995…`) |
| WMT | 1999-04-20 | 1:2 | 6 → 3 | 89.75 → 47.75 (+6.4%) | FY1999 10-K: "date of record is March 19, 1999, and it will be distributed April 19, 1999" (`sec/WMT_10K_FY1999…`); IR |
| WMT | 2024-02-26 | 1:3 | 3 → 1 (all 5 vendors) | 175.56 → 59.60 (+1.9%) | 8-K Ex. 99.1 (`sec/WMT_8K_20240131…`): record Feb 22, payable after the close Feb 23, post-split trading from Feb 26, 2024; IR |
| COST | 2000-01-14 | 1:2 | 2 → 1 (Nasdaq chart) | 94.9375 → 49.0625 (+3.4%) | 8-K press release (`sec/COST_8K_19991209…`): record Dec 24, 1999; shares delivered about Jan 13; post-split trading Jan 14, 2000; FY2000 10-K |
| CRM | 2013-04-18 | 1:4 | 4 → 1 (CNBC adj, Nasdaq chart, Cboe) | 167.35 → 41.03 (−1.9%) | 8-K Item 8.01 (`sec/CRM_8K_20130321…`): record April 3, distributed April 17, 2013 |
| V | 2015-03-19 | 1:4 | 4 → 1 (CNBC adj, Nasdaq chart, Cboe) | 267.67 → 66.81 (−0.2%) | 8-K Item 8.01 (`sec/V_8K_20150129b…`): class A stock dividend paid March 18, 2015 to holders of record Feb 13, 2015 |
| INTC | 1993-06-07 | 1:2 | 32 → 16 | 112.75 → 58.125 (+3.1%) | FY1993 10-K: "Effective May 6, 1993, the Company declared a two-for-one stock split" (`sec/INTC_10K_FY1993…`); Intel IR: payable 06/06/93, record 05/06/93 (`ir/INTC_stock-splits_20261005.html`) |
| INTC | 1995-06-19 | 1:2 | 16 → 8 | 116.125 → 61.75 (+6.4%) | FY1995 10-K: distribution June 16, 1995 to holders of record May 19, 1995 (Intel IR gives the record date as 05/16/95) |
| INTC | 1997-07-14 | 1:2 | 8 → 4 | 153.8125 → 78.75 (+2.4%) | FY1999 10-K: July 13, 1997, record June 10, 1997; IR |
| INTC | 1999-04-12 | 1:2 | 4 → 2 | 130.8125 → 61.25 (−6.4%; both vendors) | FY1999 10-K: April 11, 1999, record March 23, 1999; IR |
| INTC | 2000-07-31 | 1:2 | 2 → 1 | 129.125 → 66.75 (+3.4%) | FY2000 10-K: July 30, 2000, record July 2, 2000; IR |
| ORCL | 1993-11-09 | 1:2 | 40.5 → 20.25 | 61.125 → 30.50 (−0.2%) | FY1994 10-K: distributed Nov 8, 1993 to holders of record Oct 22, 1993 (`sec/ORCL_10K_FY1994…`, old CIK 777676) |
| ORCL | 1995-02-23 | 2:3 | 20.25 → 13.5 | 47.125 → 31.375 (−0.1%) | FY1995 10-K: distributed Feb 22, 1995, record Feb 6, 1995 |
| ORCL | 1996-04-17 | 2:3 | 13.5 → 9 | 45.8125 → 31.125 (+1.9%) | FY1996 10-K: distributed April 16, 1996, record April 2, 1996 |
| ORCL | 1997-08-18 | 2:3 | 9 → 6 | 55.75 → 38.50 (+3.6%) | FY1997/FY1998 10-K: distributed Aug 15, 1997, record Aug 1, 1997 |
| ORCL | 1999-03-01 | 2:3 | 6 → 4 | 55.875 → 36.625 (−1.7%) | FY1999 10-K: effected Feb 26, 1999, record Feb 10, 1999 |
| ORCL | 2000-01-19 | 1:2 | 4 → 2 | 111.25 → 57.125 (+2.7%) | FY2000 10-K: effected Jan 18, 2000, record Dec 30, 1999 |
| ORCL | 2000-10-13 | 1:2 | 2 → 1 | 63.00 → 35.625 (+13.1%; both vendors; SPY rose 3.3% that day) | FY2001 10-K: effected Oct 12, 2000, record Sep 25, 2000 |

stockanalysis's "last split" statements match the last split of every symbol. CNBC's `adjusted` COST
series is not split-only: after 2000 it sits at 1/1.0227 of the as-traded price, consistent with an
adjustment for the $15 special of 2023. It is used only as evidence of the 2.0 split factor, which it
shows (2.0455/1.0227).

**Continuity across corporate events.**
- **WMT: NYSE → Nasdaq.** The company's 8-K of 2025-11-20 (`sec/WMT_8K_20251120…`, Item 3.01) says
  NYSE trading would end at the close on December 8, 2025 and Nasdaq trading begin at the open on
  December 9, 2025, under "WMT". The Form 25 and the Form 8-A12B were both filed on 2025-12-08
  (`sec/WMT_25_20251208…`, `sec/WMT_8A12B_20251208…`).
  - Every vendor's series runs through it unbroken.
  - The closes are 113.56 on the last NYSE day and 115.06 on the first Nasdaq day, both matching news
    reports (§7).
  - Nasdaq's dividend API now returns Walmart's history, back to 2000 with gaps, which made Nasdaq the
    base dividend list for WMT.
- **COST: 1993 merger and 1994 exchange offer.** The FY1994 10-K says "Trading in PriceCostco Common
  Stock commenced on October 22, 1993" ("PCCW"); the symbol has been "COST" since 1997-01-29 (FY1999
  10-K).
  - The 1994 Price Enterprises transaction was a **voluntary exchange offer**, not a pro-rata
    distribution: 23,231,016 tendered shares were exchanged one for one (8-K of 1995-01-03,
    `sec/COST_8K_19950103…`). A holder who did not tender kept the same share, so no action is
    recorded. The 1999 reincorporation in Washington changed the name only.
- **ORCL: 2006 holding company.** The S-4/A (`sec/ORCL_S4A_20051229_ds4a.htm`) says: "each Oracle
  stockholder will be entitled to receive for each share of Oracle common stock … one share of New
  Oracle common stock".
  - The new registrant is CIK 1341439, formerly "Ozark Holding Inc.". The old CIK 777676 became
    Oracle Systems Corporation, which deregistered by Form 15-12G on 2006-02-01. The FY2006 10-K
    (`sec/ORCL_10K_FY2006…`) confirms the reorganization of January 31, 2006.
  - The closes run 12.61, 12.57, 12.58 (2006-01-30..02-01) in both vendors, with no gap.
- **ORCL: Nasdaq → NYSE, 2013.** The 8-K of 2013-06-20 (Item 3.01) gave NYSE trading from July 15,
  2013 (`sec/ORCL_8K_20130620…`; also `ORCL_8A12B_20130703…` and `ORCL_25_20130712…`). See §4.1 for
  CNBC's missing week.
- **INTC.** No split since 2000 and no other action besides dividends; every vendor's factor stays at
  1 after 2000-07-31.

### 5.2 Dividends

Coverage per symbol:

| Symbol | Base list | Rows | Amounts | Ex-dates |
|---|---|---|---|---|
| WMT | Nasdaq (2000–2001, 2004-08+); dividendhistory.org for the rest | 147 (1990-03-19..2026-08-21) | **All 147 have ≥2 sources.** 10-K/10-Q quarterly tables for FY1994–FY2006: 56 entries, 36 equal the vendor and 20 corrected the vendor. XBRL FY totals FY2008–FY2026: 21/21. FY1995 10-K annual totals FY1991–FY1995: 5/5. | 93 with ≥2 sources; 54 (1990-03..2004-05) single-source. All 147 record dates satisfy the settlement rule. Pay dates for FY1994–FY2006 come from the 10-Ks. |
| COST | Nasdaq (2013-08+); dividendhistory.org for 2004–2013 | 90 cash + 5 special (2004-05-06..2026-07-24) | All 95 ≥2: 10-K paid totals FY2004–FY2008 5/5; XBRL FY 17/17 | 57 ≥2; 38 single-source (2004-05..2013-05); 13 record/pay dates from 10-Ks and 8-Ks; 95/95 satisfy the rule |
| CRM | dividendhistory.org + stockanalysis | 11 (2024-03-13..2026-09-17) | All ≥2: stockanalysis, XBRL quarterly 10/10, first dividend's 8-K | All 11 ≥2 |
| V | dividendhistory.org | 73 (2008-08-13..2026-08-11) | All ≥2: XBRL rate facts FY 29/29, YTD 30/30, Q 56/56; stockanalysis from 2021 | 21 ≥2; 52 single-source (2008-08..2021-05); two 8-K record dates; 73/73 satisfy the rule |
| INTC | Nasdaq (1999–2003, 2013-08..2024-08); dividendhistory.org for the gaps | 128 (1992-10-26..2024-08-07) | All ≥2: 10-K quarterly "paid" tables 1992–1999, 29 entries, 28 equal and 1 corrected; 10-K annual paid totals 1996–2006, 11/11; XBRL FY 9/9 | 88 ≥2; 40 single-source (2003-08..2013-05, the gap in Nasdaq's list); 85/85 with a record date satisfy the rule |
| ORCL | dividendhistory.org | 69 (2009-04-06..2026-07-10) | All ≥2: XBRL FY 20/20, YTD 36/36, Q 55/55; stockanalysis | 19 ≥2; 50 single-source (2009-04..2021-10); 64/64 satisfy the rule |

**Corrections from company filings.**
- **WMT, 20 amounts.** dividendhistory.org (and .net) store Walmart's 1990s dividends rounded to 3 dp.
  Every quarter that a 10-K or 10-Q prints exactly differs from the vendor:

  | Fiscal year | Filing (as declared) | Vendor | Source |
  |---|---|---|---|
  | FY1994 | 0.0325 | 0.032 | FY1995 10-K |
  | FY1995 | 0.0425 | 0.042 | FY1995 10-K |
  | FY1997 | 0.0525 | 0.052 | FY1997 10-K |
  | FY1998 | 0.0675 | 0.068 | FY1998 10-K |
  | FY1999 | 0.0775 | 0.078 | Q1 FY1999 10-Q, "Dividends per share $.0775"; MD&A, fiscal 1999 dividend $.31 (`sec/WMT_10Q_19980615…`) |

  The filing's amount replaces the vendor's. FY1996 ($0.05) and FY2000+ (0.05, 0.06, 0.07, 0.075, 0.09,
  0.13, 0.15) equal the vendor.
- **WMT, 8 amounts inferred: 1991-03-18..1992-12-04.** No saved filing prints these quarters: the 10-Ks
  for FY1992–FY1994 predate EDGAR.
  - The vendors give 0.042 (FY1992) and 0.052 (FY1993).
  - Given the vendors' demonstrated 3-dp rounding, the FY1995 10-K's restated annual totals, .09 and
    .11, are reproduced only by **0.0425 and 0.0525**: 4 × 0.0425/2 = 0.085, whereas 0.042 would give
    0.084, which rounds to .08.
  - FY1993's $241 million of cash dividends on about 1,149 million pre-split shares ($0.2097 a share)
    confirms 0.0525.
  - These are recorded as `MANUAL_DIVIDENDS` with that reasoning. The TR effect is about 0.001% a
    quarter ($0.0005 on a share near $40).
- **INTC 1994-07-26: 0.065 → 0.06.** The FY1994 10-K (unrestated) shows 1994 dividends paid of .05,
  .05, .06 and .06. The FY1995 10-K's declared total for 1994, $.115 restated, also requires 0.06.
- **Dates.**
  - dividendhistory.org's pay dates are unreliable:
    - For WMT they run about 19 days after the ex-date. They contradict 32 of the 52 payment dates the
      10-Ks print for 1993–2006, all 32 falling in 1993–2002.
    - For INTC 1992–1998 they fall on the record date (the 1st of Feb/May/Aug/Nov); for 1998–2003 they
      are 1–5 days off.

    dividendhistory.net's pay dates agree with the 10-Ks and with Nasdaq (91/91 WMT, 45/45 INTC), so
    .net supplies record and pay dates where no filing or Nasdaq row does.
  - **Exception: Visa's Feb 2016 dividend.** dividendhistory.net has ex 2016-02-17, but the 8-K of
    2016-02-05 gives record Feb 12 and payable Mar 1. That means ex Feb 10, as .org has. .org's date
    is kept.
  - **Visa's Nov 2015 dividend.** The ex-date 2015-11-10 is one session earlier than plain T+3,
    because Nov 11 (Veterans Day) was not a settlement day. The 8-K gives record Nov 13.

**Special dividends.** All five are COST:

| Ex-date | Amount | Record | Payable | 8-K |
|---|---|---|---|---|
| 2012-12-06 | $7.00 | 2012-12-10 | 2012-12-18 | `sec/COST_8K_20121129…` |
| 2015-02-05 | $5.00 | 2015-02-09 | 2015-02-27 | `sec/COST_8K_20150130…` (also the regular 35.5¢, ex 2015-02-11) |
| 2017-05-08 | $7.00 | 2017-05-10 | 2017-05-26 | `sec/COST_8K_20170426…` (also the regular $0.50, ex 2017-05-10) |
| 2020-12-01 | $10.00 | 2020-12-02 | 2020-12-11 | `sec/COST_8K_20201118…` |
| 2023-12-27 | $15.00 | 2023-12-28 | 2024-01-12 | `sec/COST_8K_20231214…` |

Each ex-date satisfies the settlement rule for its record date. Costco's XBRL fiscal-year totals
include them, e.g. FY2024 $19.36 = $4.36 + $15.00 (17/17 FY facts match).

**ORCL 2012-12-12, $0.18: `cash_dividend`, not special.** The 8-K of 2012-12-03
(`sec/ORCL_8K_20121203…`) calls it "an accelerated cash dividend … in lieu of quarterly dividends"
for Q2–Q4 of FY2013, with record 2012-12-14 and payable 2012-12-21. Quarterly dividends then resumed
at $0.12 (ex 2013-07-10). dividendhistory.org labels it "Special dividend". The TR effect is the same
either way.

**No further INTC dividends after 2024-08-07** (the suspension announced 2024-08-01). Nasdaq,
dividendhistory.org/.net and stockanalysis all end there. Intel's FY2025 10-K, filed 2026-01-23,
carries dividend facts only through FY2024 ($0.38 ≈ 3 × $0.125).

**XBRL noise, not errors.** These do not affect any row's corroboration, because each affected row has
other matching facts.
- **WMT.** Two quarterly and three YTD facts miss. Walmart declares the whole year in Q1, so these
  facts need all four of the year's dividends. Nasdaq gives no declaration date for the 2025-12-12
  dividend (FY2026), and FY2027's fourth dividend (ex 2026-12-11) falls after the seed's end.
- **COST.** 8 quarterly facts: its quarterly "Declared" tag excludes specials, and some "CashPaid"
  quarterly tags carry the declared rate.
- **INTC.** 10 quarterly and 5 YTD facts: Intel declares two dividends in some quarters, and
  dividendhistory.org has no declaration dates, so the declaration date is estimated.

## 6. Total-return self-check

The pipeline's own code was run on the seeds: `bt.ingest.prices.read_bars_csv` /
`read_actions_csv` → `bt.analytics.returns.build_indexes`. The TR index, rescaled to end at the last
close, was compared with stockanalysis `a` (the seeds' `adj_close`, 1,255 rows each). The core of the
check:
```
uv --directory pipeline run python -c '
from pathlib import Path
from bt.ingest.prices import read_bars_csv, read_actions_csv
from bt.analytics.returns import Action, Bar, build_indexes
for s in ["WMT","COST","CRM","V","INTC","ORCL"]:
    d = Path("../data/seed/prices"); b = read_bars_csv(d / f"{s}.csv")
    a = [Action(x.ex_date, split_ratio=x.split_to / x.split_from) if x.action_type == "split"
         else Action(x.ex_date, cash=x.cash_amount) for x in read_actions_csv(d / f"{s}_actions.csv")]
    p = build_indexes([Bar(x.day, x.close) for x in b], a); L = p[-1]
    adj = {x.day: x.vendor_adj_close for x in b if x.vendor_adj_close}
    dev = max(abs(L.close * q.tr / L.tr / adj[q.day] - 1) for q in p if q.day in adj)
    print(s, round((L.tr / p[0].tr - 1) * 100, 2), round(dev * 1e4, 2))'
```

| Symbol | Pipeline convention: max rel. / abs. deviation | Rows > 1 bp | Vendor (multiplier) convention: max rel. deviation | Script vs pipeline TR |
|---|---|---|---|---|
| WMT | 0.71 bp / $0.0034 | 0 | 0.0003 bp | 8e-15 |
| COST | 3.60 bp / $0.2029 | 561 | 0.00001 bp | 9e-16 |
| CRM | 3.35 bp / $0.1042 | 1,176 | 0.00004 bp | 2e-16 |
| V | 1.08 bp / $0.0244 | 63 | 0.00003 bp | 2e-15 |
| INTC | 6.08 bp / $0.0235 | 588 | 0.0002 bp | 3e-15 |
| ORCL | 3.67 bp / $0.0621 | 944 | 0.00008 bp | 6e-15 |

The two conventions differ on an ex-date by about (D/P) × (that day's return), and the gap
accumulates backward. The multiplier column shows that the closes, split ratios and dates, and
dividend amounts and dates for 2021–2026 agree with an independent vendor's adjusted history to its
rounding. Before 2021 no keyless adjusted close was reachable (Yahoo 429), so earlier `adj_close` is
empty, as in batch 2.

Long-run totals (pipeline, first row to 2026-10-02):

| Symbol | From | Price return | Total return |
|---|---|---|---|
| WMT | 1990-01-02 | +5,210% | +8,766% |
| COST | 1993-10-22 | +9,591% | +14,467% |
| CRM | 2004-06-23 | +5,358% | +5,464% |
| V | 2008-03-19 | +2,453% | +2,810% |
| INTC | 1990-01-02 | +10,507% | +18,922% |
| ORCL | 1990-01-02 | +23,789% | +29,983% |

## 7. Spot checks

There are 252 checks in `verification_batch3_20261005.json` (`spot_checks`). **249 match**, to the
cent or the printed precision; the 3 mismatches are explained below.

**10-K quarterly price ranges (228 extremes).** These are especially useful before 2004, where only
two vendors exist. Values are restated to each filing's split basis. Where the filing does not say
whether it gives closes or sale prices, both readings were tested.

| Symbol | Filings | Result | Basis that fits |
|---|---|---|---|
| WMT | FY1995, FY1997, FY1999, FY2001, FY2003 10-Ks (FY1994–FY2003, 40 quarters) | 77/80 | Closing extremes (66 fit only closes, 11 both) |
| INTC | FY1993, FY1994, FY1995, FY1997 10-Ks (1992–1997, 24 quarters) | 48/48 | Closes (45 only, 3 both) |
| ORCL | FY1995, FY1997 10-Ks (FY1994–FY1997, intraday despite "as of the close of market") | 32/32 | Intraday. This confirms the Nasdaq-chart lows used for 1990–2003. |
| ORCL | FY2000, FY2001 10-Ks (FY1999–FY2001, "based on the last sale") | 24/24 | Closes, within $0.01: the filings restate twice and round each time, e.g. 19.9375/1.5 → 13.29 → /2 → 6.645 → "6.64" |
| COST | FY1994/FY1995 10-Ks (PriceCostco 1993Q4–1994Q4, "high and low sales prices") | 10/10 | Intraday |
| COST | FY1999/FY2000 10-Ks (1997–2000, "closing high and low"; exact fractions such as 63 7/32 and 55 61/64) | 34/34 | Closes |

The 3 WMT mismatches are 1/8 off, like batch 2's three AAPL ones:
- FY1994 Q3 (Aug–Oct 1993): high 27.25 vs a seed maximum close of 27.375 (1993-10-20; CNBC and Nasdaq
  agree).
- FY1994 Q4: high 29.88 vs 30.00 (1993-11-16).
- FY1996 Q1 (Feb–Apr 1995): low 23.13 vs 23.375.

**Point checks (24).** All match. "snippet" means the value came from search-result text rather than
a page read.

| Symbol | Reference point (public value) | Seed | Source |
|---|---|---|---|
| WMT | Close on each split's distribution day: 1990-07-06 62.50, 1993-02-25 63.625, 1999-04-19 89.75, 2024-02-23 175.56 | same | Walmart IR split history ("Split Date Mkt. Price"; read) |
| WMT | 2025-12-08 113.56 (last NYSE day); 2025-12-09 115.06 (first Nasdaq day) | same | ts2.tech, an aggregator (snippet) |
| COST | 2025-02-06 1,050.99 (record close, +$8.11); 2026-05-08 1,008.79 | same | Yahoo Finance/TheStreet; 24/7 Wall St. (snippet) |
| CRM | IPO 2004-06-23: open 15, high 17.30, close 17.20; 2024-05-29 271.62 and 2024-05-30 218.01 (−$53.61, −19.7%) | same | Globe and Mail, TheStreet; CNBC/UPI (snippet) |
| V | IPO 2008-03-19: open 59.50, high 69, close 56.50; 2015-03-18 267.67 (last pre-split close) | same | Fortune/CNN Money, Spokesman-Review; Alpha Spread (snippet) |
| INTC | 2000-08-31 74.875 (the 2000 record close); 2024-08-02 21.48 (−26%); 2026-06-22 140.94 (record); 2026-09-16 101.05 | same | Dow Jones/Stocktwits; Reuters/CNBC; Macrotrends (snippet; adjusted, but Intel has had no actions since 2024-08) |
| ORCL | 2013-06-21 30.13; 2025-09-10 328.33 (+36%); 2026-10-02 142.30 | 30.135; same; same | SFGate/TheStreet; CNBC; CNN quote page (snippet). CNBC and Nasdaq both give the 30.135 half-cent close; Cboe gives 30.14. |

## 8. Caveats and open items
- **Licensing.** None of the vendor back-ends is licensed for display. The seeds are for local
  prototyping only.
- **Before 2004 there are only two independent vendors.** WMT's 74 flagged closes of
  1999-10..2000-09 and a dozen scattered INTC/ORCL closes are unresolved; a licensed feed should
  settle them. Fifteen of the flags are days with no Nasdaq data at all (placeholders).
- **COST depth.** The seed starts 1993-10-22. The pre-merger Costco Wholesale series (1990–1993) is
  missing.
- **Inferred amounts.** The eight WMT dividends of 1991–1992 (0.0425 / 0.0525) are inferred, not
  read from a filing (§5.2). The four of 1990 (0.07, 0.07, 0.035, 0.035) rest on dividendhistory.org,
  checked only against the FY1995 10-K's rounded FY1991 total of .07.
- **Single-source ex-dates** come from dividendhistory.org; .net agrees but shares its upstream:
  - WMT 1990–2004: 54
  - COST 2004–2013: 38
  - V 2008–2021: 52
  - INTC 2003–2013: 40
  - ORCL 2009–2021: 50

  Their amounts are confirmed by filings, and every one that has a record date satisfies the T+n
  settlement rule. Those record dates mostly come from dividendhistory.net, so the rule is a
  consistency check, not independent confirmation. A wrong ex-date would shift a dividend by days
  within the right quarter.
- **O/H/L.**
  - Opens through 1991-11-08 are null for WMT, INTC and ORCL: neither vendor has them. Opens start
    on 1991-11-11.
  - ORCL lows for 1990–2003 are Nasdaq-chart-only (`low=nasdaq_chart_only`), although the 10-K
    ranges confirm them.
  - A few hundred other O/H/L values are null where the vendors conflict.
  - Returns use closes only.
- **Volume** is CNBC's as-traded consolidated volume, with 21–55 rows per symbol tagged
  `volume=cnbc_unverified`. Do not treat it as exact.
- **`adj_close`** is filled only from 2021-10-04 (stockanalysis, multiplier convention). Validation
  thresholds should allow up to about 6 bp for the convention difference (§6).
- **Retrieval timing.** Everything was fetched on 2026-10-05 during market hours. Every series was cut
  at 2026-10-02, and no ex-date falls between 2026-10-02 and the retrieval; ORCL's next is 2026-10-09.
  So stockanalysis's adjusted closes are not shifted by an action outside the seeds.

## 9. Reproduce
```
uv run --no-project --with exchange_calendars python scripts/prices/build_batch3.py 20261005
```
The script reads only the raw files above and rewrites the six `<SYM>.csv` and `<SYM>_actions.csv`
seeds; other symbols' seeds are not touched. It also writes
`data/raw/prices/verification_batch3_20261005.json`, which contains:
- calendars per vendor
- every override, conflict, unverified and nulled value
- vendor split factors by interval
- split moves
- per-row dividend checks, with their sources and the settlement-rule result
- XBRL facts
- 10-K quarterly and annual dividend comparisons
- TR checks in both conventions
- spot checks

Two runs give byte-identical seeds.
