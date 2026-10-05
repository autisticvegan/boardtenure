#!/usr/bin/env python3
"""Normalize, cross-verify and merge raw daily price data for LYFT, SPY (and ^GSPC for comparison).

Stdlib only. Reads untouched raw responses from data/raw/prices/<source>/ and writes:
  - data/seed/prices/<SYMBOL>.csv          (merged reference series)
  - data/raw/prices/verification_<RETRIEVED>.json  (full diff report; gitignored, re-derivable)

Usage: python3 scripts/prices/verify_prices.py [RETRIEVED_YYYYMMDD]
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import re
import statistics
import sys
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP, getcontext
from pathlib import Path

getcontext().prec = 40

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "prices"
SEED = ROOT / "data" / "seed" / "prices"
RETRIEVED = sys.argv[1] if len(sys.argv) > 1 else "20261004"

WINDOW_START = dt.date(2019, 3, 1)
LAST_SESSION = dt.date(2026, 10, 2)
LYFT_FIRST_TRADE = dt.date(2019, 3, 29)
CENT = Decimal("0.01")

# NYSE/Nasdaq full-day closures in the window (weekday holidays only). Cross-checked against
# exchange_calendars 4.13.2 XNYS sessions (1909 sessions 2019-03-01..2026-10-02).
HOLIDAYS = {
    "2019-04-19", "2019-05-27", "2019-07-04", "2019-09-02", "2019-11-28", "2019-12-25",
    "2020-01-01", "2020-01-20", "2020-02-17", "2020-04-10", "2020-05-25", "2020-07-03",
    "2020-09-07", "2020-11-26", "2020-12-25",
    "2021-01-01", "2021-01-18", "2021-02-15", "2021-04-02", "2021-05-31", "2021-07-05",
    "2021-09-06", "2021-11-25", "2021-12-24",
    "2022-01-17", "2022-02-21", "2022-04-15", "2022-05-30", "2022-06-20", "2022-07-04",
    "2022-09-05", "2022-11-24", "2022-12-26",
    "2023-01-02", "2023-01-16", "2023-02-20", "2023-04-07", "2023-05-29", "2023-06-19",
    "2023-07-04", "2023-09-04", "2023-11-23", "2023-12-25",
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19",
    "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
    "2026-07-03", "2026-09-07",
}
HOLIDAY_DATES = {dt.date.fromisoformat(d) for d in HOLIDAYS}


def sessions(start: dt.date, end: dt.date) -> list[dt.date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5 and d not in HOLIDAY_DATES:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def dec(s) -> Decimal | None:
    if s is None:
        return None
    s = str(s).strip().replace("$", "").replace(",", "")
    if s in ("", "N/A", "null"):
        return None
    return Decimal(s)


def num_str(d: Decimal) -> str:
    """Canonical decimal string without exponent or trailing zeros beyond 2 dp."""
    q = d.normalize()
    s = format(q, "f")
    if "." not in s:
        s += ".00"
    elif len(s.split(".")[1]) == 1:
        s += "0"
    return s


def row(o, h, l, c, v, a=None):
    return {
        "open": dec(o), "high": dec(h), "low": dec(l), "close": dec(c),
        "adj_close": dec(a), "volume": None if dec(v) is None else int(dec(v)),
    }


def degraded(r: dict) -> bool:
    """Placeholder-looking bar: no volume and O=H=L=C."""
    return r["volume"] is None and r["open"] == r["high"] == r["low"] == r["close"]


# ---------------------------------------------------------------- loaders

def load_nasdaq(sym: str) -> dict[dt.date, dict]:
    j = json.loads((RAW / "nasdaq" / f"{sym}_{RETRIEVED}.json").read_text())
    out = {}
    for r in j["data"]["tradesTable"]["rows"]:
        d = dt.datetime.strptime(r["date"], "%m/%d/%Y").date()
        out[d] = row(r["open"], r["high"], r["low"], r["close"], r["volume"])
    return out


def load_cboe(sym: str) -> dict[dt.date, dict]:
    j = json.loads((RAW / "cboe" / f"{sym}_{RETRIEVED}.json").read_text())
    out = {}
    for r in j["data"]:
        d = dt.date.fromisoformat(r["date"])
        v = Decimal(str(r["volume"]))
        out[d] = row(r["open"], r["high"], r["low"], r["close"], None if v == 0 else int(v))
    return out


def load_cnbc(sym: str) -> tuple[dict[dt.date, dict], list[dict]]:
    j = json.loads((RAW / "cnbc" / f"{sym}_{RETRIEVED}.json").read_text())
    out, placeholders = {}, []
    for r in j["barData"]["priceBars"]:
        d = dt.datetime.strptime(r["tradeTime"][:8], "%Y%m%d").date()
        if sym == "LYFT" and d < LYFT_FIRST_TRADE:
            placeholders.append({"date": d.isoformat(), **{k: r[k] for k in ("open", "high", "low", "close", "volume")}})
            continue
        out[d] = row(r["open"], r["high"], r["low"], r["close"], r["volume"] or None)
    return out, placeholders


def load_stockanalysis(sym: str) -> tuple[dict[dt.date, dict], dict[dt.date, Decimal]]:
    j = json.loads((RAW / "stockanalysis" / f"{sym}_{RETRIEVED}.json").read_text())
    out, divs = {}, {}
    for r in j["data"]:
        d = dt.date.fromisoformat(r["t"])
        out[d] = row(r["o"], r["h"], r["l"], r["c"], r["v"], r["a"])
        if "div" in r:
            divs[d] = dec(r["div"])
    return out, divs


def load_ssga_divs(ticker: str) -> list[dict]:
    """Minimal stdlib xlsx reader for SSGA's spdr-etf-historical-distributions.xlsx."""
    path = RAW / "ssga" / f"spdr-etf-historical-distributions_{RETRIEVED}.xlsx"
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for r in sheet.iter(f"{{{ns['m']}}}row"):
        vals = {}
        for c in r.findall("m:c", ns):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find("m:v", ns)
            is_ = c.find("m:is", ns)
            if c.get("t") == "s" and v is not None:
                vals[col] = shared[int(v.text)]
            elif c.get("t") == "inlineStr" and is_ is not None:
                vals[col] = "".join(t.text or "" for t in is_.iter(f"{{{ns['m']}}}t"))
            elif v is not None:
                vals[col] = v.text
        rows.append(vals)
    header = rows[0]
    cols = {header[k].strip(): k for k in header}
    out = []
    for r in rows[1:]:
        if r.get(cols["TICKER"], "").strip() != ticker:
            continue
        g = lambda name: (r.get(cols[name]) or "").strip()
        out.append({
            "ex_date": dt.datetime.strptime(g("EX-DATE"), "%m/%d/%Y").date(),
            "record_date": g("RECORD DATE"), "payable_date": g("PAYABLE DATE"),
            "dividend": Decimal(g("DIVIDEND ($)")),
            "st_cap_gain": dec(g("SHORT TERM CAPITAL GAIN ($)")),
            "lt_cap_gain": dec(g("LONG TERM CAPITAL GAIN ($)")),
        })
    return sorted(out, key=lambda x: x["ex_date"])


# ---------------------------------------------------------------- analysis helpers

def clip(series: dict, start: dt.date, end: dt.date = LAST_SESSION) -> dict:
    return {d: r for d, r in series.items() if start <= d <= end}


def compare(a: dict, b: dict, name_a: str, name_b: str) -> dict:
    """Compare two normalized series over b's coverage range (both clipped to the window)."""
    lo = max(min(a), min(b)); hi = min(max(a), max(b))
    A = {d: r for d, r in a.items() if lo <= d <= hi}
    B = {d: r for d, r in b.items() if lo <= d <= hi}
    common = sorted(set(A) & set(B))
    res = {
        "pair": f"{name_a} vs {name_b}", "range": [lo.isoformat(), hi.isoformat()],
        "rows_a": len(A), "rows_b": len(B), "common": len(common),
        "only_in_a": [d.isoformat() for d in sorted(set(A) - set(B))],
        "only_in_b": [d.isoformat() for d in sorted(set(B) - set(A))],
        "coverage_a": [min(a).isoformat(), max(a).isoformat()],
        "coverage_b": [min(b).isoformat(), max(b).isoformat()],
    }
    for f in ("open", "high", "low", "close"):
        diffs = [(d, A[d][f], B[d][f]) for d in common if A[d][f] is not None and B[d][f] is not None]
        big = [(d, x, y) for d, x, y in diffs if abs(x - y) > CENT]
        any_ = [(d, x, y) for d, x, y in diffs if x != y]
        res[f] = {
            "compared": len(diffs), "exact_equal": len(diffs) - len(any_),
            "diff_gt_0.01": len(big),
            "diff_le_0.01_nonzero": len(any_) - len(big),
            "max_abs_diff": num_str(max((abs(x - y) for _, x, y in diffs), default=Decimal(0))),
            "examples_gt_0.01": [[d.isoformat(), num_str(x), num_str(y)] for d, x, y in sorted(big, key=lambda t: -abs(t[1] - t[2]))[:10]],
        }
    vol = [(d, A[d]["volume"], B[d]["volume"]) for d in common if A[d]["volume"] and B[d]["volume"]]
    if vol:
        pct = [(y - x) / x * 100 for _, x, y in vol]
        res["volume"] = {
            "compared": len(vol), "exact_equal": sum(1 for _, x, y in vol if x == y),
            "b_gt_a": sum(1 for _, x, y in vol if y > x), "b_lt_a": sum(1 for _, x, y in vol if y < x),
            "median_pct_b_minus_a": round(statistics.median(pct), 4),
            "mean_pct_b_minus_a": round(statistics.fmean(pct), 4),
            "p05_pct": round(sorted(pct)[int(0.05 * len(pct))], 4),
            "p95_pct": round(sorted(pct)[int(0.95 * len(pct)) - 1], 4),
            "max_abs_pct": round(max(abs(p) for p in pct), 4),
            "examples_largest": [[d.isoformat(), x, y, round((y - x) / x * 100, 3)]
                                 for d, x, y in sorted(vol, key=lambda t: -abs((t[2] - t[1]) / t[1]))[:5]],
        }
    return res


def calendar_check(series: dict, start: dt.date, end: dt.date = LAST_SESSION) -> dict:
    s = clip(series, start, end)
    if not s:
        return {}
    lo, hi = min(s), max(s)
    exp = set(sessions(lo, hi))
    have = set(s)
    return {
        "coverage": [lo.isoformat(), hi.isoformat()], "rows": len(s), "expected_sessions": len(exp),
        "missing_sessions": [d.isoformat() for d in sorted(exp - have)],
        "rows_on_non_sessions": [d.isoformat() for d in sorted(have - exp)],
        "rows_on_holidays": [d.isoformat() for d in sorted(have & HOLIDAY_DATES)],
        "ends_before_last_session": hi < end,
    }


def total_return_adj(closes: dict[dt.date, Decimal], divs: dict[dt.date, Decimal],
                     convention: str = "hpr") -> dict[dt.date, Decimal]:
    """Multiplicative dividend adjustment (no splits in window). For each ex-date E with cash D,
    every close before E is multiplied by a factor:
      hpr:   close(E) / (close(E) + D)        -> adj(E)/adj(E-1) == (close(E)+D)/close(E-1) exactly,
             i.e. the CRSP holding-period total return (dividend reinvested at the ex-date close)
      yahoo: 1 - D / close(E-1)               -> Yahoo/"CRSP multiplier" convention
    """
    dates = sorted(closes)
    factor = Decimal(1)
    adj = {}
    for i in range(len(dates) - 1, -1, -1):
        d = dates[i]
        adj[d] = closes[d] * factor
        if d in divs and i > 0:
            if convention == "hpr":
                factor *= closes[d] / (closes[d] + divs[d])
            else:
                factor *= Decimal(1) - divs[d] / closes[dates[i - 1]]
    return adj


PRICE_FIELDS = ("open", "high", "low", "close")


def agree(x, y, field) -> bool:
    if x is None or y is None:
        return False
    if field == "volume":
        return abs(x - y) <= Decimal("0.05") * max(x, y)
    return abs(x - y) <= CENT


def merge(primary: dict, cnbc: dict, sa: dict, cboe: dict, expected: list[dt.date]):
    """Primary = Nasdaq. A field is overridden only when Nasdaq disagrees with CNBC and CNBC is
    corroborated by a third source (stockanalysis; or Cboe for high/low/close before 2021-10,
    since Cboe opens/volumes follow a different methodology). Everything else stays Nasdaq."""
    rows, overrides, unresolved = {}, [], []
    for d in expected:
        p = primary.get(d)
        if p is None:
            alt = cnbc.get(d) or cboe.get(d)
            rows[d] = (dict(alt), "cnbc" if d in cnbc else "cboe")
            overrides.append([d.isoformat(), "all", None, "missing in nasdaq"])
            continue
        r = dict(p)
        taken = []
        for f in PRICE_FIELDS + ("volume",):
            nv, cv = p[f], cnbc.get(d, {}).get(f)
            if cv is None or agree(nv, cv, f):
                continue
            third = sa.get(d, {}).get(f)
            if third is None and f in ("high", "low", "close"):
                third = cboe.get(d, {}).get(f)
            others = {k: (None if v is None else str(v)) for k, v in
                      (("cnbc", cv), ("stockanalysis", sa.get(d, {}).get(f)), ("cboe", cboe.get(d, {}).get(f)))}
            if third is not None and agree(cv, third, f):
                r[f] = cv
                taken.append(f)
                overrides.append([d.isoformat(), f, None if nv is None else str(nv), others])
            else:
                unresolved.append([d.isoformat(), f, None if nv is None else str(nv), others])
        if not taken:
            src = "nasdaq"
        elif len(taken) == 5:
            src = "cnbc"
        else:
            src = "nasdaq;" + ";".join(f"{f}=cnbc" for f in taken)
        rows[d] = (r, src)
    return rows, overrides, unresolved


def split_scan(series: dict) -> list:
    """Flag day-over-day close ratios near common split ratios (would indicate an unadjusted split)."""
    ds = sorted(series)
    flags = []
    for p, d in zip(ds, ds[1:]):
        r = series[d]["close"] / series[p]["close"]
        for name, k in (("2:1", Decimal("0.5")), ("3:1", Decimal(1) / 3), ("3:2", Decimal(2) / 3),
                        ("1:2", Decimal(2)), ("1:3", Decimal(3)), ("1:10", Decimal(10)), ("10:1", Decimal("0.1"))):
            if abs(r / k - 1) < Decimal("0.03"):
                flags.append([d.isoformat(), name, float(r)])
    return flags


def max_dod_moves(series: dict, n=5) -> list:
    ds = sorted(series)
    mv = [(d, series[d]["close"] / series[p]["close"] - 1) for p, d in zip(ds, ds[1:])]
    return [[d.isoformat(), round(float(m) * 100, 2)] for d, m in sorted(mv, key=lambda t: -abs(t[1]))[:n]]


# ---------------------------------------------------------------- main

def main() -> None:
    report: dict = {"retrieved": RETRIEVED, "window": [WINDOW_START.isoformat(), LAST_SESSION.isoformat()]}
    report["expected_sessions"] = {
        "SPY_2019-03-01_to_2026-10-02": len(sessions(WINDOW_START, LAST_SESSION)),
        "LYFT_2019-03-29_to_2026-10-02": len(sessions(LYFT_FIRST_TRADE, LAST_SESSION)),
    }

    data: dict[str, dict[str, dict]] = {}
    for sym, start in (("LYFT", LYFT_FIRST_TRADE), ("SPY", WINDOW_START)):
        cnbc, placeholders = load_cnbc(sym)
        sa, sa_divs = load_stockanalysis(sym)
        data[sym] = {
            "nasdaq": clip(load_nasdaq(sym), WINDOW_START),
            "cboe": clip(load_cboe(sym), WINDOW_START),
            "cnbc": clip(cnbc, WINDOW_START),
            "stockanalysis": clip(sa, WINDOW_START),
        }
        report.setdefault("cnbc_pre_ipo_placeholder_bars", {})[sym] = placeholders
        report.setdefault("stockanalysis_div_events", {})[sym] = {d.isoformat(): num_str(v) for d, v in sorted(sa_divs.items())}

    gspc = {"cboe": clip(load_cboe("GSPC"), WINDOW_START), "cnbc": clip(load_cnbc("GSPC")[0], WINDOW_START)}

    # 1. calendar + pairwise diffs
    for sym, start in (("LYFT", LYFT_FIRST_TRADE), ("SPY", WINDOW_START)):
        report.setdefault("calendar", {})[sym] = {src: calendar_check(s, start) for src, s in data[sym].items()}
        srcs = data[sym]
        pairs = [("nasdaq", "cboe"), ("nasdaq", "cnbc"), ("nasdaq", "stockanalysis"), ("cboe", "cnbc"), ("cboe", "stockanalysis"), ("cnbc", "stockanalysis")]
        report.setdefault("diffs", {})[sym] = [compare(srcs[a], srcs[b], a, b) for a, b in pairs]
    report["calendar"]["GSPC"] = {src: calendar_check(s, WINDOW_START) for src, s in gspc.items()}
    report["diffs"]["GSPC"] = [compare(gspc["cboe"], gspc["cnbc"], "cboe", "cnbc")]

    notable = ["2019-04-19", "2020-04-10", "2021-12-24", "2022-06-20", "2023-06-19", "2024-03-29",
               "2025-01-09", "2025-04-18", "2026-04-03", "2026-07-03"]
    tbl = {}
    for d in notable:
        dd = dt.date.fromisoformat(d)
        tbl[d] = {f"{sym}:{src}": (dd in s) for sym in data for src, s in data[sym].items()}
        tbl[d].update({f"GSPC:{src}": (dd in s) for src, s in gspc.items()})
    report["notable_closures_row_present"] = tbl

    # 2. corporate actions
    ssga = load_ssga_divs("SPY")
    ssga_win = [x for x in ssga if WINDOW_START <= x["ex_date"] <= LAST_SESSION]
    report["spy_dividends_ssga"] = [
        {"ex_date": x["ex_date"].isoformat(), "record_date": x["record_date"], "payable_date": x["payable_date"],
         "dividend": num_str(x["dividend"]),
         "st_cap_gain": None if x["st_cap_gain"] is None else num_str(x["st_cap_gain"]),
         "lt_cap_gain": None if x["lt_cap_gain"] is None else num_str(x["lt_cap_gain"])} for x in ssga_win]
    sa_divs = {dt.date.fromisoformat(k): Decimal(v) for k, v in report["stockanalysis_div_events"]["SPY"].items()}
    xs = []
    for x in ssga_win:
        if x["ex_date"] in sa_divs or x["ex_date"] >= min(data["SPY"]["stockanalysis"]):
            xs.append([x["ex_date"].isoformat(), num_str(x["dividend"]),
                       num_str(sa_divs[x["ex_date"]]) if x["ex_date"] in sa_divs else None,
                       x["ex_date"] in sa_divs and sa_divs[x["ex_date"]] == x["dividend"]])
    report["spy_dividend_crosscheck_ssga_vs_stockanalysis"] = {
        "rows": xs, "stockanalysis_only": [d.isoformat() for d in sa_divs if d not in {x["ex_date"] for x in ssga}]}
    ex_dates_not_sessions = [x["ex_date"].isoformat() for x in ssga_win if x["ex_date"] not in data["SPY"]["nasdaq"]]
    report["spy_ex_dates_not_in_nasdaq_sessions"] = ex_dates_not_sessions

    for sym in data:
        report.setdefault("degraded_rows", {})[sym] = {
            src: [[d.isoformat(), num_str(r["close"])] for d, r in sorted(s.items()) if degraded(r)]
            for src, s in data[sym].items()}
        report.setdefault("split_scan", {})[sym] = {src: split_scan(s) for src, s in data[sym].items()}
        report.setdefault("largest_daily_moves_nasdaq", {})[sym] = max_dod_moves(data[sym]["nasdaq"])
    report["lyft_stockanalysis_adj_ne_close_rows"] = sum(
        1 for r in data["LYFT"]["stockanalysis"].values() if r["adj_close"] != r["close"])

    # 5 (part 1). merged OHLCV: Nasdaq primary, corroborated overrides only
    merged = {}
    for sym, start in (("LYFT", LYFT_FIRST_TRADE), ("SPY", WINDOW_START)):
        exp = sessions(start, LAST_SESSION)
        rows, ov, unres = merge(data[sym]["nasdaq"], data[sym]["cnbc"], data[sym]["stockanalysis"],
                                data[sym]["cboe"], exp)
        merged[sym] = rows
        report.setdefault("merge_overrides", {})[sym] = ov
        report.setdefault("merge_unresolved_kept_nasdaq", {})[sym] = unres

    # 2 (cont). SPY total-return adjusted close recomputed from merged closes + SSGA dividends
    closes = {d: r["close"] for d, (r, _) in merged["SPY"].items()}
    divmap = {x["ex_date"]: x["dividend"] for x in ssga_win}
    adj = total_return_adj(closes, divmap, "hpr")
    adj_y = total_return_adj(closes, divmap, "yahoo")
    sa = data["SPY"]["stockanalysis"]
    sa_closes = {d: r["close"] for d, r in sa.items()}
    sa_divs_in = {d: v for d, v in divmap.items() if d in sa_closes}

    def dev_stats(calc: dict, label: str) -> dict:
        devs = [(d, calc[d], sa[d]["adj_close"]) for d in sorted(sa) if d in calc]
        absdev = [abs(a - b) for _, a, b in devs]
        worst = sorted(devs, key=lambda t: -abs(t[1] - t[2]))[:3]
        return {
            "label": label, "compared_rows": len(devs), "range": [devs[0][0].isoformat(), devs[-1][0].isoformat()],
            "max_abs_dev_usd": num_str(max(absdev).quantize(Decimal("0.000001"))),
            "max_rel_dev_bps": round(max(float(abs(a - b) / b) for _, a, b in devs) * 1e4, 4),
            "mean_abs_dev_usd": num_str((sum(absdev) / len(absdev)).quantize(Decimal("0.000001"))),
            "rows_dev_gt_0.0005": sum(1 for x in absdev if x > Decimal("0.0005")),
            "rows_dev_gt_0.01": sum(1 for x in absdev if x > CENT),
            "worst": [[d.isoformat(), num_str(a.quantize(Decimal("0.0001"))), num_str(b)] for d, a, b in worst],
        }

    report["spy_adj_close_check"] = {
        "provider_adj_close_source": "stockanalysis (only keyless provider of adjusted close reached; 5y window)",
        "hpr_on_merged_closes": dev_stats(adj, "factor close(E)/(close(E)+D) on merged closes"),
        "hpr_on_provider_closes": dev_stats(total_return_adj(sa_closes, sa_divs_in, "hpr"), "factor close(E)/(close(E)+D) on stockanalysis closes"),
        "yahoo_on_merged_closes": dev_stats(adj_y, "factor 1-D/close(E-1) on merged closes"),
        "yahoo_on_provider_closes": dev_stats(total_return_adj(sa_closes, sa_divs_in, "yahoo"), "factor 1-D/close(E-1) on stockanalysis closes"),
        "hpr_cumulative_factor_2019-03-01": float(adj[min(adj)] / closes[min(adj)]),
        "yahoo_cumulative_factor_2019-03-01": float(adj_y[min(adj_y)] / closes[min(adj_y)]),
        "hpr_vs_yahoo_max_abs_diff_usd_full_window": num_str(max(abs(adj[d] - adj_y[d]) for d in adj).quantize(Decimal("0.0001"))),
        "sum_dividends_in_window": num_str(sum(divmap.values())),
        "n_dividends_in_window": len(divmap),
    }
    # identity check: adj return on each ex-date equals (close+div)/prev_close
    ds = sorted(closes)
    ident = max(abs(adj[d] / adj[p] - (closes[d] + divmap.get(d, 0)) / closes[p]) for p, d in zip(ds, ds[1:]))
    report["spy_adj_close_check"]["hpr_identity_max_err"] = float(ident)

    # SPY total return vs S&P 500 price return (sanity)
    g = gspc["cboe"]
    d0, d1 = WINDOW_START, LAST_SESSION
    report["spy_vs_gspc_sanity"] = {
        "spy_price_return_pct": round(float(closes[d1] / closes[d0] - 1) * 100, 3),
        "spy_total_return_pct": round(float(adj[d1] / adj[d0] - 1) * 100, 3),
        "gspc_price_return_pct_cboe": round(float(g[d1]["close"] / g[d0]["close"] - 1) * 100, 3),
        "spy_to_gspc_close_ratio_start": round(float(closes[d0] / g[d0]["close"]), 6),
        "spy_to_gspc_close_ratio_end": round(float(closes[d1] / g[d1]["close"]), 6),
    }

    # sub-penny closes in Nasdaq
    for sym in data:
        sp = [d for d, r in data[sym]["nasdaq"].items() if r["close"] != r["close"].quantize(CENT)]
        report.setdefault("nasdaq_subpenny_closes", {})[sym] = [
            [d.isoformat(), num_str(data[sym]["nasdaq"][d]["close"])] +
            [num_str(data[sym][s][d]["close"]) if d in data[sym][s] else None for s in ("cboe", "cnbc", "stockanalysis")]
            for d in sorted(sp)]

    # 5 (part 2). write seeds
    SEED.mkdir(parents=True, exist_ok=True)
    for sym in ("LYFT", "SPY"):
        out_rows = []
        for d, (r, src) in sorted(merged[sym].items()):
            if sym == "SPY":
                a = adj[d].quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
                src += ";adj_close=calc_ssga_div"
            else:
                a = r["close"]  # no splits or dividends in LYFT's history
            a_str = format(a, "f") if sym == "SPY" else num_str(a)
            out_rows.append([d.isoformat(), num_str(r["open"]), num_str(r["high"]), num_str(r["low"]),
                             num_str(r["close"]), a_str, r["volume"], src])
        with (SEED / f"{sym}.csv").open("w", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["date", "open", "high", "low", "close", "adj_close", "volume", "source"])
            w.writerows(out_rows)
        srcs = {}
        for row_ in out_rows:
            srcs[row_[-1]] = srcs.get(row_[-1], 0) + 1
        report.setdefault("seed", {})[sym] = {
            "rows": len(out_rows), "first": out_rows[0][0], "last": out_rows[-1][0],
            "source_counts": srcs, "null_volume_rows": sum(1 for x in out_rows if x[6] is None),
        }

    out = RAW / f"verification_{RETRIEVED}.json"
    out.write_text(json.dumps(report, indent=1, default=str))
    print(f"wrote {out}")
    for sym in report["seed"]:
        print(sym, report["seed"][sym])


if __name__ == "__main__":
    main()
