"""Shares outstanding from the cover page of the latest 10-K/10-Q (inline XBRL).

Each share class is tagged dei:EntityCommonStockSharesOutstanding with its own context;
we sum all classes as of the cover date. Market cap shown on the site is this total times
the primary listing's close, which is an approximation for multi-class companies whose
classes trade at different prices (stated in the UI).
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from decimal import Decimal

import psycopg
from lxml import etree

from bt import rawstore
from bt.ingest import reference
from bt.sources.sec import Edgar
from bt.text import document_text

CONCEPT = "dei:EntityCommonStockSharesOutstanding"


def parse_cover_shares(raw: bytes) -> tuple[date | None, list[dict]]:
    root = etree.fromstring(raw, parser=etree.XMLParser(recover=True, huge_tree=True, resolve_entities=False,
                                                        no_network=True))
    ns = {"ix": "http://www.xbrl.org/2013/inlineXBRL", "xbrli": "http://www.xbrl.org/2003/instance",
          "xbrldi": "http://xbrl.org/2006/xbrldi"}
    contexts = {}
    for ctx in root.iterfind(".//xbrli:context", ns):
        instant = ctx.findtext(".//xbrli:instant", namespaces=ns)
        member = ctx.find(".//xbrldi:explicitMember", ns)
        contexts[ctx.get("id")] = (instant, member.text.strip() if member is not None and member.text else None)
    out, as_of = [], None
    for el in root.iterfind(".//ix:nonFraction", ns):
        if el.get("name") != CONCEPT:
            continue
        text = "".join(el.itertext()).replace(",", "").strip()
        if not text:
            continue
        value = Decimal(text) * (Decimal(10) ** int(el.get("scale") or 0))
        instant, member = contexts.get(el.get("contextRef"), (None, None))
        if instant:
            as_of = max(as_of or date.fromisoformat(instant), date.fromisoformat(instant))
        out.append({"class": member or "common", "shares": int(value), "instant": instant})
    # Keep one value per class at the latest instant.
    latest = {}
    for row in out:
        if row["instant"] == (as_of.isoformat() if as_of else None):
            latest[row["class"]] = row
    return as_of, list(latest.values())


def update_company(conn: psycopg.Connection, edgar: Edgar, company_id: int, cik: str) -> dict | None:
    filing = next((f for f in edgar.filings(cik, include_history=False) if f.form in ("10-Q", "10-K")), None)
    if filing is None:
        return None
    return _record_cover(conn, edgar, company_id, filing)


def load_history(conn: psycopg.Connection, edgar: Edgar, company_id: int, cik: str) -> list[dict]:
    """Cover-page share counts from every 10-K/10-Q, so market value can be measured at any
    tenure start (executive pay windows), not just today."""
    out = []
    for f in edgar.filings(cik, include_history=True):
        if f.form in ("10-Q", "10-K") and f.primary_document.endswith((".htm", ".html")):
            row = _record_cover(conn, edgar, company_id, f)
            if row:
                out.append(row)
    return out


_COVER_DATE = re.compile(r"As of ([A-Z][a-z]+ \d{1,2}, \d{4}),?(.{0,400})")
_COVER_CLASS = re.compile(r"(Class [A-Z]) common stock outstanding (?:was|were) ([\d,]+)")


def parse_cover_text(raw: bytes, filename: str) -> tuple[date | None, list[dict]]:
    """Fallback for covers filed before inline XBRL: "As of April 30, 2019, the number of shares
    of the registrant's Class A common stock outstanding was 277,828,438 and ... Class B ..."."""
    head = " ".join(document_text(raw, filename).splitlines()[:120])
    for m in _COVER_DATE.finditer(head):
        classes = [{"class": c, "shares": int(n.replace(",", ""))} for c, n in _COVER_CLASS.findall(m.group(2))]
        if classes:
            as_of = datetime.strptime(m.group(1), "%B %d, %Y").date()
            return as_of, [{**c, "instant": as_of.isoformat()} for c in classes]
    return None, []


def load_companyfacts(conn: psycopg.Connection, edgar: Edgar, company_id: int, cik: str) -> int:
    """Older cover counts from XBRL company facts (dei:EntityCommonStockSharesOutstanding, tagged
    since about 2009), only for dates before the first parsed cover. Company facts drop class
    dimensions, so multi-class issuers are skipped: their undimensioned value can be one class."""
    first = conn.execute("SELECT min(as_of_date) AS d, max(jsonb_array_length(class_breakdown)) AS classes "
                         "FROM shares_outstanding WHERE company_id = %s", (company_id,)).fetchone()
    if first["classes"] and first["classes"] > 1:
        return 0
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json"
    raw = edgar.get(url)
    obj = rawstore.put(f"sec/_api/companyfacts/CIK{int(cik):010d}.json", raw)
    facts = json.loads(raw).get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding", {})
    src = reference.source_ids(conn)["sec_edgar"]
    doc_id = conn.execute(
        """INSERT INTO source_document (source_id, external_id, doc_type, company_id, url, retrieved_at, sha256,
                                        storage_uri, byte_size, content_type)
           VALUES (%s, %s, 'XBRL companyfacts', %s, %s, now(), %s, %s, %s, 'application/json')
           ON CONFLICT (source_id, external_id) DO UPDATE SET sha256 = EXCLUDED.sha256, retrieved_at = now()
           RETURNING id""",
        (src, f"companyfacts/CIK{int(cik):010d}", company_id, url, obj.sha256, obj.uri, obj.size),
    ).fetchone()["id"]
    n = 0
    for f in facts.get("units", {}).get("shares", []):
        as_of = date.fromisoformat(f["end"])
        if f.get("form") not in ("10-K", "10-Q") or (first["d"] and as_of >= first["d"]):
            continue
        n += conn.execute(
            """INSERT INTO shares_outstanding (company_id, as_of_date, shares, class_breakdown, source_document_id)
               VALUES (%s, %s, %s, %s, %s) ON CONFLICT (company_id, as_of_date) DO NOTHING""",
            (company_id, as_of, int(f["val"]),
             json.dumps([{"class": "common", "shares": int(f["val"]), "instant": f["end"], "accession": f["accn"]}]),
             doc_id),
        ).rowcount
    return n


def _record_cover(conn: psycopg.Connection, edgar: Edgar, company_id: int, filing) -> dict | None:
    obj = edgar.document(filing)
    as_of, classes = parse_cover_shares(rawstore.read(obj.key))
    if not as_of or not classes:
        as_of, classes = parse_cover_text(rawstore.read(obj.key), filing.primary_document)
    if not as_of or not classes:
        return None
    src = reference.source_ids(conn)["sec_edgar"]
    doc_id = conn.execute(
        """INSERT INTO source_document (source_id, external_id, doc_type, company_id, url, published_at, retrieved_at,
                                        sha256, storage_uri, byte_size)
           VALUES (%s, %s, %s, %s, %s, %s, now(), %s, %s, %s)
           ON CONFLICT (source_id, external_id) DO UPDATE SET sha256 = EXCLUDED.sha256 RETURNING id""",
        (src, f"{filing.accession}/{filing.primary_document}", filing.form, company_id, filing.document_url(),
         filing.filing_date, obj.sha256, obj.uri, obj.size),
    ).fetchone()["id"]
    total = sum(c["shares"] for c in classes)
    conn.execute(
        """INSERT INTO shares_outstanding (company_id, as_of_date, shares, class_breakdown, source_document_id)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (company_id, as_of_date) DO UPDATE SET shares = EXCLUDED.shares,
             class_breakdown = EXCLUDED.class_breakdown, source_document_id = EXCLUDED.source_document_id""",
        (company_id, as_of, total, json.dumps(classes), doc_id),
    )
    return {"as_of": as_of.isoformat(), "shares": total, "classes": len(classes), "form": filing.form}
