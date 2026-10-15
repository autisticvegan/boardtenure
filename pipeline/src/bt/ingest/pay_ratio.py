"""CEO pay ratios (Item 402(u)) read from each screened company's latest proxy in the raw store.

The rule asks companies for the ratio of the CEO's annual total compensation to the median
employee's, and most print both amounts beside it. A ratio is kept as verified only when two
amounts in the same passage reproduce it (CEO / median within rounding); others are stored
unverified and not shown.
"""

from __future__ import annotations

import re
from concurrent.futures import ProcessPoolExecutor

import psycopg

from bt import rawstore
from bt.text import document_text

ANCHOR = re.compile(r"pay ratio|ratio of|median employee|median of the annual total compensation", re.I)
RATIO = re.compile(r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:to|:)\s*1(?![\d]|[,.]\d)|"
                   r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*times\s+(?:that|the|our|its)", re.I)
AMOUNT = re.compile(r"\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?)(?!\d|,\d)")


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def matches(ratio: float, ceo: float, median: float) -> bool:
    if median <= 0 or ceo <= median:
        return False
    got = ceo / median
    return abs(got - ratio) <= max(0.6, ratio * 0.015)


def find_ratio(text: str) -> dict | None:
    """The best pay-ratio passage in a document: verified if possible, else the first plausible one."""
    first = None
    for a in ANCHOR.finditer(text):
        lo, hi = max(0, a.start() - 700), min(len(text), a.end() + 700)
        win = text[lo:hi]
        if "median" not in win.lower():
            continue
        amounts = [_num(m.group(1)) for m in AMOUNT.finditer(win)]
        amounts = [x for x in amounts if 1_000 <= x <= 5e9]
        for m in RATIO.finditer(win):
            ratio = _num(m.group(1) or m.group(2))
            if not 1 <= ratio <= 100_000:
                continue
            start, end = max(0, m.start() - 420), min(len(win), m.end() + 120)
            quote = re.sub(r"\s+", " ", win[start:end]).strip()
            for ceo in sorted(set(amounts), reverse=True):
                for med in sorted(set(amounts)):
                    if matches(ratio, ceo, med):
                        return {"ratio": ratio, "ceo_pay": ceo, "median_pay": med, "verified": True, "quote": quote}
            if first is None:
                first = {"ratio": ratio, "ceo_pay": None, "median_pay": None, "verified": False, "quote": quote}
    return first


def passage_year(quote: str) -> int | None:
    """The year a pay-ratio passage describes: the most-mentioned year in it."""
    years = [int(y) for y in re.findall(r"(?<!\d)(20[12]\d)(?!\d)", quote)]
    return max(set(years), key=lambda y: (years.count(y), y)) if years else None


def _one(args: tuple[int, str, str]) -> tuple[int, dict | None]:
    cik, acc, url = args
    name = url.rsplit("/", 1)[-1]
    key = rawstore.sec_key(cik, acc, name)
    if not rawstore.exists(key):
        return cik, None
    return cik, find_ratio(document_text(rawstore.read(key), name))


def extract(conn: psycopg.Connection, workers: int = 6) -> dict[str, int]:
    rows = conn.execute(
        """SELECT f.cik, f.accession, f.doc_url, (SELECT max(period_end) FROM pvp_panel_year y
             WHERE y.cik = f.cik AND y.accession = f.accession) AS fy_end
           FROM pvp_panel_filing f WHERE f.status = 'ok'""").fetchall()
    fy = {r["cik"]: r["fy_end"].year if r["fy_end"] else None for r in rows}
    meta = {r["cik"]: (r["accession"], r["doc_url"]) for r in rows}
    stats = {"filings": len(rows), "verified": 0, "unverified": 0, "none": 0}
    conn.execute("DELETE FROM pay_ratio")
    with ProcessPoolExecutor(workers) as pool:
        for cik, found in pool.map(_one, [(r["cik"], r["accession"], r["doc_url"]) for r in rows], chunksize=8):
            if not found:
                stats["none"] += 1
                continue
            acc, url = meta[cik]
            year = passage_year(found["quote"])
            if fy[cik] and (year is None or abs(year - fy[cik]) > 1):  # a stray "2027 annual meeting"
                year = fy[cik]
            conn.execute(
                """INSERT INTO pay_ratio (cik, accession, doc_url, fiscal_year, ratio, ceo_pay, median_pay,
                     verified, quote) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (cik, acc, url, year, found["ratio"], found["ceo_pay"], found["median_pay"], found["verified"],
                 found["quote"]))
            stats["verified" if found["verified"] else "unverified"] += 1
    return stats
