"""Discover new EDGAR filings for tracked companies and turn board-relevant ones into
review items or corroborations.

  Forms 3/4/5   deterministic XML parse. A director relationship from an owner with no
                current seat becomes a needs_review insider fact, the strongest automatic
                signal of a new director.
  8-K 5.02      appointment/departure text; queued for review (and AI-assisted extraction
                when enabled, with every quote machine-verified).
  8-K 5.07      annual-meeting results; dates the end of seats for directors who did not stand.
  DEF 14A       a new proxy; the roster should be re-verified.

Filings on or before a company's last full review are recorded as already processed, so
adding a company never floods the review queue with history.
"""

from __future__ import annotations

import json
from datetime import date

import psycopg

from bt import rawstore
from bt.ingest import form345, reference
from bt.sources.sec import Edgar, EdgarError, Filing

INSIDER_FORMS = {"3", "3/A", "4", "4/A", "5", "5/A"}
PROXY_FORMS = {"DEF 14A", "DEFC14A", "DEFR14A"}
PROCESSOR = "sec_sync@1"


def classify(f: Filing) -> str:
    if f.form in INSIDER_FORMS:
        return "pending"
    if f.form in ("8-K", "8-K/A") and ("5.02" in f.items or "5.07" in f.items):
        return "pending"
    if f.form in PROXY_FORMS:
        return "pending"
    return "skipped"


def _baseline(conn: psycopg.Connection, company_id: int) -> date | None:
    cur = conn.execute("SELECT value FROM ingest_cursor WHERE name = %s", (f"sec:{company_id}",)).fetchone()
    if cur:
        return date.fromisoformat(cur["value"]["reviewed_through"])
    row = conn.execute(
        """SELECT max((assessed_at AT TIME ZONE 'UTC')::date) AS d FROM coverage_period
           WHERE company_id = %s AND scope = 'current_board' AND level = 'complete'""",
        (company_id,),
    ).fetchone()
    return row["d"] if row else None


def _document(conn: psycopg.Connection, edgar: Edgar, f: Filing, company_id: int, source_id: int,
              filename: str) -> tuple[int, rawstore.StoredObject]:
    obj = edgar.document(f, filename)
    doc_id = conn.execute(
        """INSERT INTO source_document (source_id, external_id, doc_type, company_id, url, published_at, period_date,
                                        retrieved_at, sha256, storage_uri, byte_size)
           VALUES (%s, %s, %s, %s, %s, %s, %s, now(), %s, %s, %s)
           ON CONFLICT (source_id, external_id) DO UPDATE SET sha256 = EXCLUDED.sha256
           RETURNING id""",
        (source_id, f"{f.accession}/{filename}", f.form, company_id, f.document_url(filename), f.filing_date,
         f.report_date, obj.sha256, obj.uri, obj.size),
    ).fetchone()["id"]
    return doc_id, obj


def sync_company(conn: psycopg.Connection, edgar: Edgar, company_id: int, cik: str) -> dict[str, int]:
    stats = {"new": 0, "insider_corroborated": 0, "insider_review": 0, "review": 0, "skipped": 0, "errors": 0}
    source_id = reference.source_ids(conn)["sec_edgar"]
    baseline = _baseline(conn, company_id)
    known = {r["accession_number"] for r in conn.execute(
        "SELECT accession_number FROM sec_filing WHERE company_id = %s", (company_id,))}
    newest = baseline
    for f in edgar.filings(cik, include_history=False):
        if f.accession in known:
            continue
        status = classify(f)
        if baseline and f.filing_date <= baseline and status == "pending":
            status = "processed"  # covered by the last full review
        conn.execute(
            """INSERT INTO sec_filing (accession_number, cik, company_id, form_type, filing_date, report_date,
                                       acceptance_at, items, primary_document, processing_status, processor_version)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
            (f.accession, f.cik, company_id, f.form, f.filing_date, f.report_date, f.acceptance, list(f.items),
             f.primary_document, status, "baseline" if status == "processed" else PROCESSOR),
        )
        stats["new"] += 1
        newest = max(newest or f.filing_date, f.filing_date)

    pending = conn.execute(
        """SELECT * FROM sec_filing WHERE company_id = %s AND processing_status = 'pending'
           ORDER BY filing_date, accession_number""",
        (company_id,),
    ).fetchall()
    for row in pending:
        f = Filing(cik=row["cik"], accession=row["accession_number"], form=row["form_type"],
                   filing_date=row["filing_date"], report_date=row["report_date"], acceptance=row["acceptance_at"],
                   items=tuple(row["items"]), primary_document=row["primary_document"] or "",
                   primary_doc_description="")
        try:
            outcome = _process(conn, edgar, f, company_id, source_id)
        except (EdgarError, ValueError) as e:
            conn.execute("UPDATE sec_filing SET processing_status = 'failed', error = %s WHERE accession_number = %s",
                         (str(e)[:500], f.accession))
            stats["errors"] += 1
            continue
        stats[outcome] = stats.get(outcome, 0) + 1

    if newest:
        conn.execute(
            """INSERT INTO ingest_cursor (name, value) VALUES (%s, %s)
               ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
            (f"sec:{company_id}", json.dumps({"reviewed_through": newest.isoformat()})),
        )
    return stats


def _process(conn: psycopg.Connection, edgar: Edgar, f: Filing, company_id: int, source_id: int) -> str:
    if f.form in INSIDER_FORMS:
        filename = form345.raw_xml_filename(f.primary_document)
        doc_id, obj = _document(conn, edgar, f, company_id, source_id, filename)
        outcome = "skipped"
        for rel in form345.parse(rawstore.read(obj.key)):
            if not rel.is_director:
                continue
            person = conn.execute(
                "SELECT person_id FROM person_identifier WHERE scheme = 'sec_cik' AND value = %s", (rel.owner_cik,)
            ).fetchone()
            seat = person and conn.execute(
                """SELECT id FROM board_membership WHERE company_id = %s AND person_id = %s AND status = 'current'""",
                (company_id, person["person_id"]),
            ).fetchone()
            if seat:
                outcome = "insider_corroborated" if outcome == "skipped" else outcome
                continue
            ev = conn.execute(
                """INSERT INTO evidence (source_document_id, quote, locator, quote_verified, quote_verified_at,
                                         extraction_method, extractor, confidence, note)
                   VALUES (%s, %s, %s, true, now(), 'structured_xml', %s, 1.0, %s)
                   ON CONFLICT (source_document_id, md5(coalesce(quote, '')), coalesce(locator, ''))
                   DO UPDATE SET quote_verified_at = now() RETURNING id""",
                (doc_id, rel.owner_name, rel.xml_path, PROCESSOR,
                 f"Form {rel.form}: {rel.owner_name} (CIK {rel.owner_cik}) reports isDirector"),
            ).fetchone()["id"]
            conn.execute(
                """INSERT INTO extracted_fact (evidence_id, company_id, fact_type, person_name, person_cik, payload,
                                               status, resolved_person_id)
                   VALUES (%s, %s, 'insider_relationship', %s, %s, %s, 'needs_review', %s)""",
                (ev, company_id, rel.owner_name, rel.owner_cik,
                 json.dumps({"form": rel.form, "period_of_report": rel.period_of_report and
                             rel.period_of_report.isoformat(), "is_officer": rel.is_officer,
                             "officer_title": rel.officer_title, "is_ten_percent_owner": rel.is_ten_percent_owner,
                             "accession": f.accession}),
                 person["person_id"] if person else None),
            )
            outcome = "insider_review"
        conn.execute("UPDATE sec_filing SET processing_status = 'processed', processed_at = now() "
                     "WHERE accession_number = %s", (f.accession,))
        return outcome

    # 8-K Items 5.02/5.07 and proxies: keep the document and queue it for review.
    _document(conn, edgar, f, company_id, source_id, f.primary_document)
    conn.execute("UPDATE sec_filing SET processing_status = 'needs_review', processed_at = now() "
                 "WHERE accession_number = %s", (f.accession,))
    return "review"
