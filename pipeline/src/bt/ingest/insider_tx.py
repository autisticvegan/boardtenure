"""Forms 4/5 transactions by tracked executives, for what they sold while shareholders held on.

Only the non-derivative table is read (shares of the issuer's stock). Each executive's filings come
from their own EDGAR filer history (the reporting-owner CIK), filtered to the tracked issuer.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

import psycopg
from lxml import etree

from bt import rawstore
from bt.ingest.form345 import raw_xml_filename
from bt.sources.sec import Edgar

FORMS = {"4", "4/A", "5", "5/A"}


def _num(el, path: str) -> Decimal | None:
    v = el.findtext(path) if el is not None else None
    try:
        return Decimal(v.strip()) if v and v.strip() else None
    except InvalidOperation:
        return None


def parse_transactions(xml: bytes) -> tuple[int, str, list[dict]]:
    root = etree.fromstring(xml, parser=etree.XMLParser(resolve_entities=False, no_network=True))
    issuer = int(root.findtext("issuer/issuerCik") or 0)
    form = (root.findtext("documentType") or "?").strip()
    plan = (root.findtext("aff10b5One") or "").strip().lower() in ("1", "true")
    notes = " ".join(f.text or "" for f in root.iterfind("footnotes/footnote")).lower()
    plan = plan or "10b5-1" in notes
    out = []
    for i, t in enumerate(root.iterfind("nonDerivativeTable/nonDerivativeTransaction"), start=1):
        d = t.findtext("transactionDate/value")
        shares = _num(t, "transactionAmounts/transactionShares/value")
        if not d or shares is None:
            continue
        out.append({
            "line": i,
            "date": date.fromisoformat(d.strip()[:10]),
            "code": (t.findtext("transactionCoding/transactionCode") or "").strip(),
            "ad": (t.findtext("transactionAmounts/transactionAcquiredDisposedCode/value") or "").strip() or None,
            "shares": shares,
            "price": _num(t, "transactionAmounts/transactionPricePerShare/value"),
            "after": _num(t, "postTransactionAmounts/sharesOwnedFollowingTransaction/value"),
            "di": (t.findtext("ownershipNature/directOrIndirectOwnership/value") or "").strip() or None,
            "title": (t.findtext("securityTitle/value") or "").strip() or None,
        })
    return issuer, form, [{**r, "plan": plan} for r in out]


def load_owner(conn: psycopg.Connection, edgar: Edgar, person_id: int, owner_cik: str, company_id: int,
               issuer_cik: str, since: date) -> int:
    n = 0
    seen = {r["accession"] for r in conn.execute(
        "SELECT DISTINCT accession FROM insider_transaction WHERE owner_cik = %s", (int(owner_cik),))}
    for f in edgar.filings(owner_cik, include_history=True):
        if f.form not in FORMS or f.filing_date < since or f.accession in seen:
            continue
        name = raw_xml_filename(f.primary_document)
        if not name.endswith(".xml"):
            continue
        key = rawstore.sec_key(issuer_cik, f.accession, name)
        try:
            raw = rawstore.read(key) if rawstore.exists(key) else edgar.get(f.document_url(name))
        except Exception:  # an owner's filing for another issuer may live under that issuer's folder
            continue
        try:
            issuer, form, rows = parse_transactions(raw)
        except (etree.XMLSyntaxError, ValueError):
            continue
        if issuer != int(issuer_cik):
            continue
        if not rawstore.exists(key):
            rawstore.put(key, raw)
        for r in rows:
            conn.execute(
                """INSERT INTO insider_transaction (accession, line, form, issuer_cik, owner_cik, person_id, company_id,
                     transaction_date, code, acquired_disposed, shares, price, shares_after, direct_indirect,
                     security_title, under_10b5_1)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (accession, line) DO NOTHING""",
                (f.accession, r["line"], form, issuer, int(owner_cik), person_id, company_id, r["date"], r["code"],
                 r["ad"], r["shares"], r["price"], r["after"], r["di"], r["title"], r["plan"]))
            n += 1
        conn.commit()
    return n
