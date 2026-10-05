#!/usr/bin/env python3
"""Batch 3: build and cross-verify deep daily price history + corporate actions for WMT, COST, CRM, V, INTC, ORCL.

Same method as build_batch2.py (see docs/research/price-data-verification-batch2.md), standalone so that
batch 2's configuration is untouched. Reads only untouched raw responses under data/raw/prices/<source>/ and writes:
  - data/seed/prices/<SYMBOL>.csv          date,open,high,low,close,adj_close,volume,source
  - data/seed/prices/<SYMBOL>_actions.csv  ex_date,action_type,cash_amount,record_date,pay_date,split_from,split_to
  - data/raw/prices/verification_batch3_<RETRIEVED>.json  (full diff report; gitignored)

Closes are raw as-traded. CNBC's "unadjusted" bars are the base; every field is cross-checked against
Nasdaq (historical API for the last 10 years, chart API back to 1990; both split-adjusted, converted
back with the verified split table), Cboe (2004+, split-adjusted, 2 dp) and stockanalysis.com (5 years).
A base value is replaced only when a second independent vendor contradicts it AND a third agrees with
the replacement. Nothing is interpolated or filled.

Usage (exchange_calendars supplies the session calendar):
  uv run --no-project --with exchange_calendars python scripts/prices/build_batch3.py [RETRIEVED_YYYYMMDD]
"""

from __future__ import annotations

import bisect
import csv
import datetime as dt
import json
import re
import statistics
import sys
from decimal import ROUND_HALF_UP, Decimal, getcontext
from pathlib import Path

import exchange_calendars as xcals

getcontext().prec = 40
D = Decimal
ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "prices"
SEED = ROOT / "data" / "seed" / "prices"
R = sys.argv[1] if len(sys.argv) > 1 else "20261005"
END = dt.date(2026, 10, 2)
SA_START = dt.date(2021, 10, 4)
T1_START = dt.date(2024, 5, 28)  # US T+1 settlement: record date == ex-date from here on

# ------------------------------------------------------------------ configuration
# start: first session in the seed. V and CRM start on their IPO day. WMT/INTC/ORCL start 1990-01-02, the first day
# the second independent vendor (Nasdaq chart API) covers. COST starts 1993-10-22, the first PriceCostco session:
# no keyless vendor has the pre-merger Costco Wholesale Corp. (1985-1993) series (see the batch-3 doc).
SYMBOLS: dict[str, dict] = {
    "WMT": dict(start="1990-01-02"), "COST": dict(start="1993-10-22"), "CRM": dict(start="2004-06-23"),
    "V": dict(start="2008-03-19"), "INTC": dict(start="1990-01-02"), "ORCL": dict(start="1990-01-02"),
}
# Verified splits (ex-date = first split-adjusted session, ratio = new shares per old share).
# Each is checked below against (a) every vendor's implied adjustment factor and (b) the raw price
# drop on the ex-date; primary-source citations are in docs/research/price-data-verification-batch3.md.
SPLITS: dict[str, list[tuple[str, Decimal]]] = {
    "WMT": [("1990-07-09", D(2)), ("1993-02-26", D(2)), ("1999-04-20", D(2)), ("2024-02-26", D(3))],
    "COST": [("2000-01-14", D(2))],
    "CRM": [("2013-04-18", D(4))],
    "V": [("2015-03-19", D(4))],
    "INTC": [("1993-06-07", D(2)), ("1995-06-19", D(2)), ("1997-07-14", D(2)), ("1999-04-12", D(2)),
             ("2000-07-31", D(2))],
    "ORCL": [("1993-11-09", D(2)), ("1995-02-23", D("1.5")), ("1996-04-17", D("1.5")), ("1997-08-18", D("1.5")),
             ("1999-03-01", D("1.5")), ("2000-01-19", D(2)), ("2000-10-13", D(2))],
}
# Base (CNBC) fields with a systematic defect, treated as missing: CNBC's ORCL low equals the close on every one
# of the 5,898 sessions 1990-01-02..2013-05-10 (from 2013-05-13 it differs on most days), like GOOGL's in batch 2.
DEFECTIVE_BASE = {"ORCL": {"low": ("1990-01-02", "2013-05-10")}}
SPLIT_RATIO_TEXT = {D(2): (1, 2), D(3): (1, 3), D(4): (1, 4), D("1.5"): (2, 3)}
DIV_SYMBOLS = set(SYMBOLS)
# Base dividend list: Nasdaq's dividend API (as declared) for Nasdaq-listed names, otherwise dividendhistory.org.
DIV_BASE = {"WMT": "nasdaq", "COST": "nasdaq", "INTC": "nasdaq", "V": "dho", "CRM": "dho", "ORCL": "dho"}
# dividendhistory.org scales amounts for later splits for most symbols, but not for INTC: its INTC amounts equal
# Nasdaq's as-declared values on pre-split dates (e.g. 1999-08-04 $0.03, before the 2000-07-31 split).
DHO_AS_TRADED = {"INTC"}
# Special dividends (ex-date -> amount); every one is confirmed by the company's own 8-K (batch-3 doc §5.2).
SPECIALS: dict[str, dict[str, str]] = {
    "COST": {"2012-12-06": "7.00", "2015-02-05": "5.00", "2017-05-08": "7.00", "2020-12-01": "10.00",
             "2023-12-27": "15.00"},
}

# Visa tags its dividends-per-share XBRL facts with the quarterly RATE for every period length (e.g. FY2009 = 0.105,
# not 0.42), so its facts are compared with each dividend declared in the period, not with period sums.
XBRL_RATE = {"V"}

# Dividend totals per share printed in 10-K filings (saved under data/raw/prices/sec/), on the share
# basis in effect at the filing date. Used only to cross-check the assembled ex-date list.
# fy_end_month: fiscal year = ex-date year (+1 when the ex-date month is later); by="pay": calendar year of payment.
TENK_DIV_TOTALS: dict[str, list[dict]] = {
    "WMT": [  # fiscal years end January 31
        dict(doc="sec/WMT_10K_FY1995_0000104169-95-000004.txt (11-year summary 'Dividends' per share, restated for the 1993 split)",
             basis="1995-04-27", years={1991: ".07", 1992: ".09", 1993: ".11", 1994: ".13", 1995: ".17"}, fy_end_month=1),
    ],
    "INTC": [  # dividends paid per share by year of payment (Intel's fiscal year ends on the last Saturday of December)
        dict(doc="sec/INTC_10K_FY2003_0001193125-04-027430.txt (financial summary 'Dividends Paid Per Share', restated for splits through 2000)",
             basis="2004-02-23", years={1996: ".023", 1997: ".028", 1998: ".033", 1999: ".055", 2000: ".070", 2001: ".080",
                                        2002: ".080", 2003: ".080"}, by="pay", tol="0.00051"),
        dict(doc="sec/INTC_10K_FY2006_0000891618-07-000111.txt (financial summary 'Dividends Paid Per Share')",
             basis="2007-02-26", years={2004: ".16", 2005: ".32", 2006: ".40"}, by="pay"),
    ],
    "COST": [  # dividends paid per share by fiscal year (ends on the Sunday nearest August 31)
        dict(doc="sec/COST_10K_FY2004_0001193125-04-195535.txt (two quarterly dividends of $0.10 in fiscal 2004)",
             basis="2004-11-12", years={2004: "0.20"}, fy_end_month=8),
        dict(doc="sec/COST_10K_FY2006_0001193125-06-238399.txt ('cash dividends paid in fiscal 2006 totaled $0.49 per share. In fiscal 2005 ... $0.43')",
             basis="2006-11-17", years={2005: "0.43", 2006: "0.49"}, fy_end_month=8),
        dict(doc="sec/COST_10K_FY2008_0001193125-08-211709.txt ('quarterly cash dividends paid in 2008 totaled $0.61 per share. In 2007 ... $0.55')",
             basis="2008-10-16", years={2007: "0.55", 2008: "0.61"}, fy_end_month=8),
    ],
}

# Quarterly dividends per share printed in company filings. mode "pay_date": the dividend paid on that date (the row
# with the latest ex-date at most 45 days before it); mode "pay_quarter": the dividend whose pay date falls in that
# calendar quarter. Amounts are on the filing's share basis (restated for splits up to `basis`). Where no split falls
# between the ex-date and `basis`, the filing's amount is the declared one and replaces a differing vendor amount
# (dividendhistory.org rounds WMT's 1990s amounts to 3 dp: 0.0425 -> 0.042, and gives INTC 1994-07-26 as 0.065).
TENK_QUARTERLY: dict[str, list[dict]] = {
    "WMT": [
        dict(doc="sec/WMT_10K_FY1995_0000104169-95-000004.txt 'Dividends Paid Per Share'", basis="1995-04-27", mode="pay_date",
             items=[("1993-04-09", "0.0325"), ("1993-07-09", "0.0325"), ("1993-10-04", "0.0325"), ("1994-01-05", "0.0325"),
                    ("1994-04-14", "0.0425"), ("1994-07-08", "0.0425"), ("1994-10-03", "0.0425"), ("1995-01-05", "0.0425")]),
        dict(doc="sec/WMT_10K_FY1996_0000104169-96-000002.txt 'Dividends Paid Per Share'", basis="1996-04-23", mode="pay_date",
             items=[("1995-04-14", "0.05"), ("1995-07-10", "0.05"), ("1995-10-03", "0.05"), ("1996-01-05", "0.05")]),
        dict(doc="sec/WMT_10K_FY1997_0000104169-97-000003.txt 'Dividends Paid Per Share'", basis="1997-04-21", mode="pay_date",
             items=[("1996-04-08", "0.0525"), ("1996-07-08", "0.0525"), ("1996-10-07", "0.0525"), ("1997-01-17", "0.0525")]),
        dict(doc="sec/WMT_10K_FY1998_0000104169-98-000003.txt 'Dividends Paid Per Share'", basis="1998-04-23", mode="pay_date",
             items=[("1997-04-09", "0.0675"), ("1997-07-14", "0.0675"), ("1997-10-14", "0.0675"), ("1998-01-12", "0.0675")]),
        dict(doc="sec/WMT_10Q_19980615_0000104169-98-000005.txt (Q1 FY1999 'Dividends per share $.0775'; MD&A: fiscal 1999 "
                 "dividend $.31 per share); pay dates from sec/WMT_10K_FY1999", basis="1998-06-15", mode="pay_date",
             items=[("1998-04-06", "0.0775"), ("1998-07-13", "0.0775"), ("1998-10-12", "0.0775"), ("1999-01-11", "0.0775")]),
        dict(doc="sec/WMT_10K_FY1999_0000104169-99-000002.txt 'Dividends Paid Per Share' (restated for the 1999 split)",
             basis="1999-04-20", mode="pay_date",
             items=[("1998-04-06", "0.0388"), ("1998-07-13", "0.0388"), ("1998-10-12", "0.0388"), ("1999-01-11", "0.0388")]),
        dict(doc="sec/WMT_10K_FY2000_0000104169-00-000002.txt 'Dividends Paid Per Share' (restated for the 1999 split)",
             basis="2000-04-17", mode="pay_date",
             items=[("1999-04-19", "0.05"), ("1999-07-12", "0.05"), ("1999-10-12", "0.05"), ("2000-01-10", "0.05")]),
        dict(doc="sec/WMT_10K_FY2001_0001021408-01-500118.txt 'Dividends Paid Per Share'", basis="2001-04-10", mode="pay_date",
             items=[("2000-04-10", "0.06"), ("2000-07-10", "0.06"), ("2000-10-10", "0.06"), ("2001-01-08", "0.06")]),
        dict(doc="sec/WMT_10K_FY2002_0000104169-02-000004.txt 'Dividends Paid Per Share'", basis="2002-04-15", mode="pay_date",
             items=[("2001-04-09", "0.07"), ("2001-07-09", "0.07"), ("2001-10-09", "0.07"), ("2002-01-09", "0.07")]),
        dict(doc="sec/WMT_10K_FY2003_0000104169-03-000005.txt 'Dividends Paid Per Share'", basis="2003-04-15", mode="pay_date",
             items=[("2002-04-18", "0.075"), ("2002-07-08", "0.075"), ("2002-10-07", "0.075"), ("2003-01-06", "0.075")]),
        dict(doc="sec/WMT_10K_FY2004_0001193125-04-059900.txt 'Dividends Paid Per Share'", basis="2004-04-09", mode="pay_date",
             items=[("2003-04-07", "0.09"), ("2003-07-07", "0.09"), ("2003-10-14", "0.09"), ("2004-01-05", "0.09")]),
        dict(doc="sec/WMT_10K_FY2005_0001193125-05-066992.txt 'Dividends Paid Per Share' FY2005 and 'Dividends Payable Per Share' FY2006",
             basis="2005-03-31", mode="pay_date",
             items=[("2004-04-05", "0.13"), ("2004-06-07", "0.13"), ("2004-09-07", "0.13"), ("2005-01-03", "0.13"),
                    ("2005-04-04", "0.15"), ("2005-06-06", "0.15"), ("2005-09-06", "0.15"), ("2006-01-03", "0.15")]),
    ],
    "INTC": [
        dict(doc="sec/INTC_10K_FY1993_0000891618-94-000087.txt 'Financial Information by Quarter' dividends paid (restated for the 1993 split)",
             basis="1994-03-25", mode="pay_quarter",
             items=[("1992Q4", ".05"), ("1993Q1", ".05"), ("1993Q2", ".05"), ("1993Q3", ".05"), ("1993Q4", ".05")]),
        dict(doc="sec/INTC_10K_FY1994_0000050863-95-000004.txt 'Financial Information by Quarter' dividends paid",
             basis="1995-03-28", mode="pay_quarter",
             items=[("1994Q1", ".05"), ("1994Q2", ".05"), ("1994Q3", ".06"), ("1994Q4", ".06")]),
        dict(doc="sec/INTC_10K_FY1995_0000050863-96-000002.txt 'Financial Information by Quarter' dividends paid (restated for the 1995 split)",
             basis="1996-03-29", mode="pay_quarter",
             items=[("1995Q1", ".03"), ("1995Q2", ".03"), ("1995Q3", ".04"), ("1995Q4", ".04")]),
        dict(doc="sec/INTC_10K_FY1997_0000050863-98-000031.txt 'Financial Information by Quarter' dividends paid (restated for the 1997 split)",
             basis="1998-03-27", mode="pay_quarter",
             items=[("1996Q1", ".020"), ("1996Q2", ".020"), ("1996Q3", ".025"), ("1996Q4", ".025"),
                    ("1997Q1", ".025"), ("1997Q2", ".025"), ("1997Q3", ".03"), ("1997Q4", ".03")]),
        dict(doc="sec/INTC_10K_FY1999_0001012870-00-001562.txt 'Financial Information by Quarter' dividends paid (restated for the 1999 split)",
             basis="2000-03-23", mode="pay_quarter",
             items=[("1998Q1", ".015"), ("1998Q2", ".015"), ("1998Q3", ".015"), ("1998Q4", ".020"),
                    ("1999Q1", ".020"), ("1999Q2", ".030"), ("1999Q3", ".030"), ("1999Q4", ".030")]),
    ],
}

# Record and payment dates stated in company filings (ex-date -> (record, pay, doc)); they override vendor dates.
PRIMARY_DATES: dict[str, dict[str, tuple]] = {
    "COST": {
        "2004-05-06": ("2004-05-10", "2004-05-31", "sec/COST_10K_FY2004 (Dividends)"),
        "2004-07-21": ("2004-07-23", "2004-08-27", "sec/COST_10K_FY2004 (Dividends)"),
        "2004-11-03": ("2004-11-05", "2004-11-26", "sec/COST_10K_FY2005 (Dividends)"),
        "2005-02-04": ("2005-02-08", "2005-02-25", "sec/COST_10K_FY2005 (Dividends)"),
        "2005-05-04": ("2005-05-06", "2005-05-27", "sec/COST_10K_FY2005 (Dividends)"),
        "2005-08-03": ("2005-08-05", "2005-08-26", "sec/COST_10K_FY2005 (Dividends)"),
        "2012-12-06": ("2012-12-10", "2012-12-18", "sec/COST_8K_20121129 (special $7.00)"),
        "2015-02-05": ("2015-02-09", "2015-02-27", "sec/COST_8K_20150130 (special $5)"),
        "2015-02-11": ("2015-02-13", "2015-02-27", "sec/COST_8K_20150130 (quarterly 35.5 cents)"),
        "2017-05-08": ("2017-05-10", "2017-05-26", "sec/COST_8K_20170426 (special $7.00)"),
        "2017-05-10": ("2017-05-12", "2017-05-26", "sec/COST_8K_20170426 (quarterly)"),
        "2020-12-01": ("2020-12-02", "2020-12-11", "sec/COST_8K_20201118 (special $10.00)"),
        "2023-12-27": ("2023-12-28", "2024-01-12", "sec/COST_8K_20231214 (special $15)"),
    },
    "ORCL": {"2012-12-12": ("2012-12-14", "2012-12-21", "sec/ORCL_8K_20121203 (accelerated $0.18)")},
    "CRM": {"2024-03-13": ("2024-03-14", "2024-04-11", "sec/CRM_8K_20240228 (first dividend $0.40)")},
    "V": {"2015-11-10": ("2015-11-13", "2015-12-01", "sec/V_8K_20151021 ($0.14; Nov 11 was Veterans Day, a non-settlement day)"),
          "2016-02-10": ("2016-02-12", "2016-03-01", "sec/V_8K_20160205 ($0.14)")},
}

# Quarterly price ranges printed in 10-K filings: (sym, first day, last day, high, low, kind, doc, basis date).
# kind: "close" = highest/lowest closing price (the filing says so), "intraday" = high/low sale price (the filing says
# so), "unstated" = the filing does not say; values are restated for splits up to the basis date.
_WQ = lambda y: [(f"{y - 1}-02-01", f"{y - 1}-04-30"), (f"{y - 1}-05-01", f"{y - 1}-07-31"), (f"{y - 1}-08-01", f"{y - 1}-10-31"),
                 (f"{y - 1}-11-01", f"{y}-01-31")]  # Walmart fiscal quarters of fiscal year y
_OQ = lambda y: [(f"{y - 1}-06-01", f"{y - 1}-08-31"), (f"{y - 1}-09-01", f"{y - 1}-11-30"), (f"{y - 1}-12-01", f"{y}-02-29"),
                 (f"{y}-03-01", f"{y}-05-31")]  # Oracle fiscal quarters of fiscal year y (ISO strings compare, so 02-29 is safe)


def _ranges(sym, quarters, highs, lows, kind, doc, basis, tol=None):
    return [(sym, a, b, h, l, kind, doc, basis, tol) for (a, b), h, l in zip(quarters, highs, lows)]


TENK_PRICE_RANGES: list[tuple] = (
    _ranges("WMT", _WQ(1994) + _WQ(1995), ["34.00", "28.50", "27.25", "29.88", "29.13", "25.88", "26.00", "24.13"],
            ["26.38", "24.88", "23.50", "24.38", "24.00", "22.75", "22.75", "20.88"], "unstated",
            "sec/WMT_10K_FY1995 'Market Price of Common Stock'", "1995-04-27")
    + _ranges("WMT", _WQ(1996) + _WQ(1997), ["26.00", "27.50", "26.00", "24.75", "24.50", "26.25", "28.13", "27.00"],
              ["23.13", "23.00", "21.63", "19.25", "20.88", "22.88", "24.50", "22.13"], "unstated",
              "sec/WMT_10K_FY1997 'Market Price of Common Stock'", "1997-04-21")
    + _ranges("WMT", _WQ(1998) + _WQ(1999), ["14.94", "19.28", "19.38", "20.88", "26.94", "34.50", "34.53", "43.00"],
              ["11.56", "14.13", "16.09", "18.03", "20.41", "24.97", "26.56", "33.44"], "unstated",
              "sec/WMT_10K_FY1999 'Market Price of Common Stock' (restated for the 1999 split)", "1999-04-20")
    + _ranges("WMT", _WQ(2000) + _WQ(2001), ["52.44", "49.19", "57.06", "69.44", "63.56", "62.00", "57.63", "58.44"],
              ["40.47", "41.13", "40.19", "54.75", "44.50", "51.00", "43.25", "43.69"], "unstated",
              "sec/WMT_10K_FY2001 'Market Price of Common Stock'", "2001-04-10")
    + _ranges("WMT", _WQ(2002) + _WQ(2003), ["55.70", "55.90", "55.99", "59.98", "63.75", "58.55", "57.33", "55.57"],
              ["46.91", "47.34", "44.00", "52.24", "55.80", "44.60", "45.60", "47.10"], "unstated",
              "sec/WMT_10K_FY2003 'Market Price of Common Stock'", "2003-04-15")
    + _ranges("INTC", [("1991-12-29", "1992-03-28"), ("1992-03-29", "1992-06-27"), ("1992-06-28", "1992-09-26"), ("1992-09-27", "1992-12-26"),
                       ("1992-12-27", "1993-03-27"), ("1993-03-28", "1993-06-26"), ("1993-06-27", "1993-09-25"), ("1993-09-26", "1993-12-25")],
              ["34.25", "28.94", "33.31", "45.00", "59.94", "58.75", "68.75", "73.25"],
              ["24.38", "23.50", "27.56", "31.25", "43.25", "43.69", "50.00", "56.25"], "unstated",
              "sec/INTC_10K_FY1993 'Market price range Common Stock' (restated for the 1993 split)", "1994-03-25")
    + _ranges("INTC", [("1993-12-26", "1994-04-02"), ("1994-04-03", "1994-07-02"), ("1994-07-03", "1994-10-01"), ("1994-10-02", "1994-12-31")],
              ["72.25", "70.63", "67.25", "66.13"], ["61.25", "57.50", "56.50", "57.81"], "unstated",
              "sec/INTC_10K_FY1994 'Market price range Common Stock'", "1995-03-28")
    + _ranges("INTC", [("1995-01-01", "1995-04-01"), ("1995-04-02", "1995-07-01"), ("1995-07-02", "1995-09-30"), ("1995-10-01", "1995-12-30")],
              ["44.25", "65.63", "76.44", "72.88"], ["31.81", "42.75", "58.63", "56.75"], "unstated",
              "sec/INTC_10K_FY1995 'Market price range Common Stock' (restated for the 1995 split)", "1996-03-29")
    + _ranges("INTC", [("1995-12-31", "1996-03-30"), ("1996-03-31", "1996-06-29"), ("1996-06-30", "1996-09-28"), ("1996-09-29", "1996-12-28"),
                       ("1996-12-29", "1997-03-29"), ("1997-03-30", "1997-06-28"), ("1997-06-29", "1997-09-27"), ("1997-09-28", "1997-12-27")],
              ["30.50", "38.44", "48.69", "68.75", "82.38", "84.66", "100.50", "95.38"],
              ["25.00", "28.44", "34.50", "47.72", "65.19", "65.25", "69.53", "69.13"], "unstated",
              "sec/INTC_10K_FY1997 'Market price range Common Stock' (restated for the 1997 split)", "1998-03-27")
    + _ranges("ORCL", _OQ(1994) + _OQ(1995), ["18.96", "22.00", "25.17", "23.92", "29.58", "31.00", "32.13", "38.50"],
              ["13.25", "15.87", "18.17", "17.50", "22.42", "25.75", "24.67", "28.00"], "unstated",
              "sec/ORCL_10K_FY1995 'low and high sale price as of the close of market' (the values are intraday extremes)", "1995-08-25")
    + _ranges("ORCL", _OQ(1996) + _OQ(1997), ["29.58", "32.50", "36.67", "36.00", "42.13", "50.13", "51.00", "48.13"],
              ["22.67", "23.33", "26.33", "26.49", "32.00", "34.50", "37.00", "33.63"], "unstated",
              "sec/ORCL_10K_FY1997 'low and high sale price as of the close of market' (the values are intraday extremes)", "1997-08-13")
    + _ranges("ORCL", _OQ(1999) + _OQ(2000), ["9.25", "12.29", "20.25", "19.38", "19.88", "38.72", "74.25", "88.44"],
              ["6.64", "6.36", "11.64", "10.72", "12.56", "18.84", "35.34", "62.50"], "close",
              "sec/ORCL_10K_FY2000 'low and high sale price ... based on the last sale' (restated twice, each time rounded to cents)", "2000-08-28", "0.0101")
    + _ranges("ORCL", _OQ(2001), ["45.47", "46.32", "34.56", "21.38"], ["36.16", "22.31", "19.00", "13.25"], "close",
              "sec/ORCL_10K_FY2001 'low and high sale price ... based on the last sale' (restated, rounded to cents twice)", "2001-08-10", "0.0101")
    + _ranges("COST", [("1993-10-22", "1993-12-31"), ("1994-01-01", "1994-03-31"), ("1994-04-01", "1994-06-30"), ("1994-07-01", "1994-09-30")],
              ["21.375", "21.625", "18.25", "16.5"], ["17.125", "16.875", "13", "13.75"], "intraday",
              "sec/COST_10K_FY1994 PriceCostco 'high and low sales prices'", "1994-11-17")
    + _ranges("COST", [("1994-10-01", "1994-12-31")], ["16.75"], ["12.5"], "intraday",
              "sec/COST_10K_FY1995 PriceCostco 'high and low sales prices'", "1995-11-30")
    + _ranges("COST", [(f"{y}-{a}", f"{y}-{b}") for y in (1997, 1998) for a, b in (("01-01", "03-31"), ("04-01", "06-30"), ("07-01", "09-30"), ("10-01", "12-31"))]
              + [("1999-01-01", "1999-03-31"), ("1999-04-01", "1999-06-30"), ("1999-07-01", "1999-09-30"), ("1999-10-01", "1999-10-29")],
              ["30", "35.1875", "39.125", "44.9375", "58.1875", "63.21875", "65", "74.875", "91.8125", "92.5", "86.5625", "83.9375"],
              ["24.125", "26.875", "31.4375", "35.125", "42.125", "51.375", "45.0625", "44.3125", "71.25", "71.125", "66.125", "72"], "close",
              "sec/COST_10K_FY1999 'closing high and low sales prices'", "1999-11-24")
    + _ranges("COST", [("1999-10-01", "1999-12-31"), ("2000-01-01", "2000-03-31"), ("2000-04-01", "2000-06-30"), ("2000-07-01", "2000-09-30"),
                       ("2000-10-01", "2000-11-03")],
              ["49.34375", "55.953125", "58.4375", "38.375", "36.625"], ["36", "42.0625", "30", "31.3125", "30.625"], "close",
              "sec/COST_10K_FY2000 quarterly high/low (post-split; its 1998-1999 rows equal half of FY1999's closing values)", "2000-11-17")
)
# Independent public reporting gathered for spot checks. basis: U = as-traded, SA = split-adjusted to today's
# shares. how: read = page opened and value confirmed; snippet = search-result text only; filing = saved document.
SPOT_CHECKS: list[tuple] = [
    # sym, date, field, value, basis, source, url, how
    ("V", "2008-03-19", "open", "59.50", "U", "Fortune/CNN Money (IPO day)", "https://money.cnn.com/2008/03/19/news/companies/visa_ipo_opens.fortune/index.htm", "snippet"),
    ("V", "2008-03-19", "high", "69", "U", "Fortune/CNN Money ('as high as $69')", "https://money.cnn.com/2008/03/19/news/companies/visa_ipo_opens.fortune/index.htm", "snippet"),
    ("V", "2008-03-19", "close", "56.50", "U", "Fortune/CNN Money; Spokesman-Review", "https://www.spokesman.com/stories/2008/mar/20/visa-ipo-makes-a-splash/", "snippet"),
    ("CRM", "2004-06-23", "open", "15", "U", "Globe and Mail ('first trade was at $15')", "https://www.theglobeandmail.com/report-on-business/salesforcecom-shines-in-debut/article1134400/", "snippet"),
    ("CRM", "2004-06-23", "high", "17.30", "U", "Globe and Mail", "https://www.theglobeandmail.com/report-on-business/salesforcecom-shines-in-debut/article1134400/", "snippet"),
    ("CRM", "2004-06-23", "close", "17.20", "U", "Globe and Mail; TheStreet", "https://www.thestreet.com/technology/salesforcecoms-debut-tops-2004-tech-ipos-10167318", "snippet"),
    ("CRM", "2024-05-30", "close", "218.01", "U", "CNBC/UPI ('$218.01, down $53.61, or 19.7%')", "https://www.cnbc.com/2024/05/30/salesforce-stock-fall-earnings-revenue-miss.html", "snippet"),
    ("CRM", "2024-05-29", "close", "271.62", "U", "derived: 218.01 + 53.61 from the same CNBC/UPI report", "https://www.upi.com/Top_News/US/2024/05/30/Salesforce-share-prices-down/6511717093810/", "snippet"),
    ("V", "2015-03-18", "close", "267.67", "U", "Alpha Spread split table (pre-split price)", "https://www.alphaspread.com/security/nyse/v/investor-returns/i/stock-splits", "snippet"),
    ("INTC", "2000-08-31", "close", "74.875", "U", "record close $74.88 (Dow Jones/Stocktwits, multiple)", "", "snippet"),
    ("INTC", "2024-08-02", "close", "21.48", "U", "Reuters via Yahoo Finance; CNBC", "https://finance.yahoo.com/news/intel-shares-set-fall-most-083323021.html", "snippet"),
    ("ORCL", "2013-06-21", "close", "30.13", "U", "SFGate/TheStreet (day after the NYSE-transfer announcement)", "", "snippet"),
    ("ORCL", "2025-09-10", "close", "328.33", "U", "CNBC ('closing at a record high of $328.33')", "https://www.cnbc.com/2025/09/10/oracle-stock-cloud-backlog-ai.html", "snippet"),
    ("ORCL", "2026-10-02", "close", "142.30", "U", "CNN quote page (search snippet)", "https://www.cnn.com/markets/stocks/ORCL", "snippet"),
    ("WMT", "2025-12-08", "close", "113.56", "U", "ts2.tech (last NYSE day; aggregator)", "https://ts2.tech/en/walmart-wmt-stock-after-hours-on-december-8-2025-nyse-delisting-nasdaq-switch-and-what-to-watch-before-the-december-9-open/", "snippet"),
    ("WMT", "2025-12-09", "close", "115.06", "U", "ts2.tech (first Nasdaq day; aggregator)", "https://ts2.tech/en/walmart-stock-wmt-after-nasdaq-debut-price-action-analyst-upgrades-and-what-to-watch-before-the-december-10-2025-open/", "snippet"),
    ("WMT", "1990-07-06", "close", "62.5", "U", "Walmart IR stock split history ('Split Date Mkt. Price', June 1990 split distributed 7/6/90)", "https://stock.walmart.com/stock-data/stock-split-history", "read"),
    ("WMT", "1993-02-25", "close", "63.625", "U", "Walmart IR stock split history (Feb. 1993 split distributed 2/25/93)", "https://stock.walmart.com/stock-data/stock-split-history", "read"),
    ("WMT", "1999-04-19", "close", "89.75", "U", "Walmart IR stock split history (March 1999 split distributed 4/19/99)", "https://stock.walmart.com/stock-data/stock-split-history", "read"),
    ("WMT", "2024-02-23", "close", "175.56", "U", "Walmart IR stock split history (Feb. 2024 split distributed 2/23/24)", "https://stock.walmart.com/stock-data/stock-split-history", "read"),
    ("INTC", "2026-06-22", "close", "140.94", "U", "Macrotrends all-time-high close (search snippet; adjusted series, no INTC actions after 2024-08-07)", "https://www.macrotrends.net/stocks/charts/INTC/intel/stock-price-history", "snippet"),
    ("INTC", "2026-09-16", "close", "101.05", "U", "Macrotrends latest close (search snippet; same caveat)", "https://www.macrotrends.net/stocks/charts/INTC/intel/stock-price-history", "snippet"),
    ("COST", "2025-02-06", "close", "1050.99", "U", "Yahoo Finance/TheStreet ('closed at a record $1,050.99, up $8.11')", "https://finance.yahoo.com/news/analysts-reset-costco-stock-price-223454661.html", "snippet"),
    ("COST", "2026-05-08", "close", "1008.79", "U", "24/7 Wall St. via Yahoo Finance", "https://247wallst.com/investing/2026/05/11/costco-just-hit-1000-is-this-the-year-to-sell-in-may-even-on-the-safest-stocks/", "snippet"),
]

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


_CAL = None


def sessions(start: dt.date, end: dt.date) -> list[dt.date]:
    global _CAL
    if _CAL is None:
        _CAL = xcals.get_calendar("XNYS", start="1990-01-02", end="2026-12-31")
    return [x.date() for x in _CAL.sessions_in_range(start.isoformat(), end.isoformat())]


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
    """dividendhistory.org: ex-date, payout date, cash amount; skips estimated rows."""
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
        if facts is not None:  # companyfacts is complete where the companyconcept endpoint returned no units (V)
            j = facts.get(concept, {})
        else:
            f = RAW / "sec" / f"{sym}_xbrl_{concept}_{R}.json"
            try:
                j = json.loads(f.read_text())
            except (FileNotFoundError, ValueError):  # concept not reported (saved 404 body)
                continue
        best = {}
        for unit, u in j.get("units", {}).items():
            if unit != "USD/shares" or not isinstance(u, list):
                continue
            for x in u:
                if "start" not in x:
                    continue
                a, b = dt.date.fromisoformat(x["start"]), dt.date.fromisoformat(x["end"])
                n = (b - a).days
                kind = ("Q" if 80 <= n <= 100 else "FY" if 350 <= n <= 380 else
                        "YTD" if 170 <= n <= 190 or 260 <= n <= 285 else None)  # 6- and 9-month year-to-date facts
                if kind and ((a, b) not in best or x["filed"] < best[(a, b)]["filed"]):
                    best[(a, b)] = dict(x, kind=kind)
        for (a, b), x in sorted(best.items()):
            out.append(dict(concept=concept, kind=x["kind"], start=a, end=b, val=D(str(x["val"])), form=x["form"],
                            filed=dt.date.fromisoformat(x["filed"]), accn=x["accn"]))
    return out


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
    chart's 0.989 factor on WMT 2000-2024) without hiding day-level errors."""

    def __init__(self, name: str, sym: str, series: dict, base: dict, native: bool = False):
        self.name, self.sym, self.s, self.native = name, sym, series, native
        self.dates = sorted(series)
        self.scale: dict[dt.date, Decimal] = {}
        base_ratio = {}
        for d in self.dates:
            b, v = base.get(d), series[d]
            if b and b["close"] and v["close"]:
                base_ratio[d] = b["close"] / (v["close"] * self.F(d))
        # zero-volume placeholder rows (O/H/L/C all equal to the prior close, volume 0) carry no data for the day
        self.placeholder = set()
        for p, d in zip(self.dates, self.dates[1:]):
            r, q = series[d], series[p]
            if not r.get("volume") and r["close"] is not None and r["close"] == q["close"] \
                    and r["high"] == r["close"] and r["low"] == r["close"] and r["open"] in (None, r["close"]):
                self.placeholder.add(d)
        for d in self.placeholder:
            base_ratio.pop(d, None)
        rd = sorted(base_ratio)
        for d in self.dates:
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
        if not r or r.get(field) is None or d in self.placeholder:
            return None
        return r[field] * self.F(d) * self.scale[d]

    def raw_unsplit(self, d, field) -> Decimal | None:
        r = self.s.get(d)
        if not r or r.get(field) is None or d in self.placeholder:
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
        return bool(r) and d not in self.placeholder and ohlc_ok(r)

    def vol_unsplit(self, d) -> int | None:
        r = self.s.get(d)
        if not r or not r.get("volume") or d in self.placeholder:
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


def build_prices(sym: str):
    cfg = SYMBOLS[sym]
    start = dt.date.fromisoformat(cfg["start"])
    exp = sessions(start, END)
    A = {d: r for d, r in load_cnbc(cfg.get("cnbc", sym), True).items() if d <= END}
    A_adj = load_cnbc(cfg.get("cnbc", sym), False)
    nh = {d: r for d, r in load_nasdaq_hist(cfg.get("nasdaq", sym)).items() if d <= END}
    nc = {d: r for d, r in load_nasdaq_chart(sym).items() if d <= END}
    cb = {d: r for d, r in load_cboe(sym).items() if d <= END}
    sa = {d: r for d, r in load_sa(sym).items() if d <= END}
    V = {
        "nasdaq": Vendor("nasdaq", sym, nh, A),
        "nasdaq_chart": Vendor("nasdaq_chart", sym, nc, A),
        "cboe": Vendor("cboe", sym, cb, A),
        "stockanalysis": Vendor("stockanalysis", sym, sa, A),
    }
    rep = {"calendar": {}, "conflicts": [], "overrides": [], "unverified": [], "nulled": [], "volume_overrides": [],
           "within_tick": [], "ohl_conflicts_nulled": []}
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
                                              {"nasdaq_row_repeats_prior_day": stale, "nasdaq_row_zero_volume_placeholder": d in Nv.placeholder,
                                               "nasdaq_row_ohlc_consistent": Nv.row_ok(d),
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
            bad = DEFECTIVE_BASE.get(sym, {}).get(f)
            if bad and bad[0] <= d.isoformat() <= bad[1]:
                av = None
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
            elif av is None and nv is not None and not third and Nv.level_ok(d) and snap(Nv.raw_unsplit(d, f), d)[1]:
                # the base field is missing or known-defective and only the second vendor publishes one
                r[f] = snap(Nv.raw_unsplit(d, f), d)[0]
                fsrc[f] = f"{Nv.name}_only"
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


# Corrections that need a document the vendors lack; each is justified in the batch-3 doc.
_WMT_INFERRED = ("inferred, not printed in any saved filing: dividendhistory.org/.net give {v3} (they round WMT amounts to 3 dp: "
                 "every 1993-1999 quarter that a 10-K prints exactly is 0.0325/0.0425/0.0525/0.0675/0.0775 vs their "
                 "0.032/0.042/0.052/0.068/0.078); the FY1995 10-K's restated FY{fy} total {tot} is reproduced only by {v4} "
                 "(4 x {v4}/2 = {calc}; 4 x {v3}/2 = {calc3} rounds to {r3}){extra}")
MANUAL_DIVIDENDS: dict[str, dict] = {
    "WMT": {
        "set": {
            **{e: ("amount", "0.0425", _WMT_INFERRED.format(v3="0.042", fy=1992, tot=".09", v4="0.0425", calc="0.085",
                                                            calc3="0.084", r3=".08", extra=""))
               for e in ("1991-03-18", "1991-06-11", "1991-08-26", "1991-12-05")},
            **{e: ("amount", "0.0525", _WMT_INFERRED.format(v3="0.052", fy=1993, tot=".11", v4="0.0525", calc="0.105",
                                                            calc3="0.104", r3=".10",
                                                            extra="; FY1993 cash dividends of $241 million on about 1,149 million "
                                                                  "pre-split shares (FY1995 10-K) = $0.2097/share = 4 x 0.0524"))
               for e in ("1992-03-17", "1992-06-09", "1992-09-01", "1992-12-04")},
        },
    },
}


def dho_scale(sym, ex) -> Decimal:
    return D(1) if sym in DHO_AS_TRADED else factor(sym, ex)


def load_dhnet(sym: str) -> dict:
    """dividendhistory.net: ex, declaration, record and pay dates (amounts are not used: same rounded upstream as .org)."""
    f = RAW / "dividendhistory_net" / f"{sym}_{R}.html"
    if not f.exists():
        return {}
    t = f.read_text(encoding="utf-8", errors="replace")
    out = {}
    for tb in re.findall(r"<table.*?</table>", t, flags=re.S):
        for r in re.findall(r"<tr.*?</tr>", tb, flags=re.S):
            c = [re.sub(r"\s+", " ", re.sub("<[^>]+>", "", x)).strip() for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, flags=re.S)]
            if len(c) >= 8 and re.match(r"\d\d/\d\d/\d{4}$", c[0]):
                g = lambda s: parse_date(s) if re.match(r"\d\d/\d\d/\d{4}$", s) else None
                out[parse_date(c[0])] = dict(ex=parse_date(c[0]), decl=g(c[1]), record=g(c[2]), pay=g(c[3]))
    return out


SETTLE = [(dt.date(1995, 6, 7), 5), (dt.date(2017, 9, 5), 3), (dt.date(2024, 5, 28), 2), (dt.date(9999, 1, 1), 1)]


def _bank_holiday(d: dt.date) -> bool:
    """Federal Reserve holidays on which the NYSE trades but nothing settles: Columbus Day and Veterans Day."""
    if d.month == 10 and d.weekday() == 0 and 8 <= d.day <= 14:
        return True
    vet = dt.date(d.year, 11, 11)
    vet = vet + dt.timedelta(days=1) if vet.weekday() == 6 else vet  # Sunday -> Monday; Saturday is not observed
    return d == vet


def expected_ex(record: dt.date) -> dt.date:
    """Regular-way ex-date implied by a record date: the first session whose trades settle after the record date."""
    n = next(c for until, c in SETTLE if record < until)
    ds = sessions(record - dt.timedelta(days=21), record + dt.timedelta(days=10))
    settle_days = [d for d in ds if not _bank_holiday(d)]

    def settles(t):
        later = [d for d in settle_days if d > t]
        return later[n - 1] if n >= 1 and len(later) >= n else None

    last_in = max((t for t in ds if settles(t) and settles(t) <= record), default=None)
    return next((t for t in ds if last_in and t > last_in), record)


def quarter_of(d: dt.date) -> str:
    return f"{d.year}Q{(d.month - 1) // 3 + 1}"


def build_dividends(sym: str, start: dt.date, sess: set):
    rep = {"rows": [], "notes": []}
    nas = [x for x in load_nasdaq_divs(sym) if x["type"] == "Cash"]
    dho = load_dho(sym)
    sad = load_sa_divs(sym)
    dhn = load_dhnet(sym)
    for x in dho:
        x["amount"] = x["amount_adj"].normalize() if sym in DHO_AS_TRADED else as_declared(sym, x["ex"], x["amount_adj"])
    for x in sad:
        x["amount"] = as_declared(sym, x["ex"], x["amount_adj"])
    spec = {dt.date.fromisoformat(k): D(v) for k, v in SPECIALS.get(sym, {}).items()}
    kind = lambda ex, amt: "special_dividend" if spec.get(ex) == amt else "cash_dividend"
    dho_src = "dividendhistory.org" + ("" if sym in DHO_AS_TRADED else "(split-adj x factor)")
    base: list[dict] = []
    if DIV_BASE[sym] == "dho":
        for x in dho:
            s = nearest(sad, x["ex"], 0)
            base.append(dict(ex=x["ex"], amount=x["amount"], type=kind(x["ex"], x["amount"]), pay=x["pay"],
                             record=s["record"] if s else None, decl=s["decl"] if s else None, src=dho_src))
    else:
        for x in nas:
            base.append(dict(ex=x["ex"], amount=x["amount"], type=kind(x["ex"], x["amount"]), record=x["record"],
                             pay=x["pay"], decl=x["decl"], src="nasdaq"))
        for x in dho:  # dividends the Nasdaq list lacks
            if not nearest(base, x["ex"], 4) and start <= x["ex"] <= END:
                base.append(dict(ex=x["ex"], amount=x["amount"], type=kind(x["ex"], x["amount"]), record=None,
                                 pay=x["pay"], decl=None, src=dho_src))
                rep["notes"].append(f"{x['ex']} added from dividendhistory.org (missing from Nasdaq list)")
    for x in base:
        x["date_src"] = {"record": x["src"].split("(")[0] if x.get("record") else None, "pay": x["src"].split("(")[0] if x.get("pay") else None}
    man = MANUAL_DIVIDENDS.get(sym, {})
    for e, why in man.get("drop", {}).items():
        before = len(base)
        base = [x for x in base if x["ex"].isoformat() != e]
        rep["notes"].append(f"{e} dropped ({before - len(base)} row): {why}")
    for e, (field, val, why) in man.get("set", {}).items():
        hit = [x for x in base if x["ex"].isoformat() == e]
        if len(hit) != 1:
            raise RuntimeError(f"{sym} manual set {e}: {len(hit)} rows")
        x = hit[0]
        old = x.get(field)
        x[field] = D(val) if field == "amount" else (dt.date.fromisoformat(val) if field in ("record", "pay") else val)
        x["src"] += f";{field}=manual"
        x.setdefault("_manual", {})[field] = why
        rep["notes"].append(f"{e} {field} {old} -> {val}: {why}")
    for m in man.get("add", []):
        base.append(dict(ex=dt.date.fromisoformat(m["ex"]), amount=D(m["amount"]), type=m["type"],
                         record=dt.date.fromisoformat(m["record"]) if m["record"] else None,
                         pay=dt.date.fromisoformat(m["pay"]) if m["pay"] else None,
                         decl=dt.date.fromisoformat(m["decl"]) if m["decl"] else None, src="manual:" + m["src"],
                         date_src={"record": "manual", "pay": "manual"}))
        rep["notes"].append(f"{m['ex']} added: {m['src']}")
    base = sorted((x for x in base if start <= x["ex"] <= END), key=lambda x: (x["ex"], x["type"]))
    missing_specials = [e.isoformat() for e, a in spec.items() if not any(x["ex"] == e and x["amount"] == a for x in base)]
    if missing_specials:
        raise RuntimeError(f"{sym}: configured special dividends not found in the base list: {missing_specials}")
    # ---- dividendhistory.org's pay dates are unreliable for some symbols (WMT 1980s-90s: ex + ~19 days, contradicting
    # the 10-K payment dates; INTC 1992-2002: equal to the record date). dividendhistory.net's dates agree with the 10-Ks
    # and with Nasdaq (91/91 WMT, 45/45 INTC), so its record/pay dates fill or replace dividendhistory.org's.
    for x in base:
        h = dhn.get(x["ex"])
        if not h:
            continue
        if h["record"] and not x.get("record"):
            x["record"], x["date_src"]["record"] = h["record"], "dividendhistory.net"
        if h["pay"] and (not x.get("pay") or (x["date_src"]["pay"] or "").startswith("dividendhistory.org")):
            if x.get("pay") and x["pay"] != h["pay"]:
                rep["notes"].append(f"{x['ex']} pay date {x['pay']} (dividendhistory.org) -> {h['pay']} (dividendhistory.net)")
            x["pay"], x["date_src"]["pay"] = h["pay"], "dividendhistory.net"
    # ---- record/pay dates stated in company filings
    for e, (rec, pay, doc) in PRIMARY_DATES.get(sym, {}).items():
        hit = [x for x in base if x["ex"].isoformat() == e]
        if len(hit) != 1:
            raise RuntimeError(f"{sym} primary dates {e}: {len(hit)} rows")
        x = hit[0]
        for f, v in (("record", rec), ("pay", pay)):
            v = dt.date.fromisoformat(v)
            if x.get(f) and x[f] != v:
                rep["notes"].append(f"{e} {f} date {x[f]} ({x['date_src'][f]}) -> {v} ({doc})")
            x[f], x["date_src"][f] = v, doc
    # ---- quarterly amounts printed in filings (see TENK_QUARTERLY)
    for t in TENK_QUARTERLY.get(sym, []):
        basis = dt.date.fromisoformat(t["basis"])
        for key, amt in t["items"]:
            amt = D(amt)
            if t["mode"] == "pay_date":
                pay = dt.date.fromisoformat(key)
                cands = [x for x in base if x["type"] == "cash_dividend" and x["ex"] <= pay and (pay - x["ex"]).days <= 45]
                x = max(cands, key=lambda x: x["ex"]) if cands else None
            else:
                cands = [x for x in base if x["type"] == "cash_dividend" and x.get("pay") and quarter_of(x["pay"]) == key]
                x = cands[0] if len(cands) == 1 else None
            entry = {"doc": t["doc"], "key": key, "filing_amount": str(amt), "basis": t["basis"]}
            if x is None:
                entry["result"] = f"no unique dividend row ({len(cands)} candidates)"
                rep.setdefault("tenk_quarterly", []).append(entry)
                continue
            div = basis_divisor(sym, x["ex"], basis)
            ours = x["amount"] / div
            # an amount printed on the as-declared basis is exact (filings print .025 or .0325 where needed);
            # a restated amount is rounded to the printed precision
            ok = ours == amt if div == 1 else same_amount(ours, amt)
            entry.update(ex=x["ex"].isoformat(), vendor_amount=str(x["amount"]), divisor=str(div))
            if not ok and div == 1 and "_manual" not in x:
                x.setdefault("_vendor_amount", x["amount"])
                x["amount"], ok = amt, True
                x["src"] += ";amount=sec_filing"
                entry["result"] = "vendor amount replaced by the filing's"
                rep["notes"].append(f"{x['ex']} amount {entry['vendor_amount']} -> {amt} ({t['doc'].split(' ')[0]})")
            else:
                entry["result"] = "match" if ok else "MISMATCH"
            if t["mode"] == "pay_date":
                if x.get("pay") != pay:
                    entry["pay_date_replaced"] = None if not x.get("pay") else x["pay"].isoformat()
                x["pay"], x["date_src"]["pay"] = pay, t["doc"].split(" ")[0]
            x.setdefault("_tq", {})[f"sec_filing_quarterly:{t['doc'].split(' ')[0]}"] = (f"{amt} on basis {t['basis']} ({key})", ok)
            rep.setdefault("tenk_quarterly", []).append(entry)
    for x in base:
        # before T+1 the record date always followed the ex-date; a vendor row with record == ex is a copy
        if x.get("record") and x["record"] == x["ex"] and x["ex"] < T1_START:
            rep["notes"].append(f"{x['ex']} record date dropped ({x['date_src']['record']} repeats the ex-date; impossible before T+1)")
            x["record"] = None
        if x.get("pay") and (x["pay"] < x["ex"] or (x.get("record") and x["pay"] < x["record"])):
            rep["notes"].append(f"{x['ex']} pay date {x['pay']} dropped ({x['date_src']['pay']}: payable before ex/record date is impossible)")
            x["pay"] = None
        if x.get("record"):
            ee = expected_ex(x["record"])
            x["ex_vs_record_rule"] = "ok" if ee == x["ex"] else f"rule gives {ee}"
            if ee != x["ex"]:
                rep.setdefault("ex_date_vs_record_rule_mismatch", []).append(
                    [x["ex"].isoformat(), x["record"].isoformat(), ee.isoformat(), x["date_src"]["record"]])
    xb = load_xbrl(sym)
    for x in base:
        amt, chk, exsrc = x["amount"], dict(x.get("_tq", {})), [x["src"].split("(")[0].split(":")[0].split(";")[0]]
        if x["src"] != "nasdaq":
            n = nearest(nas, x["ex"], 4, amt)
            if n:
                chk["nasdaq"] = (str(n["amount"]), same_amount(amt, n["amount"]))
                if n["ex"] == x["ex"]:
                    exsrc.append("nasdaq")
        if not x["src"].startswith("dividendhistory"):
            h = nearest(dho, x["ex"], 3, amt)
            if h:
                chk["dividendhistory.org"] = (f"{h['amount']} (ex {h['ex']})",
                                              same_amount(amt, h["amount"], dho_scale(sym, h["ex"]), h["amount_adj"]))
                if h["ex"] == x["ex"]:
                    exsrc.append("dividendhistory.org")
        s = nearest(sad, x["ex"], 0, amt)
        if s:
            chk["stockanalysis"] = (str(s["amount"]), same_amount(amt, s["amount"], factor(sym, s["ex"]), s["amount_adj"]))
            exsrc.append("stockanalysis")
        if x["ex"] in dhn and "dividendhistory.net" not in exsrc:
            exsrc.append("dividendhistory.net")
        x["checks"] = chk
        x["ex_sources"] = exsrc
        x["ex_is_session"] = x["ex"] in sess
    # ---- company XBRL. Quarterly and annual facts are compared with the SUM of every dividend (regular and special)
    # declared (or paid) in the period: Intel declares two quarters' dividends in some quarters, Walmart its whole
    # year in Q1, and Costco's specials share quarters with regular dividends. Visa's facts are per-quarter rates.
    for f in xb:
        if f["end"] < start or f["start"] > END:
            continue
        key = "decl" if f["concept"].endswith("Declared") else "pay"
        when = lambda x: decl_proxy(x) if key == "decl" else x.get("pay")
        m = [x for x in base if when(x) and f["start"] <= when(x) <= f["end"]]
        if not m:
            continue
        if sym in XBRL_RATE:
            reg = [x for x in m if x["type"] == "cash_dividend"]
            res = [same_amount(x["amount"] / basis_divisor(sym, x["ex"], f["filed"]), f["val"]) for x in reg]
            ok = bool(reg) and all(res)
            tot = None
        else:
            tot = sum((x["amount"] / basis_divisor(sym, x["ex"], f["filed"]) for x in m), D(0))
            restated = any(basis_divisor(sym, x["ex"], f["filed"]) != 1 for x in m)
            ok = same_amount(tot, f["val"]) or abs(tot - f["val"]) <= (D("0.0051") * len(m) if restated else D("0.0051"))
        rep.setdefault(f"xbrl_{f['kind'].lower()}_facts", []).append(
            {"concept": f["concept"][26:], "period": f"{f['start']}..{f['end']}", "xbrl": str(f["val"]),
             "ours": str(tot.normalize()) if tot is not None else "rate check", "n": len(m), "match": ok,
             "filed": f["filed"].isoformat(), "form": f["form"]})
        label = "sec_xbrl_rate" if sym in XBRL_RATE else f"sec_xbrl_{f['kind'].lower()}_{key}"
        for x in m:
            if ok:
                x["checks"][label] = (f"{f['val']} {f['form']} {f['start']}..{f['end']}", True)
            else:
                x["checks"].setdefault(label + "_mismatch", (f"{f['val']} {f['form']} {f['start']}..{f['end']}", False))
    for x in base:  # a matching fact supersedes a mismatching one of the same kind (e.g. a later restated filing)
        for k in [k for k in x["checks"] if k.endswith("_mismatch") and k[: -len("_mismatch")] in x["checks"]]:
            del x["checks"][k]
    for t in TENK_DIV_TOTALS.get(sym, []):
        basis = dt.date.fromisoformat(t["basis"])
        for y, v in t["years"].items():
            fy = t.get("fy_end_month")
            if fy:
                yr = lambda x: x["ex"].year + (1 if x["ex"].month > fy else 0)
            elif t.get("by") == "pay":
                yr = lambda x: (x.get("pay") or x["ex"]).year
            else:
                yr = lambda x: decl_proxy(x).year
            m = [x for x in base if (x["type"] == "cash_dividend" or t.get("incl_special")) and yr(x) == y]
            tot = sum((x["amount"] / basis_divisor(sym, x["ex"], basis) for x in m), D(0))
            ok = abs(tot - D(v)) <= D(t.get("tol", "0.005"))
            rep.setdefault("tenk_annual_totals", []).append(
                {"year": y, "tenk": v, "ours_on_tenk_basis": str(tot.quantize(D("0.0001"))), "n": len(m), "match": ok, "doc": t["doc"]})
            for x in m:
                x["checks"]["sec_10k_annual_total" if ok else "sec_10k_annual_total_mismatch"] = (f"{v} ({y}, {t['doc'].split(' ')[0]})", ok)
    for x in base:
        chk = x["checks"]
        x["n_sources_agree"] = 1 + sum(1 for _, ok in chk.values() if ok)
        x["disagree"] = {k: v for k, (v, ok) in chk.items() if not ok}
        rep["rows"].append({"ex": x["ex"].isoformat(), "amount": str(x["amount"]), "type": x["type"], "src": x["src"],
                            "record": x["record"].isoformat() if x.get("record") else None,
                            "pay": x["pay"].isoformat() if x.get("pay") else None, "date_src": x["date_src"],
                            "vendor_amount_replaced": str(x["_vendor_amount"]) if "_vendor_amount" in x else None,
                            "manual": x.get("_manual"), "ex_vs_record_rule": x.get("ex_vs_record_rule"),
                            "checks": {k: v for k, (v, ok) in chk.items() if ok}, "n_agree": x["n_sources_agree"],
                            "disagree": x["disagree"], "ex_date_sources": x["ex_sources"], "ex_is_session": x["ex_is_session"]})
    for name, lst in (("nasdaq", nas), ("dividendhistory.org", dho), ("stockanalysis", sad), ("dividendhistory.net", list(dhn.values()))):
        miss = [x["ex"].isoformat() for x in lst if start <= x["ex"] <= END and not nearest(base, x["ex"], 4)]
        if miss:
            rep.setdefault("in_secondary_not_base", {})[name] = miss
        if name == "dividendhistory.net":
            other = [x["ex"].isoformat() for x in lst if start <= x["ex"] <= END and nearest(base, x["ex"], 4)
                     and not any(b["ex"] == x["ex"] for b in base)]
            if other:
                rep["dividendhistory_net_ex_date_differs"] = other
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
    all_sess = set(sessions(dt.date(1990, 1, 2), END))
    SEED.mkdir(parents=True, exist_ok=True)
    for sym in SYMBOLS:
        start = dt.date.fromisoformat(SYMBOLS[sym]["start"])
        rows, prep, raw = build_prices(sym)
        sym_rep = {"prices": prep}
        # ---- corporate actions
        divs, drep = build_dividends(sym, start, all_sess) if sym in DIV_SYMBOLS else ([], {"rows": []})
        sym_rep["dividends"] = drep
        closes = {d: r["close"] for d, (r, _) in rows.items()}
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
        acts.sort(key=lambda r: (r[0], r[1] != "split", r[1]))
        with (SEED / f"{sym}_actions.csv").open("w", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["ex_date", "action_type", "cash_amount", "record_date", "pay_date", "split_from", "split_to"])
            w.writerows(acts)
        # ---- write prices
        out = []
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
                           "rows_close_within_tick": sum(1 for x in out if "close_within_tick" in x[-1]),
                           "n_splits": sum(1 for a in acts if a[1] == "split"),
                           "n_cash_dividends": sum(1 for a in acts if a[1] == "cash_dividend"),
                           "n_special_dividends": sum(1 for a in acts if a[1] == "special_dividend"),
                           "price_return_pct": float((pr[END] / pr[start] - 1) * 100),
                           "total_return_pct": float((tr[END] / tr[start] - 1) * 100)}
        report["symbols"][sym] = sym_rep
        s = sym_rep["seed"]
        t = (sym_rep["tr_check_vs_stockanalysis"] or {}).get("pipeline_tr_convention") or {}
        tm = (sym_rep["tr_check_vs_stockanalysis"] or {}).get("vendor_multiplier_convention") or {}
        print(f"{sym}: {s['rows']} rows {s['first']}..{s['last']} calendar_ok={s['dates_equal_calendar']} "
              f"splits={s['n_splits']} divs={s['n_cash_dividends']}+{s['n_special_dividends']} "
              f"unverified={s['rows_close_unverified']} within_tick={s['rows_close_within_tick']} "
              f"overrides={len(prep['overrides'])} nulled={len(prep['nulled'])} "
              f"tr_maxrel_bp={t.get('max_rel_dev_bp')} mult_maxrel_bp={tm.get('max_rel_dev_bp')}")
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
        elif ours is not None and basis.startswith("restated:"):
            ours = ours / basis_divisor(sym, dt.date.fromisoformat(d), dt.date.fromisoformat(basis.split(":", 1)[1]))
        if ours is None:
            m = "no value in seed"
        elif f == "volume":
            m = "match" if abs(ours - D(v)) <= D("0.01") * D(v) else "MISMATCH"
        else:
            diff = abs(ours - D(v))
            m = "match" if diff <= D("0.005") else ("match (rounding <=1c)" if diff <= D("0.0101") else "MISMATCH")
        sc.append({"symbol": sym, "date": d, "field": f, "reported": v, "basis": basis, "seed": None if ours is None else str(ours.normalize()),
                   "seed_source": row["source"] if row else None, "result": m, "source": src, "url": url, "how": how})
    for sym, a, b, hi, lo, kind, doc, basis, rtol in TENK_PRICE_RANGES:
        rr = [(d, x) for d, x in seeds[sym].items() if a <= d <= b]
        bd = dt.date.fromisoformat(basis)
        div = lambda d: basis_divisor(sym, dt.date.fromisoformat(d), bd)
        ext = {"close": (max(dec(x["close"]) / div(d) for d, x in rr), min(dec(x["close"]) / div(d) for d, x in rr)),
               "intraday": (max((dec(x["high"]) / div(d) for d, x in rr if x["high"]), default=None),
                            min((dec(x["low"]) / div(d) for d, x in rr if x["low"]), default=None))}
        for i, (lab, v) in enumerate((("high", hi), ("low", lo))):
            if v is None:
                continue
            dp = max(-D(v).normalize().as_tuple().exponent, 0)
            # the filing's rounding, plus the seed's 4-dp rounding of fine fractions (63 7/32 = 63.21875 -> 63.2188)
            tol = D(rtol) if rtol else D("0.5") * D(10) ** -dp + D("0.00005") * max(div(d) for d, _ in rr) + D("1e-9")
            fits = {k: (e[i] is not None and abs(e[i] - D(v)) <= tol) for k, e in ext.items()}
            if kind == "unstated":
                ok = any(fits.values())
                how_fit = ",".join(k for k, f in fits.items() if f) or "neither"
                ours = ext["close"][i] if fits["close"] or not fits["intraday"] else ext["intraday"][i]
            else:
                ok, how_fit, ours = fits[kind], kind, ext[kind][i]
            sc.append({"symbol": sym, "date": f"{a}..{b}", "field": f"quarter {lab} ({kind})", "reported": v,
                       "basis": f"restated to {basis}", "seed": None if ours is None else str(ours.normalize()),
                       "seed_close_extreme": str(ext["close"][i].normalize()),
                       "seed_intraday_extreme": None if ext["intraday"][i] is None else str(ext["intraday"][i].normalize()),
                       "fits": how_fit, "seed_source": "", "result": "match" if ok else "MISMATCH",
                       "source": doc, "url": "", "how": "saved filing"})
    report["spot_checks"] = sc
    print("spot checks:", {k: sum(1 for x in sc if x["result"].startswith(k)) for k in ("match", "MISMATCH", "no value")})
    out = RAW / f"verification_batch3_{R}.json"
    out.write_text(json.dumps(report, indent=1, default=str))
    print("wrote", out)


if __name__ == "__main__":
    main()
