"""Market-wide pay-versus-performance screen from SEC XBRL frames.

One frames request returns a concept's value for every filer in a period (the latest filing's
value, undimensioned facts only), so a few dozen requests cover CEO reported pay, "compensation
actually paid" and cumulative TSR for every company that files Item 402(v) tables. Raw responses
are kept in the raw store; the screen only nominates cases, which are verified against the filing
before the site states them.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime
from decimal import Decimal

import psycopg
from lxml import etree

from bt import rawstore
from bt.sources.sec import Edgar

DATA = "https://data.sec.gov/api/xbrl/frames"
PVP_CONCEPTS = [
    ("ecd", "PeoTotalCompAmt", "USD"),
    ("ecd", "PeoActuallyPaidCompAmt", "USD"),
    ("ecd", "TotalShareholderRtnAmt", "USD"),
    ("ecd", "PeerGroupTotalShareholderRtnAmt", "USD"),
    ("ecd", "NonPeoNeoAvgTotalCompAmt", "USD"),
    ("ecd", "NonPeoNeoAvgCompActuallyPaidAmt", "USD"),
]
FIRST_YEAR = 2020  # Item 402(v) tables reach back to fiscal 2020


def _units_for(raw: dict, unit: str) -> str:
    return raw.get("uom") or unit


def load_frames(conn: psycopg.Connection, edgar: Edgar, last_year: int | None = None) -> dict[str, int]:
    last_year = last_year or datetime.now(UTC).year - 1
    stats: dict[str, int] = {}
    for taxonomy, concept, unit in PVP_CONCEPTS:
        for year in range(FIRST_YEAR, last_year + 1):
            frame = f"CY{year}"
            url = f"{DATA}/{taxonomy}/{concept}/{unit}/{frame}.json"
            try:
                raw = edgar.get(url)
            except Exception as e:  # a frame with no facts yet is a 404
                if "404" in str(e):
                    continue
                raise
            rawstore.put(f"sec/_api/frames/{taxonomy}/{concept}/{unit}/{frame}.json", raw)
            data = json.loads(raw)
            rows = [(taxonomy, concept, _units_for(data, unit), frame, int(d["cik"]), d["entityName"], d["accn"],
                     date.fromisoformat(d["start"]) if d.get("start") else None, date.fromisoformat(d["end"]),
                     d["val"]) for d in data["data"]]
            with conn.cursor() as cur:
                cur.executemany(
                    """INSERT INTO xbrl_frame_fact (taxonomy, concept, unit, frame, cik, entity_name, accession,
                         period_start, period_end, value)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (taxonomy, concept, unit, frame, cik) DO UPDATE SET
                         entity_name = EXCLUDED.entity_name, accession = EXCLUDED.accession,
                         period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
                         value = EXCLUDED.value, fetched_at = now()""", rows)
            stats[f"{concept}/{frame}"] = len(rows)
            conn.commit()
    return stats


def load_tickers(conn: psycopg.Connection, edgar: Edgar) -> int:
    raw = edgar.get("https://www.sec.gov/files/company_tickers.json")
    rawstore.put("sec/_api/company_tickers.json", raw)
    rows = [(int(v["cik_str"]), v["ticker"], v["title"]) for v in json.loads(raw).values()]
    conn.execute("DELETE FROM sec_ticker")
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO sec_ticker (cik, ticker, title) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING", rows)
    conn.commit()
    return len(rows)


IX = {"ix": "http://www.xbrl.org/2013/inlineXBRL", "xbrli": "http://www.xbrl.org/2003/instance",
      "xbrldi": "http://xbrl.org/2006/xbrldi"}
CHECKED = ("PeoTotalCompAmt", "PeoActuallyPaidCompAmt", "TotalShareholderRtnAmt")


def _ixbrl_facts(raw: bytes) -> tuple[dict, list[str]]:
    """(concept, period_end) -> values for undimensioned ecd facts (a table may repeat a figure
    rounded), plus the tagged CEO names."""
    root = etree.fromstring(raw, parser=etree.XMLParser(recover=True, huge_tree=True, resolve_entities=False,
                                                        no_network=True))
    contexts = {}
    for ctx in root.iterfind(".//xbrli:context", IX):
        end = ctx.findtext(".//xbrli:endDate", namespaces=IX) or ctx.findtext(".//xbrli:instant", namespaces=IX)
        dims = ctx.find(".//xbrldi:explicitMember", IX) is not None or ctx.find(".//xbrldi:typedMember", IX) is not None
        contexts[ctx.get("id")] = (end, dims)
    facts = {}
    for el in root.iterfind(".//ix:nonFraction", IX):
        name = el.get("name", "")
        if not name.startswith("ecd:"):
            continue
        end, dims = contexts.get(el.get("contextRef"), (None, True))
        if dims or not end:
            continue
        text = "".join(el.itertext()).replace(",", "").strip()
        if not re.fullmatch(r"[\d.]+", text):
            continue
        v = Decimal(text) * (Decimal(10) ** int(el.get("scale") or 0))
        if el.get("sign") == "-":
            v = -v
        facts.setdefault((name.split(":", 1)[1], end), []).append(v)
    names = []
    for el in root.iterfind(".//ix:nonNumeric", IX):
        if el.get("name") == "ecd:PeoName":
            n = re.sub(r"\s+", " ", "".join(el.itertext())).strip()
            if n and n not in names:
                names.append(n)
    return facts, names


def check_cases(conn: psycopg.Connection, edgar: Edgar, top: int = 60) -> list[dict]:
    """Fetch the proxy behind each top screened case, read its tagged CEO names and confirm every
    frame value we display for that filing is a fact in it."""
    rows = conn.execute(
        """(SELECT cik, accession FROM pvp_screen WHERE tsr_value_of_100 < 100 AND peo_sct_sum IS NOT NULL
            ORDER BY peo_sct_sum DESC LIMIT %s)
           UNION
           (SELECT cik, accession FROM pvp_screen WHERE tsr_value_of_100 < 100 AND peo_cap_sum > 0
            ORDER BY peo_cap_sum DESC LIMIT %s)
           UNION
           (SELECT cik, accession FROM pvp_screen WHERE tsr_value_of_100 < 50 AND span_years >= 3
              AND peo_sct_sum IS NOT NULL ORDER BY tsr_value_of_100 LIMIT %s)""", (top, top, top // 2)).fetchall()
    out = []
    for r in rows:
        acc = r["accession"]
        folder = f"https://www.sec.gov/Archives/edgar/data/{r['cik']}/{acc.replace('-', '')}"
        items = edgar.get_json(f"{folder}/index.json")["directory"]["item"]
        docs = sorted((i for i in items if i["name"].lower().endswith((".htm", ".html"))
                       and not i["name"].lower().startswith(("r", "fs"))),
                      key=lambda i: -int(i.get("size") or 0))
        found = None
        for d in docs[:3]:
            key = rawstore.sec_key(r["cik"], acc, d["name"])
            if not rawstore.exists(key):
                rawstore.put(key, edgar.get(f"{folder}/{d['name']}"))
            raw = rawstore.read(key)
            if b"ecd:" in raw:
                found = (d["name"], raw)
                break
        if not found:
            continue
        facts, names = _ixbrl_facts(found[1])
        frame_rows = conn.execute(
            """SELECT concept, period_end, value FROM xbrl_frame_fact
               WHERE cik = %s AND accession = %s AND concept = ANY(%s)""", (r["cik"], acc, list(CHECKED))).fetchall()
        mismatches = []
        for fr in frame_rows:
            want = Decimal(str(fr["value"]))
            got = facts.get((fr["concept"], fr["period_end"].isoformat()), [])
            # A zero frame with no undimensioned fact is a year tagged per person (two CEOs): it only
            # leaves that year out of the sums, which understates pay, so it doesn't fail the check.
            if want == 0 and not got:
                continue
            if not any(abs(want - g) <= max(Decimal("0.5"), abs(g) * Decimal("0.005")) for g in got):
                mismatches.append({"concept": fr["concept"], "period_end": fr["period_end"].isoformat(),
                                   "frame": float(want), "filing": [float(g) for g in got]})
        conn.execute(
            """INSERT INTO pvp_case (cik, accession, doc_url, peo_names, verified, checked_facts, mismatches)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (cik) DO UPDATE SET accession = EXCLUDED.accession, doc_url = EXCLUDED.doc_url,
                 peo_names = EXCLUDED.peo_names, verified = EXCLUDED.verified,
                 checked_facts = EXCLUDED.checked_facts, mismatches = EXCLUDED.mismatches, checked_at = now()""",
            (r["cik"], acc, f"{folder}/{found[0]}", names, not mismatches and len(frame_rows) > 0, len(frame_rows),
             json.dumps(mismatches)))
        conn.commit()
        out.append({"cik": r["cik"], "names": names, "checked": len(frame_rows), "mismatches": len(mismatches)})
    return out
