"""Shares outstanding from the cover page of the latest 10-K/10-Q (inline XBRL).

Each share class is tagged dei:EntityCommonStockSharesOutstanding with its own context;
we sum all classes as of the cover date. Market cap shown on the site is this total times
the primary listing's close, which is an approximation for multi-class companies whose
classes trade at different prices (stated in the UI).
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import psycopg
from lxml import etree

from bt import rawstore
from bt.ingest import reference
from bt.sources.sec import Edgar

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
    obj = edgar.document(filing)
    as_of, classes = parse_cover_shares(rawstore.read(obj.key))
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
