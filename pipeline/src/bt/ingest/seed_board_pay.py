"""Load a researched board-pay file (data/seed/<company>_board_pay_research.json): the proxy
Director Compensation table rows and executives' exit packages (severance, accelerated equity,
consulting fees paid on the way out).

Every non-zero dollar figure must appear in its evidence quote, so a mistyped number fails loading.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import psycopg

from bt import rawstore
from bt.ingest import reference
from bt.ingest.seed_board import Stats, _TextCache, load_evidence, upsert_person
from bt.ingest.seed_comp import fy_end_for, numbers_in
from bt.text import find_quote, normalize_for_match

DIRECTOR_FIELDS = ["fees_cash", "stock_awards", "option_awards", "non_equity_incentive", "pension_nqdc",
                   "all_other", "total"]
EXIT_FIELDS = ["severance_cash", "accelerated_equity_value", "consulting_fees", "other_exit_pay", "total_exit_pay"]
EXIT_TYPES = {"resigned", "retired", "terminated_without_cause", "terminated_for_cause", "mutual", "death",
              "change_in_control", "other"}
EXIT_BASES = {"actual", "estimated"}


@dataclass
class BoardPayStats:
    board: Stats = field(default_factory=Stats)
    people: int = 0
    director_rows: int = 0
    exits: int = 0


def _missing(quote: str, amounts: list) -> list:
    found = numbers_in(normalize_for_match(quote))
    return [a for a in amounts if a and float(abs(a)) not in found]


def check_file(data: dict, quote_ok: dict[str, bool] | None = None) -> list[str]:
    """Structural and arithmetic checks that need no database. Lines starting "WARN" don't block loading."""
    problems = []
    ev = {e["id"]: e for e in data["evidence"]}
    keys = {p["key"] for p in data["people"]}
    for i, r in enumerate(data.get("director_comp", [])):
        tag = f"director_comp[{i}] {r['person_key']} FY{r['fiscal_year']} {r['accession']}"
        if r["person_key"] not in keys:
            problems.append(f"{tag}: unknown person_key")
        e = ev.get(r["evidence_ref"])
        if e is None:
            problems.append(f"{tag}: unknown evidence ref {r['evidence_ref']}")
            continue
        if e["accession"] != r["accession"]:
            problems.append(f"{tag}: evidence {e['id']} is from {e['accession']}")
        miss = _missing(e["quote"], [r.get(f, 0) for f in DIRECTOR_FIELDS])
        if miss:
            problems.append(f"{tag}: amounts not in quote {e['id']}: {miss}")
        parts = sum(r.get(f, 0) for f in DIRECTOR_FIELDS[:-1])
        if abs(parts - r["total"]) > 1:
            problems.append(f"WARN {tag}: components sum to {parts}, total {r['total']}")
    for i, x in enumerate(data.get("exits", [])):
        tag = f"exits[{i}] {x['person_key']} {x.get('exit_date')}"
        if x["person_key"] not in keys:
            problems.append(f"{tag}: unknown person_key")
        if x.get("exit_type") not in EXIT_TYPES:
            problems.append(f"{tag}: exit_type must be one of {sorted(EXIT_TYPES)}")
        if x.get("basis") not in EXIT_BASES:
            problems.append(f"{tag}: basis must be actual or estimated")
        refs = x.get("evidence_refs", [])
        unknown = [r for r in refs if r not in ev]
        if unknown or not refs:
            problems.append(f"{tag}: unknown or missing evidence refs {unknown}")
            continue
        quotes = " ".join(ev[r]["quote"] for r in refs)
        miss = _missing(quotes, [x.get(f) for f in EXIT_FIELDS])
        if miss:
            problems.append(f"{tag}: amounts not in its quotes: {miss}")
    if quote_ok is not None:
        problems += [f"{k}: quote not found verbatim" for k, ok in quote_ok.items() if not ok]
    return problems


def verify_file(path: Path) -> list[str]:
    data = json.loads(path.read_text())
    texts = _TextCache()
    cik = data["company"]["cik"]
    quote_ok, problems = {}, []
    for e in data["evidence"]:
        filename = e["url"].rsplit("/", 1)[-1]
        m = re.search(r"/Archives/edgar/data/(\d+)/", e["url"])
        key = rawstore.sec_key(m.group(1) if m else cik, e["accession"], filename)
        if not rawstore.exists(key):
            problems.append(f"{e['id']}: not cached at {key} (fetch with scripts/sec_fetch.py)")
            continue
        quote_ok[e["id"]] = find_quote(texts.get(key, filename), e["quote"]) >= 0
    return problems + check_file(data, quote_ok)


def load(conn: psycopg.Connection, path: Path) -> BoardPayStats:
    data = json.loads(path.read_text())
    st = BoardPayStats()
    sources = reference.ensure_sources(conn)
    c = data["company"]
    company = conn.execute("SELECT id FROM company WHERE cik = %s OR slug = %s",
                           (c["cik"], c["ticker"].lower())).fetchone()
    if company is None:
        raise SystemExit(f"{path.name}: load the company's board file first")
    company_id = company["id"]
    ev_id, _, _ = load_evidence(conn, data, path, company_id, c["cik"], sources["sec_edgar"], st.board)
    ev_doc = {k: conn.execute("SELECT source_document_id FROM evidence WHERE id = %s", (v,)).fetchone()[
        "source_document_id"] for k, v in ev_id.items()}
    person_id = {p["key"]: upsert_person(conn, p) for p in data["people"]}
    st.people = len(person_id)

    conn.execute("DELETE FROM director_comp WHERE company_id = %s", (company_id,))
    for r in data.get("director_comp", []):
        conn.execute(
            f"""INSERT INTO director_comp (company_id, person_id, fiscal_year, fiscal_year_end, source_document_id,
                  evidence_id, listed_name, notes, excluded_from_board_cost, {", ".join(DIRECTOR_FIELDS)})
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, {", ".join(["%s"] * len(DIRECTOR_FIELDS))})""",
            (company_id, person_id[r["person_key"]], r["fiscal_year"], fy_end_for(data, r["fiscal_year"], r),
             ev_doc[r["evidence_ref"]], ev_id[r["evidence_ref"]], r.get("listed_name"), r.get("notes") or None,
             bool(r.get("excluded_from_board_cost")), *[r.get(f, 0) for f in DIRECTOR_FIELDS]))
        st.director_rows += 1

    conn.execute("DELETE FROM executive_exit WHERE company_id = %s", (company_id,))
    for x in data.get("exits", []):
        conn.execute(
            f"""INSERT INTO executive_exit (company_id, person_id, role, exit_date, exit_date_precision, exit_type,
                  basis, evidence_ids, notes, {", ".join(EXIT_FIELDS)})
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, {", ".join(["%s"] * len(EXIT_FIELDS))})""",
            (company_id, person_id[x["person_key"]], x.get("role"), x.get("exit_date"),
             x.get("exit_date_precision", "day"), x["exit_type"], x["basis"],
             [ev_id[r] for r in x["evidence_refs"]], x.get("notes") or None, *[x.get(f) for f in EXIT_FIELDS]))
        st.exits += 1
    return st
