"""Load a researched executive-pay file (data/seed/<company>_exec_comp_research.json):
officer tenures, Summary Compensation Table rows and Pay versus Performance rows.

Quotes are verified like board facts, and every non-zero dollar figure must also appear in
its table-row quote after the row's fiscal-year token, so a mistyped number fails loading.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import psycopg

from bt import rawstore
from bt.ingest import reference
from bt.ingest.seed_board import Stats, _TextCache, load_evidence, parse_partial, upsert_person
from bt.text import find_quote, normalize_for_match

COMP_FIELDS = ["salary", "bonus", "stock_awards", "option_awards", "non_equity_incentive", "pension_nqdc", "all_other",
               "total"]
_NUMBER = re.compile(r"\(?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\)?")


@dataclass
class CompStats:
    board: Stats = field(default_factory=Stats)
    people: int = 0
    positions: int = 0
    comp_rows: int = 0
    pvp_rows: int = 0


PVP_AMOUNT_FIELDS = ["non_peo_avg_sct_total", "non_peo_avg_cap"]


def amount(row: dict, field: str) -> float | None:
    """A dollar figure, converting ones the filing printed in millions (`<field>_usd_millions`)."""
    if row.get(field) is not None:
        return row[field]
    m = row.get(f"{field}_usd_millions")
    return None if m is None else round(m * 1_000_000)


def printed(row: dict, field: str) -> float | None:
    """The figure as it appears in the filing's table (millions stay millions), for quote checks."""
    if row.get(field) is not None:
        return row[field]
    return row.get(f"{field}_usd_millions")


def numbers_in(text: str) -> set[float]:
    out = {float(m.group(1).replace(",", "") + ("." + m.group(2) if m.group(2) else ""))
           for m in _NUMBER.finditer(text)}
    # Typesetting slips print a thousands separator as a space ("$409 903"); also read those as one number.
    out |= {float(m.group(0).replace(" ", "")) for m in re.finditer(r"(?<![\d,.])\d{1,3}(?: \d{3})+(?![\d,])", text)}
    return out


def row_segments(quote: str, year: int) -> list[str]:
    """Text after each standalone `year` token, up to the next nearby year token."""
    q = normalize_for_match(quote)
    years = [m for m in re.finditer(r"(?<![\d,.$])(19|20)\d{2}(?![\d,])", q) if abs(int(m.group()) - year) <= 6]
    out = []
    for i, m in enumerate(years):
        if int(m.group()) == year:
            end = next((n.start() for n in years[i + 1:] if int(n.group()) != year), len(q))
            out.append(q[m.end():end])
    return out


def missing_amounts(quote: str, year: int, amounts: list[float]) -> list[float]:
    """Non-zero amounts not found in any segment of the quote for that fiscal year ([] = verified)."""
    wanted = [a for a in amounts if a]
    best = wanted
    for seg in row_segments(quote, year):
        found = numbers_in(seg)
        miss = [a for a in wanted if float(a) not in found]
        if len(miss) < len(best):
            best = miss
    return best


def fy_end_for(data: dict, fy: int, row: dict | None = None) -> date:
    """A fiscal year's last day: the row's own date, else the file's per-year map (52/53-week
    years such as NVIDIA's late-January ends), else the file's month-day."""
    if row and row.get("fiscal_year_end"):
        return date.fromisoformat(row["fiscal_year_end"])
    if str(fy) in data.get("fiscal_year_ends", {}):
        return date.fromisoformat(data["fiscal_year_ends"][str(fy)])
    m, d = (int(x) for x in data.get("fiscal_year_end", "12-31").split("-"))
    return date(fy, m, d)


def check_file(data: dict, quote_ok: dict[str, bool] | None = None) -> list[str]:
    """Structural and arithmetic checks that need no database. Lines starting "WARN" don't block loading."""
    problems = []
    ev = {e["id"]: e for e in data["evidence"]}
    keys = {p["key"] for p in data["people"]}
    for i, pos in enumerate(data.get("positions", [])):
        if pos["person_key"] not in keys:
            problems.append(f"positions[{i}]: unknown person_key {pos['person_key']}")
        problems += [f"positions[{i}]: unknown evidence ref {r}" for r in pos["evidence_refs"] if r not in ev]
    for i, c in enumerate(data.get("comp", [])):
        tag = f"comp[{i}] {c['person_key']} FY{c['fiscal_year']} {c['accession']}"
        if c["person_key"] not in keys:
            problems.append(f"{tag}: unknown person_key")
        e = ev.get(c["evidence_ref"])
        if e is None:
            problems.append(f"{tag}: unknown evidence ref {c['evidence_ref']}")
            continue
        if e["accession"] != c["accession"]:
            problems.append(f"{tag}: evidence {e['id']} is from {e['accession']}")
        miss = missing_amounts(e["quote"], c["fiscal_year"], [c[f] for f in COMP_FIELDS])
        if miss:
            problems.append(f"{tag}: amounts not in quote {e['id']}: {miss}")
        if sum(c[f] for f in COMP_FIELDS[:-1]) != c["total"]:
            problems.append(f"WARN {tag}: components sum to {sum(c[f] for f in COMP_FIELDS[:-1])}, "
                            f"total {c['total']} (filings occasionally round; check the table)")
    for i, r in enumerate(data.get("pay_vs_performance", [])):
        tag = f"pay_vs_performance[{i}] FY{r['fiscal_year']} {r['accession']}"
        e = ev.get(r["evidence_ref"])
        if e is None:
            problems.append(f"{tag}: unknown evidence ref {r['evidence_ref']}")
            continue
        amounts = [printed(p, f) for p in r["peos"] for f in ("sct_total", "cap")] + [
            printed(r, f) for f in PVP_AMOUNT_FIELDS] + [r.get("tsr_value_of_100")]
        found = numbers_in(normalize_for_match(e["quote"]))
        miss = [a for a in amounts if a and float(abs(a)) not in found]
        if miss:
            problems.append(f"{tag}: amounts not in quote {e['id']}: {miss}")
        problems += [f"{tag}: unknown person_key {p['person_key']}" for p in r["peos"] if p["person_key"] not in keys]
    if quote_ok is not None:
        problems += [f"{k}: quote not found verbatim" for k, ok in quote_ok.items() if not ok]
    return problems


def verify_file(path: Path) -> list[str]:
    data = json.loads(path.read_text())
    texts = _TextCache()
    cik = data["company"]["cik"]
    quote_ok = {}
    problems = []
    for e in data["evidence"]:
        filename = e["url"].rsplit("/", 1)[-1]
        m = re.search(r"/Archives/edgar/data/(\d+)/", e["url"])
        key = rawstore.sec_key(m.group(1) if m else cik, e["accession"], filename)
        if not rawstore.exists(key):
            problems.append(f"{e['id']}: not cached at {key} (fetch with scripts/sec_fetch.py)")
            continue
        quote_ok[e["id"]] = find_quote(texts.get(key, filename), e["quote"]) >= 0
    return problems + check_file(data, quote_ok)


def load(conn: psycopg.Connection, path: Path) -> CompStats:
    data = json.loads(path.read_text())
    st = CompStats()
    sources = reference.ensure_sources(conn)
    c = data["company"]
    company = conn.execute("SELECT id FROM company WHERE cik = %s OR slug = %s", (c["cik"], c["ticker"].lower())
                           ).fetchone()
    if company is None:
        raise SystemExit(f"{path.name}: load the company's board file first")
    company_id = company["id"]
    ev_id, ev_ok, _ = load_evidence(conn, data, path, company_id, c["cik"], sources["sec_edgar"], st.board)
    ev_doc = {k: conn.execute("SELECT source_document_id FROM evidence WHERE id = %s", (v,)).fetchone()[
        "source_document_id"] for k, v in ev_id.items()}

    def link(refs: list[str], subject_type: str, subject_id: int) -> None:
        for r in refs:
            conn.execute("""INSERT INTO evidence_link (evidence_id, subject_type, subject_id) VALUES (%s, %s, %s)
                            ON CONFLICT DO NOTHING""", (ev_id[r], subject_type, subject_id))

    person_id = {}
    for p in data["people"]:
        person_id[p["key"]] = upsert_person(conn, p)
        st.people += 1

    keep = []
    for pos in data["positions"]:
        sd, sp = parse_partial(pos["start_date"])
        ed, ep = parse_partial(pos["end_date"])
        current = bool(pos["is_current"])
        conf = pos["confidence"] if any(ev_ok.get(r) for r in pos["evidence_refs"]) else "low"
        row = conn.execute(
            """INSERT INTO executive_position (company_id, person_id, title, start_date, start_precision, start_basis,
                 end_date, end_precision, end_reason, is_current, confidence, notes, review_status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'reviewed')
               ON CONFLICT (company_id, person_id, title, coalesce(start_date, '0001-01-01')) DO UPDATE SET
                 start_precision = EXCLUDED.start_precision, start_basis = EXCLUDED.start_basis,
                 end_date = EXCLUDED.end_date, end_precision = EXCLUDED.end_precision,
                 end_reason = EXCLUDED.end_reason, is_current = EXCLUDED.is_current,
                 confidence = EXCLUDED.confidence, notes = EXCLUDED.notes
               WHERE NOT executive_position.is_locked
               RETURNING id""",
            (company_id, person_id[pos["person_key"]], pos["title"], sd, sp, pos.get("start_date_basis"),
             None if current else ed, None if current else ep, None if current else pos.get("end_reason"),
             current, conf, pos.get("notes")),
        ).fetchone()
        if row is None:
            row = conn.execute(
                """SELECT id FROM executive_position WHERE company_id = %s AND person_id = %s AND title = %s
                     AND coalesce(start_date, '0001-01-01') = %s""",
                (company_id, person_id[pos["person_key"]], pos["title"], sd or date(1, 1, 1))).fetchone()
        keep.append(row["id"])
        link(pos["evidence_refs"], "executive_position", row["id"])
        st.positions += 1
    conn.execute("DELETE FROM executive_position WHERE company_id = %s AND NOT is_locked AND NOT (id = ANY(%s))",
                 (company_id, keep))

    conn.execute("DELETE FROM executive_comp WHERE company_id = %s", (company_id,))
    for r in data["comp"]:
        cid = conn.execute(
            f"""INSERT INTO executive_comp (company_id, person_id, fiscal_year, fiscal_year_end, source_document_id,
                  evidence_id, listed_title, notes, {", ".join(COMP_FIELDS)})
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, {", ".join(["%s"] * len(COMP_FIELDS))}) RETURNING id""",
            (company_id, person_id[r["person_key"]], r["fiscal_year"], fy_end_for(data, r["fiscal_year"], r),
             ev_doc[r["evidence_ref"]], ev_id[r["evidence_ref"]], r.get("listed_title"), r.get("notes") or None,
             *[r[f] for f in COMP_FIELDS]),
        ).fetchone()["id"]
        link([r["evidence_ref"]], "executive_comp", cid)
        st.comp_rows += 1

    conn.execute("DELETE FROM pay_vs_performance WHERE company_id = %s", (company_id,))
    for r in data.get("pay_vs_performance", []):
        doc = ev_doc[r["evidence_ref"]]
        conn.execute(
            """INSERT INTO pay_vs_performance (source_document_id, fiscal_year, fiscal_year_end, company_id,
                 evidence_id, non_peo_avg_sct_total, non_peo_avg_cap, tsr_value_of_100, peer_tsr_value_of_100,
                 peer_group, tsr_base_date, net_income_usd, company_selected_measure, company_selected_measure_value,
                 notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (doc, r["fiscal_year"], fy_end_for(data, r["fiscal_year"]), company_id, ev_id[r["evidence_ref"]],
             amount(r, "non_peo_avg_sct_total"), amount(r, "non_peo_avg_cap"), r.get("tsr_value_of_100"),
             r.get("peer_tsr_value_of_100"), r.get("peer_group"),
             _parse_long_date(r.get("tsr_base_date")), r.get("net_income_usd"), r.get("company_selected_measure"),
             r.get("company_selected_measure_value"), r.get("notes") or None),
        )
        for p in r["peos"]:
            conn.execute(
                """INSERT INTO pay_vs_performance_peo (source_document_id, fiscal_year, person_id, sct_total, cap)
                   VALUES (%s, %s, %s, %s, %s)""",
                (doc, r["fiscal_year"], person_id[p["person_key"]], amount(p, "sct_total"), amount(p, "cap")))
        st.pvp_rows += 1
    conn.execute(
        """DELETE FROM evidence_link el WHERE subject_type IN ('executive_position', 'executive_comp')
             AND NOT EXISTS (SELECT 1 FROM executive_position p WHERE el.subject_type = 'executive_position'
                               AND p.id = el.subject_id)
             AND NOT EXISTS (SELECT 1 FROM executive_comp c WHERE el.subject_type = 'executive_comp'
                               AND c.id = el.subject_id)""")
    return st


def _parse_long_date(s: str | None) -> date | None:
    """'2019-12-31' or 'December 31, 2019' (as stated in the PvP footnote)."""
    if not s:
        return None
    m = re.search(r"\d{4}-\d{2}-\d{2}", s)
    if m:
        return date.fromisoformat(m.group())
    m = re.search(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})", s)
    if m:
        return datetime.strptime(m.group(), "%B %d, %Y").date()
    return None
