# Price data verification: LYFT, SPY (and ^GSPC for comparison)

Retrieved: 2026-10-05 04:52–05:08 UTC (2026-10-04 evening US Pacific). Window: 2019-03-01 through
2026-10-02 (the last session before retrieval). LYFT first traded 2019-03-29.

**Status: prototype only.** All sources below were reached without API keys. None of them comes with a
license for redistribution or public display. Licensing is being researched separately; treat these
files as local reference data until that work is done.

## TL;DR

| | LYFT | SPY |
|---|---|---|
| Seed file | `data/seed/prices/LYFT.csv` | `data/seed/prices/SPY.csv` |
| Rows / range | 1,889 / 2019-03-29 .. 2026-10-02 | 1,909 / 2019-03-01 .. 2026-10-02 |
| Expected NYSE/Nasdaq sessions | 1,889 | 1,909 |
| Primary source | Nasdaq.com historical API | Nasdaq.com historical API (2 rows patched from CNBC, see below) |
| Closes corroborated by at least one other independent source (within $0.01) | 1,889 / 1,889 | 1,909 / 1,909 |
| Splits in window | none (none ever) | none |
| Dividends in window | none (never paid) | 31 quarterly distributions, total $49.917613 |
| `adj_close` | = `close` (no corporate actions) | recomputed total-return series; matches stockanalysis.com's adjusted close within $0.0005 (its 3-decimal rounding) on all 1,255 overlapping rows |

## 1. Sources and retrieval

Raw responses are saved untouched under `data/raw/prices/<source>/` (gitignored). Each folder has a
`retrieval_log.txt`, and most responses have a sibling `*_headers.txt` with the HTTP response headers.
Requests were spaced about 3 s apart, with 32 HTTP requests in total across all sources, including failures.

| Source | Endpoint (as requested) | Provides | Retrieved (UTC) | Result | Raw file(s) |
|---|---|---|---|---|---|
| **Nasdaq.com** | `https://api.nasdaq.com/api/quote/LYFT/historical?assetclass=stocks&fromdate=2019-03-01&limit=9999&todate=2026-10-03` | Daily OHLCV, unadjusted, newest first | 04:54:50 | 200, 1,889 rows | `nasdaq/LYFT_20261004.json` |
| Nasdaq.com | same, `SPY ... assetclass=etf` | same | 04:55:06 | 200, 1,909 rows | `nasdaq/SPY_20261004.json` |
| Nasdaq.com | `https://api.nasdaq.com/api/quote/LYFT/dividends?assetclass=stocks` | Dividend history | 04:56:09 | 200, no rows; message says the company may never have paid a dividend | `nasdaq/LYFT_dividends_20261004.json` |
| Nasdaq.com | `https://api.nasdaq.com/api/quote/SPY/dividends?assetclass=etf` | Dividend history | 04:56:14 | 200, no rows; "not available" for non-Nasdaq-listed symbols | `nasdaq/SPY_dividends_20261004.json` |
| Nasdaq.com | `https://api.nasdaq.com/api/quote/SPX/historical?assetclass=index&...` | S&P 500 | 04:56:04 | rCode 400 "Symbol not exists" | `nasdaq/failed/` |
| **Cboe** (delayed-quotes CDN) | `https://cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/{LYFT,SPY,_SPX}.json` (`cdn.cboe.com` 307-redirects here) | Daily OHLCV; `_SPX` index since 1975 | 04:57:16–04:57:31 | 200 | `cboe/{LYFT,SPY,GSPC}_20261004.json` |
| **CNBC** (chart timeseries API) | `https://ts-api.cnbc.com/harmony/app/bars/{LYFT,SPY,.SPX}/1D/20190301000000/20261003000000/adjusted/EST5EDT.json` | Daily OHLCV, split-adjusted only (SPY closes equal the unadjusted closes) | 05:00:06–05:00:26 | 200 | `cnbc/{LYFT,SPY,GSPC}_20261004.json` |
| **stockanalysis.com** | `https://stockanalysis.com/api/symbol/e/spy/history?range=Max&period=daily`, `.../s/lyft/history?...` | OHLCV plus **adjusted close** (`a`) and SPY dividend events (`div`); keyless access is capped at about 5 years (from 2021-10-04) | 05:03:26, 05:05:15 | 200, 1,255 rows each | `stockanalysis/{SPY,LYFT}_20261004.json` |
| stockanalysis.com | `/etf/spy/dividend/`, `/stocks/lyft/statistics/`, `/stocks/lyft/dividend/` | Dividend table (5 years), split and dividend statistics | 05:07:14–05:07:20 | 200, 200, 404 | `stockanalysis/*_page_20261004.html` |
| **State Street (SSGA)**, the SPY sponsor | `https://www.ssga.com/library-content/products/fund-data/etfs/us/spdr-etf-historical-distributions.xlsx` (linked from the SPY fund page under "ETF Historical Distributions") | Official distribution history for all SPDR ETFs (ex, record and payable dates; income dividend; ST and LT capital gains) | 05:01:44 | 200, Last-Modified 2026-10-01 11:11:56 GMT; 136 SPY rows back to 1993 | `ssga/spdr-etf-historical-distributions_20261004.xlsx` |

### Sources that could not be used

| Source | What happened | Raw evidence |
|---|---|---|
| **Stooq** (`https://stooq.com/q/d/l/?s=lyft.us&i=d`, `spy.us`) | Returns `200 text/html`, a JavaScript proof-of-work browser-verification page instead of CSV. **We did not attempt to solve or bypass it**, because it is bot detection. `^spx` was not tried. | `stooq/*_challenge.html` + headers |
| **Yahoo chart API** (`query1`/`query2.finance.yahoo.com/v8/finance/chart/...`) | `HTTP 429 Too Many Requests` on the first request and on every retry: 6 requests between 04:53:56 and 05:02:15, browser User-Agent, query1 and query2. We stopped retrying. As a result, there is **no Yahoo adjusted close and no Yahoo dividend or split events**. | `yahoo/failed/*` |
| **FRED** `SP500` CSV (`fred.stlouisfed.org/graph/fredgraph.csv?id=SP500`) | HTTP/2 stream reset, then a connection timeout on HTTP/1.1. | `fred/retrieval_log.txt` |

## 2. Normalization

`scripts/prices/verify_prices.py` (stdlib only) parses each raw file into
`(date, open, high, low, close, adj_close, volume)`. It uses `Decimal`, so the published digits are
kept exactly: `$` and thousands separators are stripped, and values are not rounded.

- Nasdaq: dates are `MM/DD/YYYY` and prices are strings like `"$15.1477"`. Highs and lows often carry
  sub-penny values (consolidated-tape prints). SPY volumes are rounded to the nearest 10 shares on
  1,907/1,908 days. LYFT volumes are increasingly rounded from 2022 on.
- Cboe: equity prices are JSON floats with 2 decimals. Index values are 6-decimal strings with volume 0.
- CNBC: prices are 4-decimal strings. The LYFT series includes **two pre-IPO placeholder bars** at the
  $72 IPO price (2019-03-22 with volume 0, and 2019-03-28 with volume 72). They are excluded.
- stockanalysis: prices are rounded to 3 decimals, including `a` (adjusted close).

## 3. Trading calendar

The expected sessions are weekdays minus the NYSE/Nasdaq full-day closures listed in the script. That
set **equals `exchange_calendars` 4.13.2 XNYS and XNAS exactly**: 1,909 sessions from 2019-03-01 to
2026-10-02, and 1,889 from 2019-03-29. The closures include 2025-01-09 (national day of mourning for
President Carter) and 2026-07-03 (Independence Day observed).

| Source | LYFT | SPY | ^GSPC |
|---|---|---|---|
| Nasdaq | 1,889 rows, exactly the expected sessions | 1,909, exact (but see defects in §4.3) | n/a |
| Cboe | ends **2026-10-01**; extra row on **2025-05-26 (Memorial Day)** | same issues | 1,909, exact |
| CNBC | **missing 2023-04-06** | **missing 2023-04-06** | 1,909, exact |
| stockanalysis | 1,255, exact (2021-10-04 onward) | 1,255, exact | n/a |

No source has a row on any full-closure date. We spot-checked 2019-04-19, 2020-04-10, 2021-12-24,
2022-06-20, 2023-06-19, 2024-03-29, **2025-01-09**, 2025-04-18, 2026-04-03 and 2026-07-03 across all
10 symbol-source series. The one anomaly is Cboe's 2025-05-26 Memorial Day row, which repeats
2025-05-23's OHLC (identical volume for LYFT, different volume for SPY). It is a spurious carry-forward.
Cboe's equity files report generation timestamps of `11:12:06` and `11:18:27`. That fits a mid-session
snapshot taken on 10-02, which would explain why the series stop at 10-01.

## 4. Cross-source diffs

Each comparison covers the overlap of the two sources' date ranges within the window. A ">$0.01" count
means |A−B| > $0.01. Volume is shown as exact matches / days compared, plus the median and maximum %
difference of B versus A. The full detail, including example dates, is in
`data/raw/prices/verification_20261004.json`.

### 4.1 LYFT

| A vs B | Overlap | Only in A | Only in B | Close >$0.01 | Close ≤$0.01 non-zero | Open >$0.01 | High >$0.01 | Low >$0.01 | Vol exact | Vol median % | Vol max % |
|---|---|---|---|---|---|---|---|---|---|---|---|
| nasdaq vs cboe | 2019-03-29..2026-10-01 | – | 2025-05-26 | **0** | 13 (≤ $0.005) | 403 | 42 | 33 | 500/1888 | 0.0 | 81.7 |
| nasdaq vs cnbc | 2019-03-29..2026-10-02 | 2023-04-06 | – | **0** | 0 | 0 | 0 | 0 | 949/1888 | 0.0 | 1.47 |
| nasdaq vs stockanalysis | 2021-10-04..2026-10-02 | – | – | **0** | 0 | 0 | 0 | 0 | 652/1255 | 0.0 | 1.57 |
| cboe vs cnbc | 2019-03-29..2026-10-01 | 2023-04-06, 2025-05-26 | – | 0 | 13 | 403 | 42 | 33 | 1332/1887 | 0.0 | 446 |
| cnbc vs stockanalysis | 2021-10-04..2026-10-02 | – | 2023-04-06 | 0 | 0 | 0 | 0 | 0 | 1014/1254 | 0.0 | 1.57 |

Nasdaq, CNBC and stockanalysis agree on **every LYFT close exactly** on every common date. Open, high
and low differ only by ≤ $0.0005 sub-penny rounding.

### 4.2 SPY

| A vs B | Overlap | Only in A | Only in B | Close >$0.01 | Open >$0.01 | High >$0.01 | Low >$0.01 | Vol exact | Vol median % | Vol max % |
|---|---|---|---|---|---|---|---|---|---|---|
| nasdaq vs cboe | 2019-03-01..2026-10-01 | – | 2025-05-26 | 2 | 1433 | 10 | 2 | 0/1907 | −2.54 | 592 |
| nasdaq vs cnbc | 2019-03-01..2026-10-02 | 2023-04-06 | – | 1 | 1 | 2 | 3 | 154/1907 | 0.0 | 607 |
| nasdaq vs stockanalysis | 2021-10-04..2026-10-02 | – | – | 1 | 1 | 2 | 1 | 101/1254 | 0.0 | 607 |
| cboe vs cnbc | 2019-03-01..2026-10-01 | 2023-04-06, 2025-05-26 | – | 1 | 1431 | 10 | 3 | 1/1907 | +2.60 | 58.7 |
| cnbc vs stockanalysis | 2021-10-04..2026-10-02 | – | 2023-04-06 | 0 | 0 | 2 | 1 | 1184/1254 | 0.0 | 20.6 |

Every SPY close mismatch above $0.01 traces to one of three rows:
- **2026-04-20** (Nasdaq defect): Nasdaq 710.14 vs 708.72 from CNBC, stockanalysis and Cboe.
- **2019-08-12** (Cboe outlier): Cboe 288.12 vs 288.07 from Nasdaq and CNBC.
- The SPY "max %" volume figures are driven by Nasdaq's 2026-04-17 volume of 9,999,999 (see 4.3).

### 4.3 Discrepancies explained

**Data defects (corrected or excluded):**
1. **Nasdaq SPY 2026-04-17 volume = 9,999,999.** This is a sentinel-looking value. CNBC and
   stockanalysis both give 70,661,926 and Cboe gives 69,182,897. The seed uses 70,661,926.
2. **Nasdaq SPY 2026-04-20 is a degraded row:** O=H=L=C=710.14, which is the prior day's close carried
   forward, and volume is `N/A`. CNBC and stockanalysis agree exactly (O 708.78, H 709.91, L 706.14,
   C 708.72, V 43,546,812), and Cboe agrees on H, L and C. The seed takes this row from CNBC.
3. **Cboe 2025-05-26 phantom holiday row** (both symbols) and **missing 2026-10-02**. Cboe is not used
   in the seed.
4. **CNBC is missing 2023-04-06** (both symbols) and has **LYFT pre-IPO placeholder bars**.
5. **Cboe outlier prints:** SPY 2023-06-28 high 453.46 vs 437.44 everywhere else, and LYFT 2022-02-22 open
   and high (42.90 and 43.11 vs 40.84 and 41.38).

**Methodology differences (not errors):**
- **Opens (Cboe vs everyone):** Cboe's open differs by more than 1¢ on 403 of 1,888 LYFT days and
  1,433 of 1,908 SPY days. Nasdaq, CNBC and stockanalysis agree with each other on the open. Cboe's
  open is evidently not the listing market's official opening-auction price; it looks more like a
  first trade. Its high and low also sometimes include prints the official OHLC excludes.
- **Half-cent closes:** 13 LYFT dates have closes like 14.865 (2026-09-25), 12.995 and 16.135.
  Nasdaq, CNBC and stockanalysis report the same half-cent value. Cboe stores 2-decimal floats and
  rounds, which accounts for all 13 "≤ $0.005" close differences. The seed keeps the half-cent value.
- **Volume:**
  - Nasdaq vs CNBC and stockanalysis: the median difference is 0. Most non-exact matches come from
    Nasdaq rounding volume to 10 shares. In 2024–2026 the maximum LYFT difference is under 0.01%.
  - A few older days differ by up to about 1.5% (e.g., LYFT 2023-06-08: 11,407,340 vs 11,240,042).
    That is consistent with snapshots taken before or after late trade reports and corrections.
  - stockanalysis is about 1.5% low on the last few days (2026-09-29 and 09-30). This looks like an
    early snapshot that has not been refreshed. It reports SPY 2026-09-23 as 43.6M vs 54.9M from
    Nasdaq and CNBC.
  - **Cboe volume is systematically different:**
    - SPY is lower on 1,904 of 1,907 days, with a median of −2.5%. That is consistent with excluding
      some trade categories, possibly extended-hours prints.
    - LYFT matches on only 500 days and is lower on 996, by as much as −82% (2021-06-25: 1.91M vs
      10.44M). That looks like partial-day snapshots.
  - Cboe volume is not trusted.
  - First-day LYFT volume: Nasdaq 71,359,660 vs CNBC and Cboe 71,485,240, a 0.18% difference.
    CNN reported more than 70 million shares.

**Unresolved (seed keeps Nasdaq; no close is affected):**
- SPY 2021-05-05 low: Nasdaq and Cboe 415.15 vs CNBC 414.94. Volume: Nasdaq 39,960,660 and Cboe
  37,997,481 vs CNBC 60,284,659. stockanalysis does not reach back that far, and no fourth source was
  available.
- SPY 2022-09-22 high: Nasdaq and CNBC 378.30 vs stockanalysis and Cboe 377.66, a 2–2 split.
- Corroborated by stockanalysis and Cboe, so not really open: SPY 2023-06-05 high and volume and
  SPY 2026-02-02 low, where CNBC is the outlier.

## 5. Corporate actions

### LYFT: no splits, no dividends (verified)
- **Dividends:**
  - Nasdaq's dividend endpoint returns no history and says the company may never have paid one.
  - stockanalysis says LYFT does not pay a dividend (statistics page, ex-dividend date "n/a"). Its
    `/dividend/` page returns 404, and none of its 1,255 LYFT rows carries a `div` field.
  - Lyft's FY2025 10-K, Item 5, Dividend Policy, states: "We have never declared or paid cash
    dividends on our capital stock." Earlier 10-Ks (FY2019–FY2023) say it has never paid cash
    dividends ([FY2025 10-K](https://www.sec.gov/Archives/edgar/data/1759509/000162828026006960/lyft-20251231.htm),
    [FY2019 10-K](https://www.sec.gov/Archives/edgar/data/1759509/000175950920000009/lyft-20191231.htm)).
- **Splits:**
  - stockanalysis's statistics page says the stock has no record of splits.
  - CNBC's split-adjusted series equals Nasdaq's unadjusted closes on all 1,888 common dates. A split
    would make them diverge before the split date.
  - stockanalysis's adjusted close equals its close on all 1,255 rows.
  - A scan of every source for day-over-day close ratios within 3% of 2:1, 3:1, 3:2, 1:2, 1:3, 1:10
    or 10:1 found none.
  - The largest daily moves are all explained by earnings: −36.4% on 2023-02-10, +35.1% on
    2024-02-14, −29.9% on 2022-05-04, +29.0% on 2020-03-19 and +28.1% on 2025-05-09.
- Yahoo event data was not available (429).

### SPY: 31 quarterly distributions, no splits
The source of record is the SSGA historical-distributions workbook. stockanalysis's `div` events
cover 2021-12-17 onward, and **all 20 overlapping amounts match SSGA to 6 decimals**. Neither source
lists an event the other lacks. Every ex-date is a trading session. No capital-gain distribution was
made in the window: the ST/LT columns are blank or 0.000000. No source lists a split, the CNBC
"adjusted" closes equal the unadjusted closes, and the split scan is empty.

| Ex-date | Record | Payable | SSGA $/sh | stockanalysis $/sh |
|---|---|---|---|---|
| 2019-03-15 | 03/18/2019 | 04/30/2019 | 1.233119 | n/a (before 5-year window) |
| 2019-06-21 | 06/24/2019 | 07/31/2019 | 1.431640 | n/a |
| 2019-09-20 | 09/23/2019 | 10/31/2019 | 1.383619 | n/a |
| 2019-12-20 | 12/23/2019 | 01/31/2020 | 1.569992 | n/a |
| 2020-03-20 | 03/23/2020 | 04/30/2020 | 1.405559 | n/a |
| 2020-06-19 | 06/22/2020 | 07/31/2020 | 1.366242 | n/a |
| 2020-09-18 | 09/21/2020 | 10/30/2020 | 1.339224 | n/a |
| 2020-12-18 | 12/21/2020 | 01/29/2021 | 1.580000 | n/a |
| 2021-03-19 | 03/22/2021 | 04/30/2021 | 1.277788 | n/a |
| 2021-06-18 | 06/21/2021 | 07/30/2021 | 1.375875 | n/a |
| 2021-09-17 | 09/20/2021 | 10/29/2021 | 1.428117 | n/a |
| 2021-12-17 | 12/20/2021 | 01/31/2022 | 1.636431 | 1.636431 |
| 2022-03-18 | 03/21/2022 | 04/29/2022 | 1.366009 | 1.366009 |
| 2022-06-17 | 06/21/2022 | 07/29/2022 | 1.576871 | 1.576871 |
| 2022-09-16 | 09/19/2022 | 10/31/2022 | 1.596398 | 1.596398 |
| 2022-12-16 | 12/19/2022 | 01/31/2023 | 1.781400 | 1.781400 |
| 2023-03-17 | 03/20/2023 | 04/28/2023 | 1.506204 | 1.506204 |
| 2023-06-16 | 06/20/2023 | 07/31/2023 | 1.638367 | 1.638367 |
| 2023-09-15 | 09/18/2023 | 10/31/2023 | 1.583169 | 1.583169 |
| 2023-12-15 | 12/18/2023 | 01/31/2024 | 1.906073 | 1.906073 |
| 2024-03-15 | 03/18/2024 | 04/30/2024 | 1.594937 | 1.594937 |
| 2024-06-21 | 06/21/2024 | 07/31/2024 | 1.759024 | 1.759024 |
| 2024-09-20 | 09/20/2024 | 10/31/2024 | 1.745531 | 1.745531 |
| 2024-12-20 | 12/20/2024 | 01/31/2025 | 1.965548 | 1.965548 |
| 2025-03-21 | 03/21/2025 | 04/30/2025 | 1.695528 | 1.695528 |
| 2025-06-20 | 06/20/2025 | 07/31/2025 | 1.761117 | 1.761117 |
| 2025-09-19 | 09/19/2025 | 10/31/2025 | 1.831114 | 1.831114 |
| 2025-12-19 | 12/19/2025 | 01/30/2026 | 1.993368 | 1.993368 |
| 2026-03-20 | 03/20/2026 | 04/30/2026 | 1.796999 | 1.796999 |
| 2026-06-18 | 06/18/2026 | 07/31/2026 | 1.903516 | 1.903516 |
| 2026-09-18 | 09/18/2026 | 10/30/2026 | 1.888834 | 1.888834 |

The sum in the window is $49.917613. Record date equals ex-date from 2024-06-21 onward, after the US
move to T+1 settlement. The 2026-09-18 distribution is payable 2026-10-30. Only the ex-date matters
for price adjustment.

### SPY adjusted close: recomputed and checked
`adj_close` is a dividend-adjusted (total-return) series. No split factor is needed. For each ex-date
E with cash D, every earlier close is multiplied by:

    factor_E = close(E) / (close(E) + D)

By construction, `adj(E)/adj(E−1) − 1 == (close(E) + D)/close(E−1) − 1`. That is exactly the CRSP
holding-period total return, with the dividend reinvested at the ex-date close. The script checks this
identity: the maximum error is 1e−39, which is Decimal noise.

Check against the only provider adjusted close we could reach, stockanalysis `a`, covering 1,255 rows
from 2021-10-04 to 2026-10-02:

| Convention | Max abs deviation | Max rel. deviation | Rows > $0.0005 | Rows > $0.01 |
|---|---|---|---|---|
| **close(E)/(close(E)+D)** (used) | **$0.000498** | 0.013 bp | 0 | 0 |
| Yahoo-style 1 − D/close(E−1) | $0.068609 | 1.62 bp | 1,244 | 1,058 |

A maximum deviation of $0.000498 is the 3-decimal rounding of stockanalysis's values, so its adjusted
close is fully consistent with this total-return adjustment.
- The Yahoo convention gives a cumulative factor at 2019-03-01 of 0.892359, vs 0.891846 for the
  convention used. The largest gap between the two over the full window is $0.18 on a ~$250 price.
  Either is defensible; we picked the one that reproduces textbook total returns exactly.
- One public example appears to use the Yahoo convention. A web-search summary quoted Macrotrends as
  giving SPY's all-time-high close as 775.95 on 2026-08-13. The raw close was 777.88. Our series gives
  775.9558, and the Yahoo convention gives 775.953.

Sanity check (2019-03-01 → 2026-10-02):
- SPY price return: +174.46%.
- SPY total return from `adj_close`: +207.74%.
- S&P 500 price return (Cboe): +175.45%.
- SPY/^GSPC close ratio: 0.100018 at the start, 0.099659 at the end.

## 6. ^GSPC (comparison only, no seed written)
Cboe `_SPX` and CNBC `.SPX` both have exactly 1,909 sessions. All highs and lows match. Closes differ
on 3 dates:
- 2020-03-13: Cboe 2710.95 vs CNBC 2711.02. The widely reported close is 2,711.02.
- 2020-10-05: 3408.60 vs 3408.63.
- 2020-10-06: 3360.97 vs 3360.95.

One open differs: 2019-04-02, 2872.41 vs 2868.24. The recent closes match published figures exactly
(see §7).

## 7. Spot checks against independent public reporting

| Claim | Seed / source value | Public reporting | Match |
|---|---|---|---|
| LYFT IPO day 2019-03-29: open, close | O 87.24, H 88.60, C 78.29 (Nasdaq, CNBC and Cboe agree) | Opened at $87.24 on Nasdaq and closed at $78.29, up 8.7% from the $72 IPO price ([CNBC](https://www.cnbc.com/2019/03/29/lyft-ipo-stock-starts-trading-on-public-market.html), [CNN](https://www.cnn.com/2019/03/29/tech/lyft-goes-public)); 10-K confirms first trading 2019-03-29 ([FY2019 10-K](https://www.sec.gov/Archives/edgar/data/1759509/000175950920000009/lyft-20191231.htm)) | yes |
| LYFT all-time closing low | 7.99 on 2023-05-24 (intraday low 7.85 the same day) | $7.99 on 2023-05-24 ([StatMuse](https://www.statmuse.com/money/ask?q=what+is+the+all-time+low+price+of+lyft+stock), [CompaniesMarketCap](https://companiesmarketcap.com/lyft/stock-price-history/), [Forbes](https://www.forbes.com/sites/greatspeculations/2025/05/21/is-lyfts-low-valuation-an-investment-opportunity/)); intraday 7.85 ([TradingView](https://www.tradingview.com/symbols/NASDAQ-LYFT/)) | yes |
| LYFT 2021 peak close | 67.42 on 2021-03-15 | $67.42 on 2021-03-15 ([Forbes](https://www.forbes.com/sites/greatspeculations/2025/05/21/is-lyfts-low-valuation-an-investment-opportunity/)) | yes |
| LYFT worst day | 2023-02-10 close 10.31, −36.4% | Closed 36.4% lower at $10.31, its worst day on record ([Yahoo/Reuters](https://finance.yahoo.com/news/us-stocks-nasdaq-falls-lyft-182555991.html), [CNBC](https://www.cnbc.com/2023/02/10/lyft-stock-down-more-than-30percent-.html)) | yes |
| LYFT recent close 2026-10-02 | O 15.32, H 15.52, L 15.1477, C 15.46, V 8,248,475 | 15.46 (+1.64%), volume 8,248,475, 52-week high 25.54 on 11/12/25 and low 12.46 on 03/30/26 (web-search summary of quote pages, e.g. [CNBC quote](https://www.cnbc.com/quotes/LYFT)); the seed matches both 52-week extremes | yes |
| LYFT 2026-08-06 close | 16.30 | $16.30 ([StockInvest](https://stockinvest.us/stock-price/LYFT)) | yes |
| SPY recent close 2026-10-02 | O 770.58, H 772.65, C 769.64, V 46,335,300 | 769.64, +5.65 (0.74%), open 770.58, high 772.65; 52-week high 779.37 on 08/13/26 and low 629.28 on 03/30/26 ([stockanalysis](https://stockanalysis.com/etf/spy/), [Yahoo](https://finance.yahoo.com/quote/SPY/history/)) | yes (seed's 52-week extremes match) |
| ^GSPC recent closes | 2026-09-28..10-02: 7683.69, 7670.84, 7651.54, 7666.45, 7722.72 (Cboe = CNBC) | 7,722.72, +56.27 (+0.73%), up 877.22 YTD, which implies a 2025-12-31 close of 6,845.50 (Cboe and CNBC: 6845.50). FRED values for 9/28–10/1 match ([AP via 10TV](https://www.10tv.com/article/syndication/associatedpress/how-major-us-stock-indexes-fared-friday-1022026/616-d20971ba-6304-4287-9c37-c53f5dd2ec14), [FRED SP500](https://fred.stlouisfed.org/series/sp500)) | yes |
| ^GSPC 2020-03-13 | CNBC 2711.02, Cboe 2710.95 | 2,711.02 ([StatMuse March 2020](https://www.statmuse.com/money/ask/s-and-p-500-daily-returns-for-march-2020), [Wikipedia](https://en.wikipedia.org/wiki/Closing_milestones_of_the_S&P_500)) | CNBC yes; Cboe off by 0.07 |
| 2025-01-09 market closure | No row in any of the 10 series | NYSE and Nasdaq closed for the national day of mourning for President Carter ([Nasdaq IR](https://ir.nasdaq.com/news-releases/news-release-details/nasdaq-announces-closure-its-us-markets-honor-national-day-0), [Fox Business](https://www.foxbusiness.com/markets/nyse-nasdaq-close-jan-9-national-day-mourning-following-death-jimmy-carter)) | yes |
| SPY dividends | SSGA workbook | SSGA 2026 schedule lists 3/20/2026 ex-date ([SSGA schedule PDF](https://www.ssga.com/library-content/products/fund-data/etfs/us/distribution/SPDR_Dividend_Distribution_Schedule.pdf)); amounts match stockanalysis exactly ([stockanalysis SPY dividends](https://stockanalysis.com/etf/spy/dividend/)) | yes |

Some reporting arrived through web-search summaries rather than a direct page read. This applies to
the recent-close quote pages and the Macrotrends figure. These are independent confirmations, but
they are not archived snapshots.

## 8. Merged seed files

`data/seed/prices/{LYFT,SPY}.csv` has the columns
`date,open,high,low,close,adj_close,volume,source`. There are no comment lines, dates are ISO, and rows
are sorted ascending. Each file holds one row per expected session, with no gaps, no nulls and no
OHLC inconsistencies (low ≤ open/close ≤ high on every row).

**Primary source: Nasdaq.com**, for these reasons:
- It is the only source that is complete through 2026-10-02 and exactly matches the exchange calendar
  for both symbols. Cboe stops at 10-01 and has a holiday row; CNBC is missing 2023-04-06;
  stockanalysis covers only 5 years.
- It is LYFT's listing exchange. Its open and close agree with CNBC and stockanalysis to the cent on
  every common date.
- It keeps published precision: half-cent closes and sub-penny highs and lows.
- It is unadjusted, so the adjustment is fully under our control and traceable to SSGA's official
  distributions.

The known weaknesses are two defective SPY rows in April 2026 and SPY volume rounded to 10 shares.

**Override rule:** a Nasdaq field is replaced only when it disagrees with CNBC (more than $0.01 on
price, more than 5% on volume) **and** CNBC is corroborated by a third source. The third source is
stockanalysis, or Cboe for high, low and close only, because Cboe opens and volumes follow different
methods. This rule fired on exactly two SPY rows (§4.3 items 1 and 2) and on no LYFT rows.

**`source` column values:**
- LYFT: `nasdaq` on all 1,889 rows.
- SPY: `nasdaq;adj_close=calc_ssga_div` on 1,907 rows, `nasdaq;volume=cnbc;adj_close=calc_ssga_div`
  on 1 row (2026-04-17), and `cnbc;adj_close=calc_ssga_div` on 1 row (2026-04-20).

**`adj_close`:**
- LYFT: equals `close`, since LYFT has had no splits or dividends.
- SPY: total-return series per §5, rounded to 4 decimals. It equals `close` from the last ex-date
  (2026-09-18) onward.

Corroboration of closes: every LYFT close is matched within $0.01 by 3–4 of the 4 sources. Every SPY
close is matched by at least 2 independent sources: 1,252 rows by all 4, 656 by 3, and 1 by 2
(2019-08-12, where Cboe is the outlier).

### Reproduce
```
python3 scripts/prices/verify_prices.py 20261004
```
The script reads only the raw files above, rewrites both seed CSVs, and writes the full diff report
to `data/raw/prices/verification_20261004.json`. The calendar cross-check used
`uv run --no-project --with exchange_calendars` (4.13.2).

## 9. Caveats and open items
- **Licensing:** Nasdaq.com, Cboe's CDN, CNBC's timeseries API and stockanalysis.com are website
  back-ends, not licensed data feeds. SSGA's workbook is public fund documentation. These are fine for
  a local prototype only. Public display needs a licensed feed; that question is being researched
  separately.
- **Not verified here:**
  - Yahoo's adjusted close and event data (429).
  - Stooq (bot-check page).
  - FRED's S&P 500 series, except via a search summary.
  - A provider adjusted close for SPY before 2021-10-04. That period relies on our own calculation
    from SSGA's official amounts, the same method that matched the provider within rounding for
    2021–2026.
  - The SPY 2021-05-05 low and volume and the 2022-09-22 high, which have conflicting sources (§4.3).
- **Volume** is consolidated volume as published by Nasdaq.com. It is rounded to 10 shares for SPY and
  for many LYFT days, and it can differ by up to about 1.5% from other vendors because of late-report
  timing. Do not treat volume as exact.
- **Sub-penny values** are the vendors' published values, kept verbatim. They are not errors.
- **Name change:** SSGA renamed the fund "State Street SPDR S&P 500 ETF Trust" in January 2026.
  The ticker (SPY) and CUSIP (78462F103) are unchanged, so price continuity is unaffected.
- **These are end-of-day values as of retrieval.** Vendors occasionally revise recent volume, so a
  re-pull may differ slightly on the last few sessions.
