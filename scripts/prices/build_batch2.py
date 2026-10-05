#!/usr/bin/env python3
"""Batch 2: build and cross-verify deep daily price history + corporate actions for 12 stocks and SPY.

Reads only untouched raw responses under data/raw/prices/<source>/ and writes:
  - data/seed/prices/<SYMBOL>.csv          date,open,high,low,close,adj_close,volume,source
  - data/seed/prices/<SYMBOL>_actions.csv  ex_date,action_type,cash_amount,record_date,pay_date,split_from,split_to
  - data/raw/prices/verification_batch2_<RETRIEVED>.json  (full diff report; gitignored)

Closes are raw as-traded. CNBC's "unadjusted" bars are the base; every field is cross-checked against
Nasdaq (historical API for the last 10 years, chart API back to 1990; both split-adjusted, converted
back with the verified split table), Cboe (2004+, split-adjusted, 2 dp) and stockanalysis.com (5 years).
A base value is replaced only when a second independent vendor contradicts it AND a third agrees with
the replacement. Nothing is interpolated or filled.

Usage (exchange_calendars supplies the session calendar):
  uv run --no-project --with exchange_calendars python scripts/prices/build_batch2.py [RETRIEVED_YYYYMMDD]
"""

from __future__ import annotations

import bisect
import csv
import datetime as dt
import json
import re
import statistics
import sys
import zipfile
import xml.etree.ElementTree as ET
from decimal import ROUND_HALF_UP, Decimal, getcontext
from pathlib import Path

import exchange_calendars as xcals

getcontext().prec = 40
D = Decimal
ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "prices"
SEED = ROOT / "data" / "seed" / "prices"
R = sys.argv[1] if len(sys.argv) > 1 else "20261004"
END = dt.date(2026, 10, 2)
SA_START = dt.date(2021, 10, 4)
BATCH1_START = dt.date(2019, 3, 1)  # SPY rows from here on are kept exactly as verified in batch 1
T1_START = dt.date(2024, 5, 28)  # US T+1 settlement: record date == ex-date from here on

# ------------------------------------------------------------------ configuration
# start: first session in the seed. IPO names start on their first trading day. AAPL/MSFT/KO start 1990-01-02, the
# first day the second independent vendor (Nasdaq chart API) covers; JPM starts 1992-01-02, the first year whose
# dividends a saved SEC filing confirms (Chemical's 1991 total is restated for the MHC merger; see the batch-2 doc).
SYMBOLS: dict[str, dict] = {
    "AAPL": dict(start="1990-01-02"), "MSFT": dict(start="1990-01-02"), "NVDA": dict(start="1999-01-22"),
    "GOOGL": dict(start="2004-08-19"), "AMZN": dict(start="1997-05-15"), "META": dict(start="2012-05-18"),
    "TSLA": dict(start="2010-06-29"), "NFLX": dict(start="2002-05-23"), "UBER": dict(start="2019-05-10"),
    "ABNB": dict(start="2020-12-10"), "JPM": dict(start="1992-01-02"), "KO": dict(start="1990-01-02"),
    "SPY": dict(start="1993-01-29", cnbc="SPY_full", nasdaq="SPY_full"),
}
# Verified splits (ex-date = first split-adjusted session, ratio = new shares per old share).
# Each is checked below against (a) every vendor's implied adjustment factor and (b) the raw price
# drop on the ex-date; primary-source citations are in docs/research/price-data-verification-batch2.md.
SPLITS: dict[str, list[tuple[str, Decimal]]] = {
    "AAPL": [("2000-06-21", D(2)), ("2005-02-28", D(2)), ("2014-06-09", D(7)), ("2020-08-31", D(4))],
    "MSFT": [("1990-04-16", D(2)), ("1991-06-27", D("1.5")), ("1992-06-15", D("1.5")), ("1994-05-23", D(2)),
             ("1996-12-09", D(2)), ("1998-02-23", D(2)), ("1999-03-29", D(2)), ("2003-02-18", D(2))],
    "NVDA": [("2000-06-27", D(2)), ("2001-09-17", D(2)), ("2006-04-07", D(2)), ("2007-09-11", D("1.5")),
             ("2021-07-20", D(4)), ("2024-06-10", D(10))],
    "GOOGL": [("2014-04-03", D(2)), ("2022-07-18", D(20))],
    "AMZN": [("1998-06-02", D(2)), ("1999-01-05", D(3)), ("1999-09-02", D(2)), ("2022-06-06", D(20))],
    "META": [], "UBER": [], "ABNB": [], "SPY": [],
    "TSLA": [("2020-08-31", D(5)), ("2022-08-25", D(3))],
    "NFLX": [("2004-02-12", D(2)), ("2015-07-15", D(7)), ("2025-11-17", D(10))],
    "JPM": [("1998-06-15", D(2)), ("2000-06-12", D("1.5"))],
    "KO": [("1990-05-14", D(2)), ("1992-05-12", D(2)), ("1996-05-13", D(2)), ("2012-08-13", D(2))],
}
SPLIT_RATIO_TEXT = {D(2): (1, 2), D(3): (1, 3), D(4): (1, 4), D(5): (1, 5), D(7): (1, 7), D(10): (1, 10),
                    D(20): (1, 20), D("1.5"): (2, 3)}
DIV_SYMBOLS = {"AAPL", "MSFT", "NVDA", "GOOGL", "META", "JPM", "KO", "SPY"}

# Dividend totals per share printed in 10-K filings (saved under data/raw/prices/sec/), on the share
# basis in effect at the filing date. Used only to cross-check the assembled ex-date list.
TENK_DIV_TOTALS = {
    "KO": [  # calendar years; restated for splits up to basis_date
        dict(doc="sec/KO_10K_FY2001_0000021344-02-000011.txt (11-year summary, 'Cash dividends')", basis="2002-03-11",
             years={1991: ".24", 1992: ".28", 1993: ".34", 1994: ".39", 1995: ".44", 1996: ".50", 1997: ".56",
                    1998: ".60", 1999: ".64", 2000: ".68", 2001: ".72"}),
        dict(doc="sec/KO_10K_FY1999_0000021344-00-000009.txt (11-year summary, 'Cash dividends')", basis="2000-03-09",
             years={1990: ".20"}),
        dict(doc="sec/KO_10K_FY2004_0001047469-05-005411.txt (Item 5 'Dividends Declared' + Item 6)", basis="2005-03-04",
             years={2002: "0.80", 2003: "0.88", 2004: "1.00"}),
        dict(doc="sec/KO_10K_FY2008_0001047469-09-001875.txt (Item 6 'Cash dividends')", basis="2009-02-26",
             years={2005: "1.12", 2006: "1.24", 2007: "1.36", 2008: "1.52"}),
    ],
    "AAPL": [  # 'Cash dividends declared per common share' $0.12 in each fiscal quarter of FY1995 and Q1 FY1996
        dict(doc="sec/AAPL_10K_FY1996_0000320193-96-000023.txt (quarterly table; FY1995 10-K agrees)", basis="1996-12-19",
             years={1995: "0.48", 1996: "0.00"}),
        dict(doc="sec/AAPL_10K_FY1994_0000320193-94-000016.txt (quarterly table, FY1993-FY1994)", basis="1994-12-13",
             years={1993: "0.48", 1994: "0.48"}),
    ],
    "SPY": [  # SPDR Trust annual reports, 'Less distributions from: Net investment income' (+ 'in excess of') per unit;
              # per-unit figures there are computed on units outstanding, so agreement is to about a cent
        dict(doc="sec/SPY_N30D_FY1995_0000912057-96-003840.txt + sec/SPY_N30D_FY1996_0000912057-97-006798.txt (financial highlights)",
             basis="1997-02-26", years={1993: "1.10", 1994: "1.23", 1995: "1.27", 1996: "1.28"}, tol="0.011"),
        dict(doc="sec/SPY_N30D_FY2006_0000950135-06-007169.txt (financial highlights, fiscal years ending Sep 30)",
             basis="2006-11-29", years={2002: "1.46", 2003: "1.55", 2004: "1.79", 2005: "2.40", 2006: "2.33"}, tol="0.011",
             fy_end_month=9),
    ],
    "JPM": [  # 'Cash dividends declared per share' by year of declaration
        dict(doc="sec/JPM_10K_FY1995_0000950123-96-001197.txt (Chemical Banking, selected financial data)", basis="1996-03-20",
             years={1992: "1.20", 1993: "1.37", 1994: "1.64"}),
        dict(doc="sec/JPM_10K_FY1996_0000950123-97-002412.txt (quarterly: .44 .50 .50 .50 / .56 x4)", basis="1997-03-25",
             years={1995: "1.94", 1996: "2.24"}),
        dict(doc="sec/JPM_10K_FY1999_0000950123-00-002204.txt (Selected financial data)", basis="2000-03-13",
             years={1995: "0.97", 1996: "1.12", 1997: "1.24", 1998: "1.44", 1999: "1.64"}),
        dict(doc="sec/JPM_10K_FY2004_0000950123-05-002539.txt (Selected financial data)", basis="2005-03-02",
             years={2000: "1.28", 2001: "1.36", 2002: "1.36", 2003: "1.36", 2004: "1.36"}),
        dict(doc="sec/JPM_10K_FY2008_0000950123-09-003840.txt (Selected financial data)", basis="2009-03-02",
             years={2005: "1.36", 2006: "1.36", 2007: "1.48", 2008: "1.52"}),
    ],
}
# Quarter-end / year-end closes printed in SEC filings (rounded to cents there), for level checks.
TENK_CLOSES = {
    "KO": dict(doc="sec/KO_10K_FY1999 'Stock prices' (NYSE) and FY2001/FY2004 'Market price on December 31' (restated)",
               basis={"1999-12-31": "2000-03-09", "2001-12-31": "2002-03-11", "2004-12-31": "2005-03-04"},
               closes={"1998-03-31": "77.44", "1998-06-30": "85.50", "1998-09-30": "57.63", "1998-12-31": "67.00",
                       "1999-03-31": "61.38", "1999-06-30": "62.00", "1999-09-30": "48.25", "1999-12-31": "58.25",
                       "1995-12-29": "37.13", "1996-12-31": "52.63", "1997-12-31": "66.69", "2000-12-29": "60.94",
                       "2001-12-31": "47.15", "2003-12-31": "50.75", "2004-12-31": "41.64",
                       "1990-12-31": "11.63", "1991-12-31": "20.06", "1992-12-31": "20.94", "1993-12-31": "22.31",
                       "1994-12-30": "25.75"}),
    "JPM": dict(doc="sec/JPM_10K_FY1999 'Share price' (NYSE composite, restated for the 1998 split)",
                closes={"1998-03-31": "67.44", "1998-06-30": "75.50", "1998-09-30": "43.13", "1998-12-31": "71.00",
                        "1999-03-31": "81.38", "1999-06-30": "86.50", "1999-09-30": "75.38", "1999-12-31": "77.69",
                        "1995-12-29": "29.38", "1996-12-31": "44.69", "1997-12-31": "54.75",
                        "1992-12-31": "38.63", "1993-12-31": "40.13", "1994-12-30": "35.88"}),
}
# split basis (document date) of each TENK_CLOSES value: the filing restates for splits up to that date
TENK_CLOSE_BASIS = {
    "KO": {"1995-12-29": "2002-03-11", "1996-12-31": "2002-03-11", "1997-12-31": "2002-03-11", "2000-12-29": "2002-03-11",
           "2001-12-31": "2002-03-11", "2003-12-31": "2005-03-04", "2004-12-31": "2005-03-04",
           "1991-12-31": "2002-03-11", "1992-12-31": "2002-03-11", "1993-12-31": "2002-03-11", "1994-12-30": "2002-03-11"},
    # JPM: FY1999 10-K (restated for the 1998 split) except the Chemical-era year ends from the FY1995 10-K
    "JPM": {"1992-12-31": "1996-03-20", "1993-12-31": "1996-03-20", "1994-12-30": "1996-03-20"},
}
TENK_DEFAULT_BASIS = {"KO": "2000-03-09", "JPM": "2000-03-13"}

# Independent public reporting gathered for spot checks (see the batch-2 doc for context). basis: U = as-traded,
# SA = split-adjusted to today's shares. how: read = page opened and value confirmed; snippet = search-result text only.
SPOT_CHECKS = [
    # sym, date, field, value, basis, source, url, how
    ("AAPL", "2020-08-28", "close", "499.23", "U", "Alpha Spread split table", "https://www.alphaspread.com/security/nasdaq/aapl/investor-returns/i/stock-splits", "read"),
    ("AAPL", "2020-08-31", "close", "129.04", "U", "Benzinga (CNN: 'just over $129')", "", "snippet"),
    ("AAPL", "2014-06-06", "close", "645.57", "U", "AppleInsider", "https://appleinsider.com/articles/14/06/07/apple-increases-issued-shares-for-7-for-1-stock-split-in-official-sec-amendment", "read"),
    ("AAPL", "2014-06-09", "close", "93.70", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AAPL", "read"),
    ("AAPL", "2005-02-25", "close", "88.99", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AAPL", "read"),
    ("AAPL", "2005-02-28", "close", "44.86", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AAPL", "read"),
    ("AAPL", "2000-06-20", "close", "101.25", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AAPL", "read"),
    ("AAPL", "2000-06-21", "close", "55.62", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AAPL", "read"),
    ("AAPL", "1996-09-27", "close", "22.31", "U", "Apple 1996 proxy (DEF 14A): 'closing price ... September 27, 1996'", "https://www.sec.gov/Archives/edgar/data/0000320193/000091205796030278/0000912057-96-030278.txt", "read"),
    ("MSFT", "1996-12-06", "close", "152.875", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1996-12-09", "close", "81.75", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1998-02-20", "close", "155.13", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1998-02-23", "close", "81.63", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1999-03-26", "close", "178.13", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1999-03-29", "close", "92.38", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "2003-02-14", "close", "48.30", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "2003-02-18", "close", "24.96", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "2000-09-15", "close", "64.1875", "U", "Microsoft 2000 proxy (DEF 14A)", "https://www.sec.gov/Archives/edgar/data/789019/000095010900500097/ddef14a.htm", "read"),
    ("MSFT", "2019-04-25", "close", "129.15", "U", "AFP via phys.org", "https://phys.org/news/2019-04-microsoft-tops-trillion-dollar.html", "read"),
    ("NVDA", "1999-01-22", "close", "19.69", "U", "Bitget (weak; dfarq.homeip.net says '$21 by day's end')", "https://dfarq.homeip.net/nvidias-ipo-on-january-22-1999/", "snippet"),
    ("NVDA", "2021-07-19", "close", "751.19", "U", "Alpha Spread split table", "https://www.alphaspread.com/security/nasdaq/nvda/investor-returns/i/stock-splits", "read"),
    ("NVDA", "2024-06-07", "close", "1208.88", "U", "Yahoo Finance news article", "https://finance.yahoo.com/news/nvidia-stock-rises-after-10-for-1-stock-split-204412528.html", "read"),
    ("NVDA", "2024-06-18", "close", "135.58", "U", "Al Jazeera", "https://www.aljazeera.com/economy/2024/6/19/nvidia-becomes-worlds-most-valuable-company-dethroning-microsoft", "read"),
    ("GOOGL", "2004-08-19", "open", "100.00", "U", "Motley Fool", "https://www.fool.com/investing/2019/11/25/if-you-invested-10000-in-googles-ipo-this-is-how-m.aspx", "read"),
    ("GOOGL", "2004-08-19", "close", "100.34", "U", "Motley Fool", "https://www.fool.com/investing/2019/11/25/if-you-invested-10000-in-googles-ipo-this-is-how-m.aspx", "read"),
    ("GOOGL", "2014-04-02", "close", "1135.10", "U", "AFP via phys.org", "https://phys.org/news/2014-04-google-exits-stock-club-special.html", "read"),
    ("GOOGL", "2014-04-03", "close", "571.50", "U", "TimeToTrade wiki", "", "snippet"),
    ("GOOGL", "2022-07-15", "close", "2235.55", "U", "Alpha Spread split table", "https://www.alphaspread.com/security/nasdaq/googl/investor-returns/i/stock-splits", "read"),
    ("AMZN", "1997-05-15", "close", "23.50", "U", "TechCrunch quoting 1997 CNET", "https://techcrunch.com/?p=1509063", "read"),
    ("AMZN", "1997-05-15", "open", "27", "U", "MIT Sloan case PDF (search summary)", "", "snippet"),
    ("AMZN", "1998-06-01", "close", "85.63", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AMZN", "read"),
    ("AMZN", "1998-06-02", "close", "43.69", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AMZN", "read"),
    ("AMZN", "1999-01-04", "close", "354.94", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AMZN", "read"),
    ("AMZN", "1999-01-05", "close", "124.50", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AMZN", "read"),
    ("AMZN", "1999-09-01", "close", "119.06", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AMZN", "read"),
    ("AMZN", "1999-09-02", "close", "60.06", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/AMZN", "read"),
    ("AMZN", "2022-06-03", "close", "122.35", "SA", "StatMuse", "https://www.statmuse.com/money/ask/amazon-stock-price-june-2022", "read"),
    ("AMZN", "2022-06-06", "close", "124.79", "U", "StatMuse", "https://www.statmuse.com/money/ask/amazon-stock-price-june-2022", "read"),
    ("META", "2012-05-18", "open", "42.05", "U", "TechCrunch (first trade)", "https://techcrunch.com/2012/05/18/facebook-share-open-10-5-higher-at-42", "read"),
    ("META", "2012-05-18", "close", "38.23", "U", "AP via CBS New York", "https://www.cbsnews.com/newyork/news/facebook-to-make-stock-market-debut/", "read"),
    ("META", "2022-02-03", "close", "237.76", "U", "Benzinga/Forbes (-26.4%)", "", "snippet"),
    ("META", "2022-06-08", "close", "196.64", "U", "FinancialContent/ADVFN (last FB day)", "", "snippet"),
    ("META", "2022-06-09", "close", "184.00", "U", "Decrypt (first META day, -6.43%)", "https://decrypt.co/102484/facebook-stock-falls-stock-symbol-change-meta", "read"),
    ("TSLA", "2010-06-29", "open", "19.00", "U", "AP via NBC News", "https://www.nbcnews.com/id/wbna38000234", "read"),
    ("TSLA", "2010-06-29", "low", "17.55", "U", "AP via NBC News", "https://www.nbcnews.com/id/wbna38000234", "read"),
    ("TSLA", "2010-06-29", "close", "23.89", "U", "AP via NBC News", "https://www.nbcnews.com/id/wbna38000234", "read"),
    ("TSLA", "2020-08-28", "close", "2213.40", "U", "Teslarati", "https://www.teslarati.com/tesla-tsla-stock-price-adjustment-5-to-1-split/", "read"),
    ("TSLA", "2020-08-31", "close", "498.32", "U", "Motley Fool", "https://www.fool.com/investing/2020/09/06/why-tesla-shares-skyrocketed-in-august/", "read"),
    ("TSLA", "2022-08-24", "close", "891.29", "U", "FOREX.com", "", "snippet"),
    ("TSLA", "2022-08-25", "close", "296.07", "U", "StatMuse", "https://www.statmuse.com/money/ask/tesla-stock-price-august-2022", "read"),
    ("NFLX", "2002-05-23", "close", "16.75", "U", "CNNMoney", "https://money.cnn.com/2002/05/23/markets/ipo/ipos/index.htm", "snippet"),
    ("NFLX", "2002-05-23", "high", "17.40", "U", "CNNMoney", "https://money.cnn.com/2002/05/23/markets/ipo/ipos/index.htm", "snippet"),
    ("NFLX", "2025-11-14", "close", "111.22", "SA", "StatMuse", "https://www.statmuse.com/money/ask/netflix-stock-price-november-2025", "read"),
    ("NFLX", "2025-11-17", "close", "110.29", "U", "StatMuse", "https://www.statmuse.com/money/ask/netflix-stock-price-november-2025", "read"),
    ("UBER", "2019-05-10", "open", "42.00", "U", "Gulf News", "https://gulfnews.com/business/markets/ubers-ipo-joins-ranks-of-wall-street-flops-1.63896775", "read"),
    ("UBER", "2019-05-10", "close", "41.57", "U", "Gulf News", "https://gulfnews.com/business/markets/ubers-ipo-joins-ranks-of-wall-street-flops-1.63896775", "read"),
    ("UBER", "2025-10-06", "close", "100.10", "U", "StatMuse (record close)", "https://www.statmuse.com/money/ask?q=uber+stock+price+history+all-time+high", "read"),
    ("ABNB", "2020-12-10", "open", "146.00", "U", "Al Jazeera", "https://www.aljazeera.com/economy/2020/12/10/travelling-far-and-wide-airbnbs-ipo-smashes-records", "read"),
    ("ABNB", "2020-12-10", "high", "165.00", "U", "Al Jazeera", "https://www.aljazeera.com/economy/2020/12/10/travelling-far-and-wide-airbnbs-ipo-smashes-records", "read"),
    ("ABNB", "2020-12-10", "close", "144.71", "U", "Al Jazeera", "https://www.aljazeera.com/economy/2020/12/10/travelling-far-and-wide-airbnbs-ipo-smashes-records", "read"),
    ("ABNB", "2021-02-11", "close", "216.84", "U", "Macrotrends/TradingView (record close)", "", "snippet"),
    ("JPM", "2000-09-12", "close", "53.75", "U", "TheStreet (CMB)", "", "snippet"),
    ("JPM", "2026-08-12", "close", "365.31", "U", "record close (search summary)", "", "snippet"),
    ("KO", "1996-05-10", "close", "83.88", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/KO", "read"),
    ("KO", "1996-05-13", "close", "43.00", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/KO", "read"),
    ("KO", "2012-08-10", "close", "78.79", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/KO", "read"),
    ("KO", "2012-08-13", "close", "39.30", "U", "getsplithistory.com (secondary)", "https://getsplithistory.com/KO", "read"),
    ("MSFT", "1990-04-12", "close", "120.75", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1990-04-16", "close", "60.75", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1991-06-26", "close", "100.75", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1991-06-27", "close", "68.00", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1992-06-12", "close", "112.50", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1992-06-15", "close", "75.75", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1994-05-20", "close", "97.75", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("MSFT", "1994-05-23", "close", "50.63", "U", "Microsoft IR FAQ split table", "https://www.microsoft.com/en-us/investor/faq", "read"),
    ("SPY", "1993-01-29", "open", "43.96875", "U", "Kaggle dataset (search summary)", "", "snippet"),
    ("SPY", "1993-01-29", "close", "43.9375", "U", "Kaggle dataset (search summary)", "", "snippet"),
    ("SPY", "1993-01-29", "volume", "1003200", "U", "Kaggle dataset; SEC FWP: 'just over 1 million shares'", "", "snippet"),
]
# Apple 10-K quarterly "price range per common share", fiscal quarters, as-traded (pre-2000 split). The FY1994 10-K's
# figures (FY1993-FY1994) are highest/lowest CLOSING prices; the FY1995 and FY1996 10-Ks' new figures are intraday
# highs/lows (the FY1995 text still says closing). FY1996 values are rounded to cents.
AAPL_10K_PRICE_RANGES = {  # (start, end): (high, low, doc)
    ("1992-12-26", "1993-03-26"): ("65", "52.75", "FY1994"), ("1993-03-27", "1993-06-25"): ("58.75", "39.625", "FY1994"),
    ("1993-06-26", "1993-09-24"): ("40.125", "24.25", "FY1994"), ("1993-09-25", "1993-12-31"): ("34", "22.5", "FY1994"),
    ("1994-01-01", "1994-04-01"): ("38.125", "29.25", "FY1994"), ("1994-04-02", "1994-07-01"): ("33.5", "25.125", "FY1994"),
    ("1994-07-02", "1994-09-30"): ("36.375", "26.125", "FY1994"), ("1994-10-01", "1994-12-30"): ("43.75", "32.5", "FY1995"),
    ("1994-12-31", "1995-03-31"): ("48", "33.875", "FY1995"), ("1995-04-01", "1995-06-30"): ("50.125", "33.625", "FY1995"),
    ("1995-07-01", "1995-09-29"): ("49.875", "34.6875", "FY1995"), ("1995-09-30", "1995-12-29"): ("42.50", "31.44", "FY1996"),
    ("1995-12-30", "1996-03-29"): ("35.50", "23.00", "FY1996"), ("1996-03-30", "1996-06-28"): ("28.88", "19.63", "FY1996"),
    ("1996-06-29", "1996-09-27"): ("25.00", "16.00", "FY1996"),
}

# ------------------------------------------------------------------ helpers


def dec(s) -> Decimal | None:
    if s is None:
        return None
    s = str(s).strip().replace("$", "").replace(",", "")
    if s in ("", "N/A", "null", "None"):
        return None
    return D(s)


def num_str(d: Decimal | None) -> str:
    if d is None:
        return ""
    s = format(d.normalize(), "f")
    if "." not in s:
        s += ".00"
    elif len(s.split(".")[1]) == 1:
        s += "0"
    return s


def parse_date(s: str) -> dt.date:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError(s)


def bar(o, h, l, c, v):
    v = dec(v)
    return {"open": dec(o) or None, "high": dec(h) or None, "low": dec(l) or None, "close": dec(c) or None,
            "volume": None if v is None or v == 0 else int(v)}


def sessions(start: dt.date, end: dt.date) -> list[dt.date]:
    cal = xcals.get_calendar("XNYS", start="1990-01-02", end="2026-12-31")
    return [x.date() for x in cal.sessions_in_range(start.isoformat(), end.isoformat())]


def factor(sym: str, d: dt.date) -> Decimal:
    """Cumulative split factor: as-traded price on d = split-adjusted price * factor."""
    f = D(1)
    for e, r in SPLITS[sym]:
        if d < dt.date.fromisoformat(e):
            f *= r
    return f


def split_interval(sym: str, d: dt.date) -> int:
    return sum(1 for e, _ in SPLITS[sym] if d >= dt.date.fromisoformat(e))


# ------------------------------------------------------------------ loaders (raw files only)


def load_cnbc(name: str, unadjusted: bool) -> dict:
    f = RAW / "cnbc" / f"{name}_{R}{'_unadjusted' if unadjusted else ''}.json"
    j = json.loads(f.read_text())
    return {parse_date(r["tradeTime"][:8]): bar(r["open"], r["high"], r["low"], r["close"], r["volume"])
            for r in j["barData"]["priceBars"]}


def load_nasdaq_hist(name: str) -> dict:
    j = json.loads((RAW / "nasdaq" / f"{name}_{R}.json").read_text())
    return {parse_date(r["date"]): bar(r["open"], r["high"], r["low"], r["close"], r["volume"])
            for r in j["data"]["tradesTable"]["rows"]}


def load_nasdaq_chart(name: str) -> dict:
    j = json.loads((RAW / "nasdaq_chart" / f"{name}_{R}.json").read_text())
    out = {}
    for r in j["data"]["chart"]:
        z = r["z"]
        out[parse_date(z["dateTime"])] = bar(z["open"], z["high"], z["low"], z["close"], z["volume"])
    return out


def load_cboe(name: str) -> dict:
    j = json.loads((RAW / "cboe" / f"{name}_{R}.json").read_text())
    return {parse_date(r["date"]): bar(r["open"], r["high"], r["low"], r["close"], r["volume"]) for r in j["data"]}


def load_sa(name: str) -> dict:
    j = json.loads((RAW / "stockanalysis" / f"{name}_{R}.json").read_text())
    out = {}
    for r in j["data"]:
        b = bar(r["o"], r["h"], r["l"], r["c"], r["v"])
        b["adj"] = dec(r["a"])
        b["div"] = dec(r.get("div"))
        out[parse_date(r["t"])] = b
    return out


def load_nasdaq_divs(sym: str) -> list[dict]:
    f = RAW / "nasdaq" / f"{sym}_dividends_{R}.json"
    if not f.exists():
        return []
    rows = ((json.loads(f.read_text()).get("data") or {}).get("dividends") or {}).get("rows") or []
    out = []
    for r in rows:
        g = lambda k: None if r.get(k) in (None, "N/A") else parse_date(r[k])
        out.append(dict(ex=parse_date(r["exOrEffDate"]), type=r["type"], amount=dec(r["amount"]),
                        decl=g("declarationDate"), record=g("recordDate"), pay=g("paymentDate")))
    return out


def load_dho(sym: str) -> list[dict]:
    """dividendhistory.org: ex-date, payout date, split-adjusted cash amount; skips estimated rows."""
    f = RAW / "dividendhistory_org" / f"{sym}_{R}.html"
    if not f.exists():
        return []
    t = f.read_text(encoding="utf-8")
    tb = t[t.find('<table id="dividend-table"'):]
    tb = tb[: tb.find("</table>")]
    out = []
    for attrs, r in re.findall(r"<tr([^>]*)>(.*?)</tr>", tb, flags=re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", r, flags=re.S)
        if len(tds) < 3 or "unconfirmed" in attrs:
            continue
        note = re.sub("<[^>]+>", "", tds[3]).strip() if len(tds) > 3 else ""
        out.append(dict(ex=parse_date(tds[0]), pay=parse_date(tds[1]),
                        amount_adj=dec(re.sub("<[^>]+>", "", tds[2])), note=note))
    return out


def load_sa_divs(sym: str) -> list[dict]:
    f = RAW / "stockanalysis" / f"{sym}_dividend_page_{R}.html"
    if not f.exists():
        return []
    t = f.read_text(encoding="utf-8")
    out = []
    for m in re.finditer(r'dt:"([0-9-]+)",amt:"\$([0-9.]+)",dec:"([^"]*)",record:"([^"]*)",pay:"([^"]*)"', t):
        g = lambda s: parse_date(s) if re.match(r"\d{4}-\d\d-\d\d$", s) else None
        out.append(dict(ex=parse_date(m.group(1)), amount_adj=D(m.group(2)), decl=g(m.group(3)),
                        record=g(m.group(4)), pay=g(m.group(5))))
    return out


XBRL_CONCEPTS = ("CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid")


def load_xbrl(sym: str) -> list[dict]:
    """Quarterly and annual dividends-per-share facts from the company's own XBRL filings. For each
    period the value from the earliest filing is kept, i.e. on the share basis in effect at that filing."""
    out = []
    cf = RAW / "sec" / f"{sym}_xbrl_companyfacts_{R}.json"
    facts = json.loads(cf.read_text())["facts"]["us-gaap"] if cf.exists() else None
    for concept in XBRL_CONCEPTS:
        if facts is not None:  # companyfacts is complete where the companyconcept endpoint returned no units (KO)
            j = facts.get(concept, {})
        else:
            f = RAW / "sec" / f"{sym}_xbrl_{concept}_{R}.json"
            try:
                j = json.loads(f.read_text())
            except (FileNotFoundError, ValueError):  # concept not reported (saved 404 body)
                continue
        best = {}
        for unit, u in j.get("units", {}).items():
            if unit != "USD/shares":
                continue
            for x in u:
                if "start" not in x:
                    continue
                a, b = dt.date.fromisoformat(x["start"]), dt.date.fromisoformat(x["end"])
                n = (b - a).days
                kind = "Q" if 80 <= n <= 100 else "FY" if 350 <= n <= 380 else None
                if kind and ((a, b) not in best or x["filed"] < best[(a, b)]["filed"]):
                    best[(a, b)] = dict(x, kind=kind)
        for (a, b), x in sorted(best.items()):
            out.append(dict(concept=concept, kind=x["kind"], start=a, end=b, val=D(str(x["val"])), form=x["form"],
                            filed=dt.date.fromisoformat(x["filed"]), accn=x["accn"]))
    return out


def xlsx_rows(path: Path, sheet: int = 1) -> list[dict]:
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
        sh = ET.fromstring(z.read(f"xl/worksheets/sheet{sheet}.xml"))
    rows = []
    for r in sh.iter(f"{{{ns['m']}}}row"):
        vals = {}
        for c in r.findall("m:c", ns):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v, is_ = c.find("m:v", ns), c.find("m:is", ns)
            if c.get("t") == "s" and v is not None:
                vals[col] = shared[int(v.text)]
            elif c.get("t") == "inlineStr" and is_ is not None:
                vals[col] = "".join(t.text or "" for t in is_.iter(f"{{{ns['m']}}}t"))
            elif v is not None:
                vals[col] = v.text
        rows.append(vals)
    return rows


def excel_date(s: str) -> dt.date:
    return dt.date(1899, 12, 30) + dt.timedelta(days=int(float(s)))


def load_msft_ir() -> list[dict]:
    """Microsoft IR 'Microsoft Dividend History.xlsx': sheet1 quarterly, sheet2 annual, sheet3 special."""
    path = RAW / "ir" / f"MSFT_dividend-history_{R}.xlsx"
    out = []
    for sheet, kind in ((1, "cash_dividend"), (2, "cash_dividend"), (3, "special_dividend")):
        rows = xlsx_rows(path, sheet)
        for r in rows[1:]:
            if not r.get("B"):
                continue
            out.append(dict(ex=excel_date(r["D"]), amount=D(r["B"]).quantize(D("0.0001")).normalize(), type=kind,
                            decl=excel_date(r["C"]), record=excel_date(r["E"]), pay=excel_date(r["F"]),
                            period=r["A"]))
    return out


def load_ssga(ticker="SPY") -> list[dict]:
    rows = xlsx_rows(RAW / "ssga" / f"spdr-etf-historical-distributions_{R}.xlsx")
    head = {v.strip(): k for k, v in rows[0].items()}
    out = []
    for r in rows[1:]:
        if (r.get(head["TICKER"]) or "").strip() != ticker:
            continue
        g = lambda n: (r.get(head[n]) or "").strip()
        out.append(dict(ex=parse_date(g("EX-DATE")), record=parse_date(g("RECORD DATE")) if g("RECORD DATE") else None,
                        pay=parse_date(g("PAYABLE DATE")) if g("PAYABLE DATE") else None, amount=D(g("DIVIDEND ($)")),
                        st=dec(g("SHORT TERM CAPITAL GAIN ($)")), lt=dec(g("LONG TERM CAPITAL GAIN ($)"))))
    return sorted(out, key=lambda x: x["ex"])


# ------------------------------------------------------------------ cross-vendor comparison

DECIMAL_DATE = dt.date(2001, 4, 9)  # Nasdaq decimalization complete (NYSE: 2001-01-29)
TICK_1_16 = D("0.0625")


def base_tol(d):
    # agreement means within $0.01 after decimalization (as in batch 1); exact (rounding only) before
    return D("0.0101") if d >= DECIMAL_DATE else D("0.0051")


VENDOR_TOL = {  # absolute tolerance on an as-traded value v on date d, given split factor F
    "nasdaq": lambda v, F, d: base_tol(d) + F * D("0.00005"),
    "nasdaq_chart": lambda v, F, d: max(base_tol(d), v * D("0.00002")),
    "cboe": lambda v, F, d: base_tol(d) + F * D("0.005") + v * D("0.0002"),
    "stockanalysis": lambda v, F, d: base_tol(d) + F * D("0.0005"),
}


class Vendor:
    """A split-adjusted (or native) series plus a local scale estimate relative to the base series.
    The local scale absorbs vendor-specific factors (e.g., Cboe's partial dividend adjustments, Nasdaq
    chart's non-2.0 factor for the 2014 GOOGL Class C distribution) without hiding day-level errors."""

    def __init__(self, name: str, sym: str, series: dict, base: dict, native: bool = False):
        self.name, self.sym, self.s, self.native = name, sym, series, native
        self.dates = sorted(series)
        self.scale: dict[dt.date, Decimal] = {}
        base_ratio = {}
        for d in self.dates:
            b, v = base.get(d), series[d]
            if b and b["close"] and v["close"]:
                base_ratio[d] = b["close"] / (v["close"] * self.F(d))
        rd = sorted(base_ratio)
        for i, d in enumerate(self.dates):
            iv = split_interval(sym, d)
            # neighbours within +-10 sessions of the vendor's own dates, same split interval, excluding d
            j = bisect.bisect_left(rd, d)
            nb = [base_ratio[x] for x in rd[max(0, j - 10): j + 11] if x != d and split_interval(sym, x) == iv]
            self.scale[d] = statistics.median(nb) if nb else D(1)

    def F(self, d):
        return D(1) if self.native else factor(self.sym, d)

    def est(self, d, field) -> Decimal | None:
        """Vendor's estimate of the as-traded value, using the local scale."""
        r = self.s.get(d)
        if not r or r.get(field) is None:
            return None
        return r[field] * self.F(d) * self.scale[d]

    def raw_unsplit(self, d, field) -> Decimal | None:
        r = self.s.get(d)
        if not r or r.get(field) is None:
            return None
        return r[field] * self.F(d)

    def level_ok(self, d) -> bool:
        """True when the vendor's split-factor scale matches ours (so its unsplit values are usable as values)."""
        return abs(self.scale.get(d, D(1)) - 1) < D("0.0001")

    def agrees(self, d, field, value) -> bool | None:
        e = self.est(d, field)
        if e is None or value is None:
            return None
        return abs(e - value) <= VENDOR_TOL[self.name](value, self.F(d), d)

    def row_ok(self, d) -> bool:
        r = self.s.get(d)
        return bool(r) and ohlc_ok(r)

    def vol_unsplit(self, d) -> int | None:
        r = self.s.get(d)
        if not r or not r.get("volume"):
            return None
        return int((D(r["volume"]) / self.F(d)).to_integral_value(ROUND_HALF_UP))


def snap(x: Decimal, d: dt.date) -> tuple[Decimal, bool]:
    """Recover an exact as-traded tick price from an unsplit high-precision value."""
    grids = []
    if d < dt.date(2001, 4, 9):
        grids.append(D(1) / D(256))
    grids += [D("0.01"), D("0.005")]
    for g in grids:
        y = (x / g).to_integral_value(ROUND_HALF_UP) * g
        if abs(x - y) <= D("0.0008"):
            return y.normalize(), True
    return x.quantize(D("0.0001")), False


def ohlc_ok(r) -> bool:
    o, h, l, c = r["open"], r["high"], r["low"], r["close"]
    if None in (h, l):
        return True
    lo, hi = (min(o, c), max(o, c)) if o is not None else (c, c)
    return l <= lo and hi <= h


# ------------------------------------------------------------------ merge


def build_prices(sym: str, spx: dict | None = None, spy_divs: dict | None = None):
    cfg = SYMBOLS[sym]
    start = dt.date.fromisoformat(cfg["start"])
    exp = sessions(start, END)
    A = load_cnbc(cfg.get("cnbc", sym), True)
    A_adj = load_cnbc(cfg.get("cnbc", sym), False)
    nh = load_nasdaq_hist(cfg.get("nasdaq", sym))
    nc = load_nasdaq_chart(sym)
    cb = load_cboe(sym)
    sa = load_sa(sym)
    V = {
        "nasdaq": Vendor("nasdaq", sym, nh, A),
        "nasdaq_chart": Vendor("nasdaq_chart", sym, nc, A),
        "cboe": Vendor("cboe", sym, cb, A),
        "stockanalysis": Vendor("stockanalysis", sym, sa, A),
    }
    rep = {"calendar": {}, "conflicts": [], "overrides": [], "unverified": [], "nulled": [], "volume_overrides": [],
           "spx_adjudicated": [], "within_tick": [], "ohl_conflicts_nulled": []}
    for name, s in (("cnbc_unadj", A), ("nasdaq_hist", nh), ("nasdaq_chart", nc), ("cboe", cb), ("stockanalysis", sa)):
        ss = {d: r for d, r in s.items() if start <= d <= END}
        if not ss:
            continue
        lo, hi = min(ss), max(ss)
        e = set(sessions(lo, hi))
        rep["calendar"][name] = {"coverage": [lo.isoformat(), hi.isoformat()], "rows": len(ss),
                                 "expected": len(e), "missing": [d.isoformat() for d in sorted(e - set(ss))][:50],
                                 "n_missing": len(e - set(ss)),
                                 "non_sessions": [d.isoformat() for d in sorted(set(ss) - e)]}
    rows = {}
    for d in exp:
        a = A.get(d)
        Nv = V["nasdaq"] if d in nh else V["nasdaq_chart"]
        third = [V[k] for k in ("cboe", "stockanalysis") if d in V[k].s]
        # ---- close
        ac = a["close"] if a else None
        nval = Nv.est(d, "close")
        close, csrc = None, None
        if ac is not None and Nv.agrees(d, "close", ac):
            close, csrc = ac, "cnbc"
        else:
            a3 = [t.name for t in third if t.agrees(d, "close", ac)] if ac is not None else []
            n3 = [t.name for t in third if nval is not None and t.agrees(d, "close", nval)]
            cand_n = None
            if nval is not None and Nv.level_ok(d):
                cand_n = snap(Nv.raw_unsplit(d, "close"), d)[0]
            if ac is not None and a3 and not n3:
                close, csrc = ac, "cnbc"
                rep["conflicts"].append([d.isoformat(), "close", str(ac), Nv.name, str(nval), "kept cnbc; agrees " + ",".join(a3)])
            elif cand_n is not None and n3 and not a3 and Nv.row_ok(d):
                close, csrc = cand_n, f"{Nv.name};unsplit" if factor(sym, d) != 1 else Nv.name
                rep["overrides"].append([d.isoformat(), "close", None if ac is None else str(ac), str(cand_n), Nv.name, ",".join(n3)])
            elif sym == "SPY" and spx and ac is not None and cand_n is not None:
                pick = spx_adjudicate(d, ac, cand_n, rows, spx, spy_divs, A, Nv)
                if pick is not None:
                    close, csrc = pick
                    rep["spx_adjudicated"].append([d.isoformat(), str(ac), str(cand_n), csrc])
            if close is None and ac is not None and nval is not None and d < DECIMAL_DATE \
                    and abs(ac - nval) <= TICK_1_16 + D("0.0051"):
                close, csrc = ac, "cnbc;close_within_tick"
                rep["within_tick"].append([d.isoformat(), str(ac), Nv.name, str(nval.quantize(D("0.0001")))])
            if close is None:
                if ac is not None:
                    close, csrc = ac, "cnbc;close_unverified"
                    prev = max((x for x in Nv.s if x < d), default=None)
                    stale = prev is not None and all(Nv.s[d].get(k) == Nv.s[prev].get(k) for k in ("high", "low", "close")) if d in Nv.s else False
                    rep["unverified"].append([d.isoformat(), str(ac), Nv.name, None if nval is None else str(nval.quantize(D("0.0001"))),
                                              {t.name: str(t.est(d, "close").quantize(D("0.0001"))) for t in third if t.est(d, "close") is not None},
                                              {"nasdaq_row_repeats_prior_day": stale, "nasdaq_row_ohlc_consistent": Nv.row_ok(d),
                                               "cnbc_row_ohlc_consistent": bool(a and ohlc_ok(a))}])
                elif cand_n is not None:
                    close, csrc = cand_n, f"{Nv.name};unsplit;close_unverified"
                    rep["unverified"].append([d.isoformat(), None, Nv.name, str(cand_n), {}])
                else:
                    raise RuntimeError(f"{sym} {d}: no close from any source")
        base_is_a = csrc.startswith("cnbc")
        r = {"close": close}
        fsrc = {}
        # ---- open / high / low
        for f in ("open", "high", "low"):
            av = a.get(f) if a else None
            nv = Nv.est(d, f)
            if av is not None and Nv.agrees(d, f, av):
                r[f] = av
                continue
            a3 = [t.name for t in third if av is not None and t.agrees(d, f, av)]
            n3 = [t.name for t in third if nv is not None and t.agrees(d, f, nv)]
            if av is not None and a3 and not n3 and (nv is None or not n3):
                r[f] = av
                if not base_is_a:
                    fsrc[f] = "cnbc"
            elif nv is not None and n3 and not a3 and Nv.level_ok(d) and (
                    av is None or not (a and ohlc_ok(a)) or abs(nv / av - 1) <= D("0.01")):
                # replace only a missing/internally inconsistent base value, or a small methodology difference;
                # a large disagreement with a self-consistent base row may be a bad print on the
                # consolidated tape that two vendors share, so it is nulled below instead
                r[f] = snap(Nv.raw_unsplit(d, f), d)[0]
                fsrc[f] = f"{Nv.name}_unsplit" if factor(sym, d) != 1 else Nv.name
                rep["overrides"].append([d.isoformat(), f, None if av is None else str(av), str(r[f]), Nv.name, ",".join(n3)])
            elif av is not None and nv is None and not third:
                r[f] = av  # single-source field (no other vendor publishes it for this date)
                fsrc[f] = "cnbc_only"
            else:
                r[f] = None
                fsrc[f] = "null"
                rep["nulled"].append([d.isoformat(), f, None if av is None else str(av), None if nv is None else str(nv.quantize(D("0.0001"))),
                                      {t.name: str(t.est(d, f).quantize(D("0.0001"))) for t in third if t.est(d, f) is not None}])
        if not ohlc_ok(r):
            # drop whichever of open/high/low is not corroborated by a second vendor
            for f in ("open", "high", "low"):
                if r[f] is not None and not Nv.agrees(d, f, r[f]):
                    rep["nulled"].append([d.isoformat(), f, str(r[f]), "ohlc-inconsistent", {}])
                    r[f] = None
                    fsrc[f] = "null"
            if not ohlc_ok(r):
                for f in ("open", "high", "low"):
                    if r[f] is not None:
                        rep["nulled"].append([d.isoformat(), f, str(r[f]), "ohlc-inconsistent-2", {}])
                    r[f] = None
                    fsrc[f] = "null"
        # ---- volume
        av = a.get("volume") if a else None
        nvv = Nv.vol_unsplit(d)
        vs = None
        within = lambda x, y: x is not None and y is not None and abs(x - y) <= D("0.05") * max(x, y)
        if av and (within(av, nvv) or nvv is None):
            vol = av
        elif av and V["stockanalysis"].vol_unsplit(d) and within(av, V["stockanalysis"].vol_unsplit(d)):
            vol = av
        elif nvv and (within(nvv, V["stockanalysis"].vol_unsplit(d)) or not av):
            vol, vs = nvv, Nv.name
            rep["volume_overrides"].append([d.isoformat(), av, nvv, Nv.name])
        else:
            vol = av
            if av and nvv:
                fsrc["volume"] = "cnbc_unverified"
        if vs:
            fsrc["volume"] = vs
        r["volume"] = vol
        src = csrc + "".join(f";{k}={v}" for k, v in fsrc.items())
        rows[d] = (r, src)
    # ---- vendor split-factor evidence: median raw(base)/vendor ratio per split interval
    fac = {}
    for name, s in (("cnbc_adjusted", A_adj), ("nasdaq", nh), ("nasdaq_chart", nc), ("cboe", cb), ("stockanalysis", sa)):
        per = {}
        for d, x in s.items():
            b = A.get(d)
            if b and b["close"] and x["close"] and start <= d <= END:
                per.setdefault(split_interval(sym, d), []).append(b["close"] / x["close"])
        fac[name] = {k: {"median": float(statistics.median(v)), "expected": float(factor(sym, dt.date.fromisoformat(SPLITS[sym][k][0]) - dt.timedelta(days=1)) if k < len(SPLITS[sym]) else 1.0),
                         "n": len(v)} for k, v in sorted(per.items())}
    rep["vendor_factor_by_interval"] = fac
    return rows, rep, {"A": A, "nh": nh, "nc": nc, "cb": cb, "sa": sa}


def spx_adjudicate(d, ac, cn, rows, spx, divs, A, Nv):
    """SPY only, used when CNBC and Nasdaq disagree and no third vendor covers the date: the candidate
    whose day-over-day return matches the S&P 500 index (Cboe _SPX) is taken, if exactly one does."""
    ds = sorted(rows)
    if not ds or d not in spx:
        return None
    p = ds[-1]
    if p not in spx:
        return None
    pc = rows[p][0]["close"]
    idx_ret = spx[d]["close"] / spx[p]["close"]
    div = divs.get(d, D(0))
    dev = {k: abs((v + div) / pc - idx_ret) for k, v in (("cnbc", ac), (Nv.name, cn))}
    good = [k for k, x in dev.items() if x <= D("0.004")]
    bad = [k for k, x in dev.items() if x > D("0.008")]
    if len(good) == 1 and len(bad) == 1:
        k = good[0]
        return (ac, "cnbc;spx_adjudicated") if k == "cnbc" else (cn, f"{Nv.name};spx_adjudicated")
    return None


# ------------------------------------------------------------------ dividends


def as_declared(sym, ex, amount_adj):
    """Undo a vendor's split adjustment. Vendors round the adjusted amount; if the unsplit value is
    within that rounding bound of a 4-decimal amount, the 4-decimal amount is the declared one."""
    F = factor(sym, ex)
    v = amount_adj * F
    dp = -amount_adj.normalize().as_tuple().exponent
    bound = F * D("0.5") * D(10) ** -max(dp, 0) + D("1e-12")
    r4 = v.quantize(D("0.0001"))
    return (r4 if abs(v - r4) <= bound else v.quantize(D("0.000001"))).normalize()


def basis_divisor(sym, ex: dt.date, basis: dt.date) -> Decimal:
    """Splits after the ex-date but on/before a document's date: the document restates per-share amounts."""
    f = D(1)
    for e, r in SPLITS[sym]:
        if ex < dt.date.fromisoformat(e) <= basis:
            f *= r
    return f


def same_amount(ours: Decimal, theirs: Decimal, extra_scale: Decimal = D(1), published: Decimal | None = None) -> bool:
    """Equal within the other source's published precision (it may round to fewer decimals). For a
    split-adjusted source, `published` is its adjusted figure and `extra_scale` the split factor that
    was multiplied back in, so the tolerance is that figure's rounding times the factor."""
    ref = theirs if published is None else published
    dp = max(-ref.normalize().as_tuple().exponent, 0)
    return abs(ours - theirs) <= D("0.5") * D(10) ** -dp * extra_scale + D("1e-9")


def nearest(items, ex, days=4, amount=None):
    cands = [x for x in items if abs((x["ex"] - ex).days) <= days]
    if amount is not None and any(x.get("amount") == amount for x in cands):
        cands = [x for x in cands if x.get("amount") == amount]
    return min(cands, key=lambda x: abs((x["ex"] - ex).days), default=None)


def decl_proxy(x) -> dt.date:
    # when no source gives the declaration date: these issuers declare 1-6 weeks before the ex-date
    return x.get("decl") or (x["ex"] - dt.timedelta(days=10))


# Corrections that need a document the vendors lack; each is justified in the batch-2 doc.
MANUAL_DIVIDENDS = {
    "JPM": {
        "add": [dict(ex="1996-04-02", amount="0.56", record="1996-04-04", pay="1996-04-30", decl="1996-03-19",
                     type="cash_dividend",
                     src="sec_8k(sec/JPM_8K_19960319_0000019617-96-000043.txt: $.56, record 1996-04-04, payable 1996-04-30);"
                         "ex-date = record - 2 business days (T+3 rule)")],
        "drop": {"2000-09-21": "dividendhistory.org's $1.00 row is the pre-merger J.P. Morgan & Co. dividend; "
                               "the continuing (Chase) stock declared $1.28 in 2000 per its FY2004 10-K, which excludes it"},
    },
    "SPY": {
        "add": [dict(ex="1995-12-15", amount="0.01", record="1995-12-19", pay="1996-01-31", decl=None, type="special_dividend",
                     src="capital gain: dividendhistory.org total 0.382 - SSGA income 0.372000; SPDR Trust 1995 annual report "
                         "(sec/SPY_N30D_FY1995_0000912057-96-003840.txt) shows $0.01/unit from net realized gains")],
        "drop": {},
    },
}


def build_dividends(sym: str, start: dt.date, sess: set):
    rep = {"rows": [], "notes": []}
    nas = [x for x in load_nasdaq_divs(sym) if x["type"] == "Cash"]
    dho = load_dho(sym)
    sad = load_sa_divs(sym)
    for x in dho:
        x["amount"] = as_declared(sym, x["ex"], x["amount_adj"])
    for x in sad:
        x["amount"] = as_declared(sym, x["ex"], x["amount_adj"])
    base: list[dict] = []
    if sym == "MSFT":
        base = [dict(x, src="msft_ir") for x in load_msft_ir()]
    elif sym == "SPY":
        for x in load_ssga():
            base.append(dict(ex=x["ex"], amount=x["amount"], type="cash_dividend", record=x["record"], pay=x["pay"],
                             decl=None, src="ssga", st=x["st"], lt=x["lt"]))
            cg = (x["st"] or D(0)) + (x["lt"] or D(0))
            if cg:
                base.append(dict(ex=x["ex"], amount=cg.normalize(), type="special_dividend", record=x["record"], pay=x["pay"],
                                 decl=None, src=f"ssga capital gain (short-term {x['st']} + long-term {x['lt']})"))
    elif sym in ("JPM", "KO"):
        for x in dho:
            s = nearest(sad, x["ex"], 0)
            base.append(dict(ex=x["ex"], amount=x["amount"], type="cash_dividend", pay=x["pay"],
                             record=s["record"] if s else None, decl=s["decl"] if s else None,
                             src="dividendhistory.org(split-adj x factor)"))
    else:
        for x in nas:
            base.append(dict(ex=x["ex"], amount=x["amount"], type="cash_dividend", record=x["record"], pay=x["pay"],
                             decl=x["decl"], src="nasdaq"))
        for x in dho:  # dividends the Nasdaq list lacks
            if not nearest(base, x["ex"], 4) and start <= x["ex"] <= END:
                base.append(dict(ex=x["ex"], amount=x["amount"], type="cash_dividend", record=None, pay=x["pay"],
                                 decl=None, src="dividendhistory.org(split-adj x factor)"))
                rep["notes"].append(f"{x['ex']} added from dividendhistory.org (missing from Nasdaq list)")
    man = MANUAL_DIVIDENDS.get(sym, {})
    for e, why in man.get("drop", {}).items():
        before = len(base)
        base = [x for x in base if x["ex"].isoformat() != e]
        rep["notes"].append(f"{e} dropped ({before - len(base)} row): {why}")
    for m in man.get("add", []):
        base.append(dict(ex=dt.date.fromisoformat(m["ex"]), amount=D(m["amount"]), type=m["type"],
                         record=dt.date.fromisoformat(m["record"]) if m["record"] else None,
                         pay=dt.date.fromisoformat(m["pay"]) if m["pay"] else None,
                         decl=dt.date.fromisoformat(m["decl"]) if m["decl"] else None, src="manual:" + m["src"]))
        rep["notes"].append(f"{m['ex']} added: {m['src']}")
    base = sorted((x for x in base if start <= x["ex"] <= END), key=lambda x: (x["ex"], x["type"]))
    for x in base:
        # before T+1 the record date always followed the ex-date; a vendor row with record == ex is a copy
        if x.get("record") and x["record"] == x["ex"] and x["ex"] < T1_START:
            rep["notes"].append(f"{x['ex']} record date dropped ({x['src']} repeats the ex-date; impossible before T+1)")
            x["record"] = None
        if x.get("pay") and (x["pay"] < x["ex"] or (x.get("record") and x["pay"] < x["record"])):
            rep["notes"].append(f"{x['ex']} pay date {x['pay']} dropped ({x['src']}: payable before ex/record date is impossible)")
            x["pay"] = None
    xb = load_xbrl(sym)
    sa_hist = load_sa("SPY") if sym == "SPY" else {}
    for x in base:
        amt, chk, exsrc = x["amount"], {}, [x["src"].split("(")[0].split(":")[0]]
        regular = x["type"] == "cash_dividend"
        if x["src"] != "nasdaq":
            n = nearest(nas, x["ex"], 4, amt)
            if n:
                chk["nasdaq"] = (str(n["amount"]), same_amount(amt, n["amount"]))
                if n["ex"] == x["ex"]:
                    exsrc.append("nasdaq")
        if not x["src"].startswith("dividendhistory"):
            h = nearest(dho, x["ex"], 3, amt)
            if h and (regular or sym != "SPY"):
                chk["dividendhistory.org"] = (f"{h['amount']} (ex {h['ex']})",
                                              same_amount(amt, h["amount"], factor(sym, h["ex"]), h["amount_adj"]))
                if h["ex"] == x["ex"]:
                    exsrc.append("dividendhistory.org")
        s = nearest(sad, x["ex"], 0, amt)
        if s:
            chk["stockanalysis"] = (str(s["amount"]), same_amount(amt, s["amount"], factor(sym, s["ex"]), s["amount_adj"]))
            exsrc.append("stockanalysis")
        if sym == "SPY" and regular:
            sar = sa_hist.get(x["ex"])
            if sar and sar.get("div") is not None:
                chk["stockanalysis_history_div"] = (str(sar["div"]), same_amount(amt, sar["div"]))
        # company XBRL: the quarter in which it was declared (or, failing that, paid)
        for concept, when in (("CommonStockDividendsPerShareDeclared", decl_proxy(x)),
                              ("CommonStockDividendsPerShareCashPaid", x.get("pay"))):
            if when is None or not regular:
                continue
            q = [f for f in xb if f["concept"] == concept and f["kind"] == "Q" and f["start"] <= when <= f["end"]]
            if q:
                f = q[0]
                ok = same_amount(amt / basis_divisor(sym, x["ex"], f["filed"]), f["val"])
                chk[f"sec_xbrl_{concept[26:].lower()}"] = (f"{f['val']} ({f['form']} filed {f['filed']}, {f['start']}..{f['end']})", ok)
                if ok:
                    break
        x["checks"] = chk
        x["ex_sources"] = exsrc
        x["ex_is_session"] = x["ex"] in sess
    # annual cross-checks: company XBRL fiscal-year totals and 10-K text totals
    for f in xb:
        if f["kind"] != "FY" or f["end"] < start or f["start"] > END:
            continue
        key = "decl" if f["concept"].endswith("Declared") else "pay"
        m = [x for x in base if x["type"] == "cash_dividend" and (decl_proxy(x) if key == "decl" else x.get("pay"))
             and f["start"] <= (decl_proxy(x) if key == "decl" else x["pay"]) <= f["end"]]
        tot = sum((x["amount"] / basis_divisor(sym, x["ex"], f["filed"]) for x in m), D(0))
        restated = any(basis_divisor(sym, x["ex"], f["filed"]) != 1 for x in m)
        # a filing that restates for a split rounds each restated quarter to cents
        ok = same_amount(tot, f["val"]) or abs(tot - f["val"]) <= (D("0.0051") * max(len(m), 1) if restated else D("0.0051"))
        rep.setdefault("xbrl_fy_totals", []).append({"concept": f["concept"][26:], "period": f"{f['start']}..{f['end']}",
                                                     "xbrl": str(f["val"]), "ours": str(tot.normalize()), "match": ok,
                                                     "filed": f["filed"].isoformat()})
        if ok:
            for x in m:
                x["checks"].setdefault("sec_xbrl_fy_total", (f"{f['val']} FY {f['start']}..{f['end']}", True))
    for t in TENK_DIV_TOTALS.get(sym, []):
        basis = dt.date.fromisoformat(t["basis"])
        for y, v in t["years"].items():
            fy = t.get("fy_end_month")
            yr = (lambda x: x["ex"].year + (1 if x["ex"].month > fy else 0)) if fy else (lambda x: decl_proxy(x).year)
            m = [x for x in base if x["type"] == "cash_dividend" and yr(x) == y]
            tot = sum((x["amount"] / basis_divisor(sym, x["ex"], basis) for x in m), D(0))
            ok = abs(tot - D(v)) <= D(t.get("tol", "0.005"))
            rep.setdefault("tenk_annual_totals", []).append(
                {"year": y, "tenk": v, "ours_on_tenk_basis": str(tot.quantize(D("0.0001"))), "n": len(m), "match": ok, "doc": t["doc"]})
            if ok:
                for x in m:
                    x["checks"].setdefault("sec_10k_annual_total", (f"{v} ({y}, {t['doc'].split(' ')[0]})", True))
    for x in base:
        chk = x["checks"]
        x["n_sources_agree"] = 1 + sum(1 for _, ok in chk.values() if ok)
        x["disagree"] = {k: v for k, (v, ok) in chk.items() if not ok}
        rep["rows"].append({"ex": x["ex"].isoformat(), "amount": str(x["amount"]), "type": x["type"], "src": x["src"],
                            "record": x["record"].isoformat() if x.get("record") else None,
                            "pay": x["pay"].isoformat() if x.get("pay") else None,
                            "checks": {k: v for k, (v, ok) in chk.items() if ok}, "n_agree": x["n_sources_agree"],
                            "disagree": x["disagree"], "ex_date_sources": x["ex_sources"], "ex_is_session": x["ex_is_session"],
                            **({"st_cap_gain": None if x.get("st") is None else str(x["st"]),
                                "lt_cap_gain": None if x.get("lt") is None else str(x["lt"])} if sym == "SPY" else {})})
    for name, lst in (("nasdaq", nas), ("dividendhistory.org", dho), ("stockanalysis", sad)):
        miss = [x["ex"].isoformat() for x in lst if start <= x["ex"] <= END and not nearest(base, x["ex"], 4)]
        if miss:
            rep.setdefault("in_secondary_not_base", {})[name] = miss
    return base, rep


# ------------------------------------------------------------------ total return check


def tr_index(closes: dict, splits: dict, cash: dict) -> dict:
    """Pipeline convention: value of one share held from the prior close = split * (close + cash) / prior."""
    ds = sorted(closes)
    out = {ds[0]: D(1)}
    for p, d in zip(ds, ds[1:]):
        out[d] = out[p] * splits.get(d, D(1)) * (closes[d] + cash.get(d, D(0))) / closes[p]
    return out


def back_adjust(closes: dict, splits: dict, cash: dict, convention: str) -> dict:
    """Vendor-style back-adjusted close anchored at the last close.
    hpr:        dividend factor close(E) / (close(E) + D)  -> identical to the pipeline's TR index
    multiplier: dividend factor 1 - D / close(E-1)         -> CRSP/Yahoo-style 'adjusted close'"""
    ds = sorted(closes)
    out, f = {}, D(1)
    for i in range(len(ds) - 1, -1, -1):
        d = ds[i]
        out[d] = closes[d] * f
        if i == 0:
            continue
        r = splits.get(d, D(1))
        c = cash.get(d)
        if c:
            prev_post = closes[ds[i - 1]] / r  # previous close in post-split units
            f *= closes[d] / (closes[d] + c) if convention == "hpr" else (1 - c / prev_post)
        f /= r
    return out


def dev_stats(adj: dict, sa: dict) -> dict | None:
    rows = [(d, adj[d], sa[d]["adj"]) for d in sorted(sa) if d in adj and sa[d].get("adj") is not None]
    if not rows:
        return None
    reld = [abs(x - y) / y for _, x, y in rows]
    rr = [(d, abs(x / xp - y / yp)) for (p, xp, yp), (d, x, y) in zip(rows, rows[1:])]
    worst = sorted(rows, key=lambda t: -abs(t[1] - t[2]) / t[2])[:3]
    return {
        "compared_rows": len(rows), "range": [rows[0][0].isoformat(), rows[-1][0].isoformat()],
        "max_abs_dev_usd": float(max(abs(x - y) for _, x, y in rows)), "max_rel_dev_bp": float(max(reld) * 10000),
        "rows_rel_dev_gt_1bp": sum(1 for x in reld if x > D("0.0001")),
        "max_daily_return_diff_bp": float(max(x for _, x in rr) * 10000) if rr else None,
        "worst_daily_return_dates": [[d.isoformat(), float(x * 10000)] for d, x in sorted(rr, key=lambda t: -t[1])[:3]],
        "worst": [[d.isoformat(), str(x.quantize(D("0.0001"))), str(y)] for d, x, y in worst],
    }


def to_session(d: dt.date, ds: list) -> dt.date:
    """Like the pipeline: an action dated on a non-trading day applies to the next session."""
    i = bisect.bisect_left(ds, d)
    return ds[i] if i < len(ds) else d


def tr_check(sym, closes, actions, sa):
    ds = sorted(closes)
    sp = {to_session(dt.date.fromisoformat(e), ds): r for e, r in SPLITS[sym]}
    cash = {}
    for a in actions:
        if a["type"] in ("cash_dividend", "special_dividend"):
            e = to_session(a["ex"], ds)
            cash[e] = cash.get(e, D(0)) + a["amount"]
    tr = tr_index(closes, sp, cash)
    T = max(closes)
    adj = {d: closes[T] * tr[d] / tr[T] for d in tr}  # pipeline TR index rescaled to end at the last close
    hpr = back_adjust(closes, sp, cash, "hpr")
    ident = max(abs(adj[d] / hpr[d] - 1) for d in adj)
    pr = tr_index(closes, sp, {})
    res = {"pipeline_tr_convention": dev_stats(adj, sa), "_pr": pr,
           "vendor_multiplier_convention": dev_stats(back_adjust(closes, sp, cash, "multiplier"), sa),
           "tr_index_vs_back_adjust_identity_max_err": float(ident)}
    return (res if res["pipeline_tr_convention"] else None), tr


# ------------------------------------------------------------------ main


def main():
    report = {"retrieved": R, "end": END.isoformat(), "symbols": {}}
    spx = load_cboe("GSPC")
    ssga = load_ssga()
    spy_divs = {x["ex"]: x["amount"] for x in ssga}
    all_sess = set(sessions(dt.date(1993, 1, 29), END))
    SEED.mkdir(parents=True, exist_ok=True)
    for sym in SYMBOLS:
        start = dt.date.fromisoformat(SYMBOLS[sym]["start"])
        rows, prep, raw = build_prices(sym, spx, spy_divs)
        sym_rep = {"prices": prep}
        # SPY: keep the batch-1 rows (2019-03-01 onward, already verified) byte-for-byte
        if sym == "SPY":
            existing = {}
            with (SEED / "SPY.csv").open() as fh:
                for x in csv.DictReader(fh):
                    existing[dt.date.fromisoformat(x["date"])] = x
            batch1_start = BATCH1_START
            diffs = []
            existing = {d: x for d, x in existing.items() if d >= BATCH1_START}
            for d, x in existing.items():
                r, s = rows[d]
                if dec(x["close"]) != r["close"]:
                    diffs.append([d.isoformat(), x["close"], str(r["close"]), s])
            sym_rep["batch1_rows_kept"] = len(existing)
            sym_rep["batch1_vs_rebuilt_close_diffs"] = diffs
        # ---- corporate actions
        divs, drep = build_dividends(sym, start, all_sess) if sym in DIV_SYMBOLS else ([], {"rows": []})
        sym_rep["dividends"] = drep
        closes = {d: r["close"] for d, (r, _) in rows.items()}
        if sym == "SPY":
            for d, x in existing.items():
                closes[d] = dec(x["close"])
        # split verification: raw price drop on the ex-date vs ratio
        sv = []
        for e, ratio in SPLITS[sym]:
            ed = dt.date.fromisoformat(e)
            if ed < start:
                continue
            ds = sorted(closes)
            i = ds.index(ed)
            p = ds[i - 1]
            drop = closes[p] / closes[ed]
            sv.append({"ex_date": e, "ratio": str(ratio), "prev_close": str(closes[p]), "ex_close": str(closes[ed]),
                       "prev_over_ex": float(drop), "implied_return_pct": float((ratio * closes[ed] / closes[p] - 1) * 100),
                       "is_session": ed in all_sess})
        sym_rep["split_checks"] = sv
        # ---- TR check vs stockanalysis adjusted close
        trc, tr = tr_check(sym, closes, divs, raw["sa"])
        pr = trc.pop("_pr") if trc else tr_index(closes, {dt.date.fromisoformat(e): r for e, r in SPLITS[sym]}, {})
        sym_rep["tr_check_vs_stockanalysis"] = trc
        # ---- write actions
        acts = []
        for e, ratio in SPLITS[sym]:
            ed = dt.date.fromisoformat(e)
            if start < ed <= END:
                f, t = SPLIT_RATIO_TEXT[ratio]
                acts.append([e, "split", "", "", "", f, t])
        for x in divs:
            acts.append([x["ex"].isoformat(), x["type"], num_str(x["amount"]),
                         x["record"].isoformat() if x.get("record") else "", x["pay"].isoformat() if x.get("pay") else "", "", ""])
        acts.sort(key=lambda r: (r[0], r[1] != "split"))
        with (SEED / f"{sym}_actions.csv").open("w", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["ex_date", "action_type", "cash_amount", "record_date", "pay_date", "split_from", "split_to"])
            w.writerows(acts)
        # ---- write prices
        out = []
        if sym == "SPY":
            # adj_close: total-return series from closes + SSGA distributions, same convention as batch 1
            adj = {}
            fct = D(1)
            ds = sorted(closes)
            for i in range(len(ds) - 1, -1, -1):
                d = ds[i]
                adj[d] = closes[d] * fct
                if d in spy_divs and i > 0:
                    fct *= closes[d] / (closes[d] + spy_divs[d])
            mism = []
            for d, (r, s) in sorted(rows.items()):
                if d >= batch1_start:
                    x = existing[d]
                    a4 = adj[d].quantize(D("0.0001"), rounding=ROUND_HALF_UP)
                    if format(a4, "f") != x["adj_close"]:
                        mism.append([d.isoformat(), x["adj_close"], format(a4, "f")])
                    out.append([x["date"], x["open"], x["high"], x["low"], x["close"], x["adj_close"], x["volume"], x["source"]])
                else:
                    a4 = adj[d].quantize(D("0.0001"), rounding=ROUND_HALF_UP)
                    out.append([d.isoformat(), num_str(r["open"]), num_str(r["high"]), num_str(r["low"]),
                                num_str(r["close"]), format(a4, "f"), r["volume"] or "", s + ";adj_close=calc_ssga_div"])
            sym_rep["batch1_adj_close_mismatches_after_extension"] = mism
        else:
            for d, (r, s) in sorted(rows.items()):
                sar = raw["sa"].get(d)
                a = sar["adj"] if sar and d >= SA_START else None
                out.append([d.isoformat(), num_str(r["open"]), num_str(r["high"]), num_str(r["low"]), num_str(r["close"]),
                            num_str(a) if a is not None else "", r["volume"] or "", s + (";adj_close=stockanalysis" if a is not None else "")])
        with (SEED / f"{sym}.csv").open("w", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["date", "open", "high", "low", "close", "adj_close", "volume", "source"])
            w.writerows(out)
        srcs = {}
        for x in out:
            k = x[-1].split(";")[0]
            srcs[k] = srcs.get(k, 0) + 1
        exp = sessions(start, END)
        sym_rep["seed"] = {"rows": len(out), "first": out[0][0], "last": out[-1][0], "expected_sessions": len(exp),
                           "dates_equal_calendar": [x[0] for x in out] == [d.isoformat() for d in exp],
                           "close_source_counts": srcs,
                           "rows_with_null_ohl": sum(1 for x in out if "" in (x[1], x[2], x[3])),
                           "rows_close_unverified": sum(1 for x in out if "close_unverified" in x[-1]),
                           "n_splits": sum(1 for a in acts if a[1] == "split"),
                           "n_cash_dividends": sum(1 for a in acts if a[1] == "cash_dividend"),
                           "n_special_dividends": sum(1 for a in acts if a[1] == "special_dividend"),
                           "price_return_pct": float((pr[END] / pr[start] - 1) * 100),
                           "total_return_pct": float((tr[END] / tr[start] - 1) * 100)}
        report["symbols"][sym] = sym_rep
        s = sym_rep["seed"]
        t = (sym_rep["tr_check_vs_stockanalysis"] or {}).get("pipeline_tr_convention") or {}
        print(f"{sym}: {s['rows']} rows {s['first']}..{s['last']} calendar_ok={s['dates_equal_calendar']} "
              f"splits={s['n_splits']} divs={s['n_cash_dividends']}+{s['n_special_dividends']} "
              f"unverified={s['rows_close_unverified']} overrides={len(prep['overrides'])} nulled={len(prep['nulled'])} "
              f"tr_maxrel_bp={t.get('max_rel_dev_bp')}")
    # ---- spot checks against independent public reporting and SEC filings
    seeds = {}
    for sym in SYMBOLS:
        with (SEED / f"{sym}.csv").open() as fh:
            seeds[sym] = {x["date"]: x for x in csv.DictReader(fh)}
    sc = []
    for sym, d, f, v, basis, src, url, how in SPOT_CHECKS:
        row = seeds[sym].get(d)
        ours = dec(row[f]) if row and row[f] else None
        if ours is not None and basis == "SA":
            ours = ours / factor(sym, dt.date.fromisoformat(d))
        if ours is None:
            m = "no value in seed"
        elif f == "volume":
            m = "match" if abs(ours - D(v)) <= D("0.01") * D(v) else "MISMATCH"
        else:
            diff = abs(ours - D(v))
            m = "match" if diff <= D("0.005") else ("match (rounding <=1c)" if diff <= D("0.0101") else "MISMATCH")
        sc.append({"symbol": sym, "date": d, "field": f, "reported": v, "basis": basis, "seed": None if ours is None else str(ours.normalize()),
                   "seed_source": row["source"] if row else None, "result": m, "source": src, "url": url, "how": how})
    for sym, t in TENK_CLOSES.items():
        for d, v in t["closes"].items():
            row = seeds[sym].get(d)
            bd = dt.date.fromisoformat(TENK_CLOSE_BASIS[sym].get(d, TENK_DEFAULT_BASIS[sym]))
            ours = dec(row["close"]) / basis_divisor(sym, dt.date.fromisoformat(d), bd)
            r2 = ours.quantize(D("0.01"), rounding=ROUND_HALF_UP)
            sc.append({"symbol": sym, "date": d, "field": "close", "reported": v, "basis": f"10-K restated to {bd}",
                       "seed": str(ours.normalize()), "seed_source": row["source"],
                       "result": "match" if r2 == D(v) else ("match (rounding <=1c)" if abs(ours - D(v)) <= D("0.0101") else "MISMATCH"),
                       "source": t["doc"], "url": "", "how": "saved filing"})
    aapl = seeds["AAPL"]
    for (a, b), (hi, lo, doc) in AAPL_10K_PRICE_RANGES.items():
        rr = [x for d, x in aapl.items() if a <= d <= b]
        if doc == "FY1994":
            pairs = (("max close", max(dec(x["close"]) for x in rr), hi), ("min close", min(dec(x["close"]) for x in rr), lo))
        else:
            pairs = (("max high", max(dec(x["high"]) for x in rr if x["high"]), hi),
                     ("min low", min(dec(x["low"]) for x in rr if x["low"]), lo))
        for lab, ours, v in pairs:
            ok = ours == D(v) or (doc == "FY1996" and ours.quantize(D("0.01"), rounding=ROUND_HALF_UP) == D(v))
            sc.append({"symbol": "AAPL", "date": f"{a}..{b}", "field": lab, "reported": v, "basis": "U",
                       "seed": str(ours.normalize()), "seed_source": "", "result": "match" if ok else "MISMATCH",
                       "source": f"sec/AAPL_10K_{doc} quarterly price range", "url": "", "how": "saved filing"})
    report["spot_checks"] = sc
    print("spot checks:", {k: sum(1 for x in sc if x["result"].startswith(k)) for k in ("match", "MISMATCH", "no value")})
    out = RAW / f"verification_batch2_{R}.json"
    out.write_text(json.dumps(report, indent=1, default=str))
    print("wrote", out)


if __name__ == "__main__":
    main()
