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
# Public float from 10-K covers (instant, mid-year): the size check behind the plausibility screen.
FLOAT_CONCEPT = ("dei", "EntityPublicFloat", "USD")


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


def load_float_frames(conn: psycopg.Connection, edgar: Edgar, last_year: int | None = None) -> int:
    last_year = last_year or datetime.now(UTC).year - 1
    taxonomy, concept, unit = FLOAT_CONCEPT
    n = 0
    for year in range(FIRST_YEAR, last_year + 1):
        frame = f"CY{year}Q2I"
        try:
            raw = edgar.get(f"{DATA}/{taxonomy}/{concept}/{unit}/{frame}.json")
        except Exception as e:
            if "404" in str(e):
                continue
            raise
        rawstore.put(f"sec/_api/frames/{taxonomy}/{concept}/{unit}/{frame}.json", raw)
        rows = [(taxonomy, concept, unit, frame, int(d["cik"]), d["entityName"], d["accn"], None,
                 date.fromisoformat(d["end"]), d["val"]) for d in json.loads(raw)["data"]]
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO xbrl_frame_fact (taxonomy, concept, unit, frame, cik, entity_name, accession,
                     period_start, period_end, value)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (taxonomy, concept, unit, frame, cik) DO UPDATE SET value = EXCLUDED.value,
                     accession = EXCLUDED.accession, period_end = EXCLUDED.period_end, fetched_at = now()""", rows)
        conn.commit()
        n += len(rows)
    return n


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


PEO_CONCEPTS = ("PeoTotalCompAmt", "PeoActuallyPaidCompAmt")


def member_name(member: str) -> str | None:
    """'lyft:LoganGreenMember' -> 'Logan Green' (members usually spell the full name)."""
    local = member.split(":", 1)[-1]
    local = re.sub(r"Member$", "", local)
    words = re.findall(r"[A-Z][a-z]+|[A-Z]+(?![a-z])|\d+", local)
    if len(words) < 2 or any(w.lower() in {"peo", "ceo", "former", "current", "first", "second"} for w in words):
        return None
    return " ".join(words)


def _ixbrl_facts(raw: bytes) -> dict:
    """Pay-versus-performance facts in an inline-XBRL proxy:
      undim:  (concept, period_end) -> [values] for undimensioned ecd facts (a figure may repeat rounded)
      dims:   (concept, period_end, member) -> value for per-person CEO facts (ecd:IndividualAxis)
      names:  tagged CEO names in order; member_names: member -> tagged name"""
    root = etree.fromstring(raw, parser=etree.XMLParser(recover=True, huge_tree=True, resolve_entities=False,
                                                        no_network=True))
    contexts = {}
    for ctx in root.iterfind(".//xbrli:context", IX):
        end = ctx.findtext(".//xbrli:endDate", namespaces=IX) or ctx.findtext(".//xbrli:instant", namespaces=IX)
        members = [(m.get("dimension"), (m.text or "").strip()) for m in ctx.iterfind(".//xbrldi:explicitMember", IX)]
        typed = ctx.find(".//xbrldi:typedMember", IX) is not None
        contexts[ctx.get("id")] = (end, members, typed)
    undim, dims = {}, {}
    for el in root.iterfind(".//ix:nonFraction", IX):
        name = el.get("name", "")
        if not name.startswith("ecd:"):
            continue
        end, members, typed = contexts.get(el.get("contextRef"), (None, [], True))
        text = "".join(el.itertext()).replace(",", "").strip()
        if not end or not re.fullmatch(r"[\d.]+", text):
            continue
        v = Decimal(text) * (Decimal(10) ** int(el.get("scale") or 0))
        if el.get("sign") == "-":
            v = -v
        concept = name.split(":", 1)[1]
        if not members and not typed:
            undim.setdefault((concept, end), []).append(v)
        elif concept in PEO_CONCEPTS and len(members) == 1 and members[0][0] == "ecd:IndividualAxis":
            dims[(concept, end, members[0][1])] = v
    names, member_names = [], {}
    for el in root.iterfind(".//ix:nonNumeric", IX):
        if el.get("name") != "ecd:PeoName":
            continue
        n = re.sub(r"\s+", " ", "".join(el.itertext())).strip()
        _, members, _ = contexts.get(el.get("contextRef"), (None, [], False))
        for dim, m in members:
            if dim == "ecd:IndividualAxis" and n:
                member_names.setdefault(m, n)
        if n and n not in names:
            names.append(n)
    return {"undim": undim, "dims": dims, "names": names, "member_names": member_names}


def _proxy_doc(edgar: Edgar, cik: int, acc: str) -> tuple[str, bytes] | None:
    folder = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
    items = edgar.get_json(f"{folder}/index.json")["directory"]["item"]
    docs = sorted((i for i in items if i["name"].lower().endswith((".htm", ".html"))
                   and not i["name"].lower().startswith(("r", "fs"))),
                  key=lambda i: -int(i.get("size") or 0))
    for d in docs[:3]:
        key = rawstore.sec_key(cik, acc, d["name"])
        if not rawstore.exists(key):
            rawstore.put(key, edgar.get(f"{folder}/{d['name']}"))
        raw = rawstore.read(key)
        if b"ecd:" in raw:
            return f"{folder}/{d['name']}", raw
    return None


def _display_names(parsed: dict) -> list[str]:
    """Full names from members where they spell one; otherwise the tagged text."""
    out = []
    members = sorted({m for (_, _, m) in parsed["dims"]})
    for m in members:
        n = member_name(m) or parsed["member_names"].get(m)
        if n and n not in out:
            out.append(n)
    for n in parsed["names"]:
        if not any(n.split()[-1] in o for o in out) and n not in out:
            out.append(n)
    return out


def check_cases(conn: psycopg.Connection, edgar: Edgar, top: int = 60, gaps: bool = False) -> list[dict]:
    """Fetch the proxy behind each case, read its CEO names and per-person CEO facts, and confirm
    every undimensioned frame value we display for that filing is a fact in it. Cases: the top of
    each list, plus (gaps=True) every company with years missing CEO pay in the frames."""
    rows = conn.execute(
        """(SELECT cik, accession FROM pvp_screen WHERE tsr_value_of_100 < 100 AND peo_sct_sum IS NOT NULL
            ORDER BY peo_sct_sum DESC LIMIT %s)
           UNION
           (SELECT cik, accession FROM pvp_screen WHERE tsr_value_of_100 < 100 AND peo_cap_sum > 0
            ORDER BY peo_cap_sum DESC LIMIT %s)
           UNION
           (SELECT cik, accession FROM pvp_screen WHERE tsr_value_of_100 < 50 AND span_years >= 3
              AND peo_sct_sum IS NOT NULL ORDER BY tsr_value_of_100 LIMIT %s)
           UNION
           (SELECT cik, accession FROM pvp_screen WHERE %s AND peo_years < span_years
              AND cik NOT IN (SELECT cik FROM pvp_case WHERE accession = pvp_screen.accession))""",
        (top, top, top // 2, gaps)).fetchall()
    out = []
    for r in rows:
        cik, acc = r["cik"], r["accession"]
        try:
            doc = _proxy_doc(edgar, cik, acc)
        except Exception as e:  # one unreadable filing shouldn't stop the batch
            out.append({"cik": cik, "error": str(e)[:200]})
            continue
        if not doc:
            continue
        parsed = _ixbrl_facts(doc[1])
        conn.execute("DELETE FROM pvp_peo_fact WHERE cik = %s AND accession = %s", (cik, acc))
        for (concept, end, member), v in parsed["dims"].items():
            conn.execute(
                """INSERT INTO pvp_peo_fact (cik, accession, period_end, member, peo_name, concept, value)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (cik, acc, end, member, member_name(member) or parsed["member_names"].get(member), concept, v))
        frame_rows = conn.execute(
            """SELECT concept, period_end, value FROM xbrl_frame_fact
               WHERE cik = %s AND accession = %s AND concept = ANY(%s)""", (cik, acc, list(CHECKED))).fetchall()
        mismatches = []
        for fr in frame_rows:
            want = Decimal(str(fr["value"]))
            got = parsed["undim"].get((fr["concept"], fr["period_end"].isoformat()), [])
            # A zero frame with no undimensioned fact is a year tagged per person (two CEOs); the
            # per-person facts above cover it.
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
            (cik, acc, doc[0], _display_names(parsed), not mismatches and len(frame_rows) > 0, len(frame_rows),
             json.dumps(mismatches)))
        conn.commit()
        out.append({"cik": cik, "checked": len(frame_rows), "mismatches": len(mismatches),
                    "peo_facts": len(parsed["dims"])})
    return out
