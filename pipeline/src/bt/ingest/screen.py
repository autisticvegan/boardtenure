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
      names:  tagged CEO names in order; member_names: member -> tagged name
      year_names: period_end -> undimensioned CEO name tagged for that year"""
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
    names, member_names, year_names = [], {}, {}
    for el in root.iterfind(".//ix:nonNumeric", IX):
        if el.get("name") != "ecd:PeoName":
            continue
        n = re.sub(r"\s+", " ", "".join(el.itertext())).strip()
        end, members, _ = contexts.get(el.get("contextRef"), (None, [], False))
        for dim, m in members:
            if dim == "ecd:IndividualAxis" and n:
                member_names.setdefault(m, n)
        if n and not members and end:
            year_names.setdefault(end, n)
        if n and n not in names:
            names.append(n)
    return {"undim": undim, "dims": dims, "names": names, "member_names": member_names, "year_names": year_names}


def is_viewer_page(name: str) -> bool:
    """EDGAR's XBRL viewer pages (R1.htm, ...), not filing documents that happen to start with "r"."""
    return re.match(r"(?i)(r\d+|fs\d*)\.html?$", name) is not None


def _proxy_doc(edgar: Edgar, cik: int, acc: str) -> tuple[str, bytes] | None:
    folder = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
    items = edgar.get_json(f"{folder}/index.json")["directory"]["item"]
    docs = sorted((i for i in items if i["name"].lower().endswith((".htm", ".html"))
                   and not is_viewer_page(i["name"])),
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
        """(SELECT cik, accession FROM pvp_screen_ok WHERE notable AND NOT implausible AND tsr_value_of_100 < 100
              AND peo_sct_sum IS NOT NULL ORDER BY peo_sct_sum DESC LIMIT %s)
           UNION
           (SELECT cik, accession FROM pvp_screen_ok WHERE notable AND NOT implausible AND tsr_value_of_100 < 100
              AND peo_cap_sum > 0 ORDER BY peo_cap_sum DESC LIMIT %s)
           UNION
           (SELECT cik, accession FROM pvp_screen_ok WHERE notable AND NOT implausible AND tsr_value_of_100 < 50
              AND span_years >= 3 AND peo_sct_sum IS NOT NULL ORDER BY tsr_value_of_100 LIMIT %s)
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


def _precise(values: list[Decimal]) -> Decimal:
    """A figure tagged twice (exact and rounded): keep the one with the most significant digits."""
    return max(values, key=lambda v: len(str(abs(v)).replace(".", "").strip("0")))


def panel_rows(parsed: dict) -> tuple[list[dict], list[dict]]:
    """Per-year TSR and per-person CEO pay from one proxy's parsed facts.

    A year with per-person (IndividualAxis) facts gets one row per member. Otherwise the
    undimensioned figures belong to whoever is tagged as CEO for that year, or to the only
    name in the filing when nobody is tagged per person."""
    undim, dims = parsed["undim"], parsed["dims"]
    ends = sorted({e for (c, e) in undim if c == "TotalShareholderRtnAmt"})
    sole_names = set(parsed["year_names"].values()) | (set(parsed["names"]) if not parsed["member_names"] else set())
    sole = next(iter(sole_names)) if len(sole_names) == 1 and not dims else None
    years, peos = [], []
    for end in ends:
        members = sorted({m for (c, e, m) in dims if e == end and c in PEO_CONCEPTS})
        if members:
            for m in members:
                peos.append({"period_end": end, "peo_key": m, "name_basis": "member",
                             "peo_name": member_name(m) or parsed["member_names"].get(m),
                             "sct": dims.get(("PeoTotalCompAmt", end, m)),
                             "cap": dims.get(("PeoActuallyPaidCompAmt", end, m))})
        elif undim.get(("PeoTotalCompAmt", end)):
            name, basis = parsed["year_names"].get(end), "year"
            if name is None and sole:
                name, basis = sole, "sole"
            peos.append({"period_end": end, "peo_key": "", "peo_name": name, "name_basis": basis if name else None,
                         "sct": _precise(undim[("PeoTotalCompAmt", end)]),
                         "cap": _precise(undim[("PeoActuallyPaidCompAmt", end)])
                         if undim.get(("PeoActuallyPaidCompAmt", end)) else None})
        peer = undim.get(("PeerGroupTotalShareholderRtnAmt", end))
        years.append({"period_end": end, "tsr": _precise(undim[("TotalShareholderRtnAmt", end)]),
                      "peer_tsr": _precise(peer) if peer else None,
                      "peo_count": max(len(members), 1 if undim.get(("PeoTotalCompAmt", end)) else 0)})
    return years, peos


def load_panel(conn: psycopg.Connection, edgar: Edgar, limit: int | None = None,
               reverse: bool = False) -> dict[str, int]:
    """Read each screened company's latest pay-versus-performance proxy into the year-by-year panel.
    Two runs can share the work from opposite ends (reverse=True); each skips filings already read."""
    rows = conn.execute(
        f"""SELECT s.cik, s.accession FROM pvp_screen s
            LEFT JOIN pvp_panel_filing f ON f.cik = s.cik AND f.accession = s.accession
            WHERE f.cik IS NULL ORDER BY s.cik {"DESC" if reverse else ""} LIMIT %s""", (limit,)).fetchall()
    stats = {"filings": 0, "ok": 0, "no_ixbrl": 0, "error": 0, "peo_rows": 0}
    for r in rows:
        cik, acc = r["cik"], r["accession"]
        if conn.execute("SELECT 1 FROM pvp_panel_filing WHERE cik = %s AND accession = %s", (cik, acc)).fetchone():
            continue
        stats["filings"] += 1
        try:
            doc = _cached_doc(conn, cik, acc) or _proxy_doc(edgar, cik, acc)
        except Exception as e:  # one unreadable filing shouldn't stop the batch
            _panel_status(conn, cik, acc, None, "error", str(e)[:300])
            stats["error"] += 1
            continue
        if not doc:
            _panel_status(conn, cik, acc, None, "no_ixbrl", None)
            stats["no_ixbrl"] += 1
            continue
        years, peos = panel_rows(_ixbrl_facts(doc[1]))
        conn.execute("DELETE FROM pvp_panel_year WHERE cik = %s", (cik,))
        conn.execute("DELETE FROM pvp_panel_peo WHERE cik = %s", (cik,))
        for y in years:
            conn.execute(
                """INSERT INTO pvp_panel_year (cik, accession, period_end, tsr, peer_tsr, peo_count)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (cik, acc, y["period_end"], y["tsr"], y["peer_tsr"], y["peo_count"]))
        for p in peos:
            conn.execute(
                """INSERT INTO pvp_panel_peo (cik, accession, period_end, peo_key, peo_name, name_basis, sct, cap)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                (cik, acc, p["period_end"], p["peo_key"], p["peo_name"], p["name_basis"], p["sct"], p["cap"]))
        stats["peo_rows"] += len(peos)
        _panel_status(conn, cik, acc, doc[0], "ok", None)
        stats["ok"] += 1
    return stats


def _cached_doc(conn: psycopg.Connection, cik: int, acc: str) -> tuple[str, bytes] | None:
    """The proxy document a check or discovery already stored for this filing, without refetching."""
    row = conn.execute("SELECT doc_url FROM pvp_case WHERE cik = %s AND accession = %s", (cik, acc)).fetchone()
    if not row:
        return None
    key = rawstore.sec_key(cik, acc, row["doc_url"].rsplit("/", 1)[-1])
    return (row["doc_url"], rawstore.read(key)) if rawstore.exists(key) else None


def _panel_status(conn: psycopg.Connection, cik: int, acc: str, url: str | None, status: str,
                  detail: str | None) -> None:
    conn.execute(
        """INSERT INTO pvp_panel_filing (cik, accession, doc_url, status, detail) VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (cik) DO UPDATE SET accession = EXCLUDED.accession, doc_url = EXCLUDED.doc_url,
             status = EXCLUDED.status, detail = EXCLUDED.detail, parsed_at = now()""",
        (cik, acc, url, status, detail))
    conn.commit()


def frame_for(period_end: str) -> str:
    """The calendar frame a fiscal year belongs to: its end year, or the year before for years ending
    in January-March or the first days of April (mostly the previous calendar year), so each fiscal
    year gets its own frame."""
    from datetime import timedelta

    d = date.fromisoformat(period_end) - timedelta(days=10)  # 52/53-week years ending in early April
    return f"CY{d.year - 1 if d.month <= 3 else d.year}"


def discover(conn: psycopg.Connection, edgar: Edgar, limit: int | None = None, reverse: bool = False) -> dict[str, int]:
    """Well-known companies (public float of $500M+) with no pay-versus-performance facts in the frames:
    read their latest proxy since 2023 and store its tagged table as if the frames had carried it."""
    rows = conn.execute(
        f"""SELECT f.cik, max(f.entity_name) AS name FROM xbrl_frame_fact f
            WHERE f.concept = 'EntityPublicFloat'
              AND NOT EXISTS (SELECT 1 FROM xbrl_frame_fact e WHERE e.cik = f.cik AND e.taxonomy = 'ecd')
              AND NOT EXISTS (SELECT 1 FROM pvp_discovery d WHERE d.cik = f.cik)
            GROUP BY f.cik
            HAVING max(f.value) FILTER (WHERE f.value <= 50000000000000) >= 500000000
            ORDER BY f.cik {"DESC" if reverse else ""} LIMIT %s""", (limit,)).fetchall()
    stats = {"candidates": len(rows), "ok": 0, "no_proxy": 0, "no_pvp": 0, "error": 0}
    for r in rows:
        cik = r["cik"]
        if conn.execute("SELECT 1 FROM pvp_discovery WHERE cik = %s", (cik,)).fetchone():
            continue  # the other end's run got here first
        try:
            status, acc, detail = _discover_one(conn, edgar, cik, r["name"])
        except Exception as e:  # one unreadable filing shouldn't stop the batch
            conn.rollback()
            status, acc, detail = "error", None, str(e)[:300]
        conn.execute(
            """INSERT INTO pvp_discovery (cik, status, accession, detail) VALUES (%s, %s, %s, %s)
               ON CONFLICT (cik) DO UPDATE SET status = EXCLUDED.status, accession = EXCLUDED.accession,
                 detail = EXCLUDED.detail, checked_at = now()""", (cik, status, acc, detail))
        conn.commit()
        stats[status] += 1
    return stats


def _discover_one(conn: psycopg.Connection, edgar: Edgar, cik: int, name: str) -> tuple[str, str | None, str | None]:
    sub = edgar.get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
    recent = sub["filings"]["recent"]
    proxies = [(d, a) for f, d, a in zip(recent["form"], recent["filingDate"], recent["accessionNumber"], strict=True)
               if f == "DEF 14A" and d >= "2023-01-01"]
    if not proxies:
        return "no_proxy", None, None
    _, acc = max(proxies)
    doc = _proxy_doc(edgar, cik, acc)
    if not doc:
        return "no_pvp", acc, "no inline XBRL document"
    parsed = _ixbrl_facts(doc[1])
    undim = parsed["undim"]
    if not any(c == "TotalShareholderRtnAmt" for c, _ in undim):
        return "no_pvp", acc, "no tagged shareholder return"
    entity = sub.get("name") or name
    facts = 0
    for (concept, end), values in undim.items():
        if concept not in {c for _, c, _ in PVP_CONCEPTS}:
            continue
        conn.execute(
            """INSERT INTO xbrl_frame_fact (taxonomy, concept, unit, frame, cik, entity_name, accession, period_start,
                 period_end, value, source)
               VALUES ('ecd', %s, 'USD', %s, %s, %s, %s, NULL, %s, %s, 'proxy')
               ON CONFLICT (taxonomy, concept, unit, frame, cik) DO NOTHING""",
            (concept, frame_for(end), cik, entity, acc, end, _precise(values)))
        facts += 1
    conn.execute("DELETE FROM pvp_peo_fact WHERE cik = %s AND accession = %s", (cik, acc))
    for (concept, end, member), v in parsed["dims"].items():
        conn.execute(
            """INSERT INTO pvp_peo_fact (cik, accession, period_end, member, peo_name, concept, value)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (cik, acc, end, member, member_name(member) or parsed["member_names"].get(member), concept, v))
    # The figures are the filing's own tags, so they need no separate check against the filing.
    conn.execute(
        """INSERT INTO pvp_case (cik, accession, doc_url, peo_names, verified, checked_facts, mismatches)
           VALUES (%s, %s, %s, %s, true, %s, '[]')
           ON CONFLICT (cik) DO UPDATE SET accession = EXCLUDED.accession, doc_url = EXCLUDED.doc_url,
             peo_names = EXCLUDED.peo_names, verified = true, checked_facts = EXCLUDED.checked_facts,
             mismatches = '[]', checked_at = now()""",
        (cik, acc, doc[0], _display_names(parsed), facts))
    return "ok", acc, None
