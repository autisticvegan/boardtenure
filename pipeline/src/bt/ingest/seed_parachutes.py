"""Load data/seed/golden_parachutes_*.json: researched exit packages across US public companies.
Quotes are verified verbatim; every recorded figure must appear in the quotes it cites."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import psycopg

from bt import rawstore
from bt.ingest import reference
from bt.ingest.seed_board import Stats, _TextCache, load_evidence
from bt.ingest.seed_board_pay import EXIT_TYPES
from bt.ingest.seed_comp import numbers_in
from bt.text import find_quote, normalize_for_match

PAY_FIELDS = ["severance_cash", "bonus", "equity", "pension_deferred", "benefits_other", "consulting", "tax_gross_up",
              "total"]
CONTEXTS = {"termination", "resignation", "retirement", "merger", "other"}


def _key(e: dict) -> str:
    m = re.search(r"/Archives/edgar/data/(\d+)/", e["url"])
    return rawstore.sec_key(m.group(1), e["accession"], e["url"].rsplit("/", 1)[-1])


def _date(s: str | None) -> date | None:
    return date.fromisoformat(s) if s and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) else None


def check(data: dict, quote_ok: dict[str, bool] | None = None) -> list[str]:
    ev = {e["id"]: e for e in data["evidence"]}
    problems, ids = [], set()
    for c in data["cases"]:
        tag = c.get("id", "?")
        if tag in ids:
            problems.append(f"{tag}: duplicate id")
        ids.add(tag)
        if c.get("exit_type") not in EXIT_TYPES:
            problems.append(f"{tag}: exit_type must be one of {sorted(EXIT_TYPES)}")
        if c.get("context") not in CONTEXTS:
            problems.append(f"{tag}: context must be one of {sorted(CONTEXTS)}")
        if c.get("basis") not in ("actual", "estimated"):
            problems.append(f"{tag}: basis must be actual or estimated")
        refs = c.get("pay_evidence_refs") or []
        if not refs or any(r not in ev for r in refs):
            problems.append(f"{tag}: missing or unknown pay evidence {refs}")
        else:
            found = numbers_in(normalize_for_match(" ".join(ev[r]["quote"] for r in refs)))
            pay = c.get("pay") or {}
            miss = [pay.get(f) for f in PAY_FIELDS if pay.get(f) and float(abs(pay[f])) not in found]
            if miss and not (pay.get("total") in miss and not pay.get("total_is_stated") and len(miss) == 1):
                problems.append(f"{tag}: pay figures not in quotes: {miss}")
        st = c.get("stock")
        if st:
            srefs = st.get("evidence_refs") or []
            if not srefs or any(r not in ev for r in srefs):
                problems.append(f"{tag}: missing or unknown stock evidence")
            else:
                found = numbers_in(normalize_for_match(" ".join(ev[r]["quote"] for r in srefs)))
                miss = [v for v in (st.get("company_value_of_100"), st.get("comparison_value_of_100"))
                        if v and float(abs(v)) not in found]
                if miss:
                    problems.append(f"{tag}: stock figures not in quotes: {miss}")
    if quote_ok is not None:
        problems += [f"{k}: quote not found verbatim" for k, ok in quote_ok.items() if not ok]
    return problems


def verify_file(path: Path) -> list[str]:
    data = json.loads(path.read_text())
    texts = _TextCache()
    quote_ok, problems = {}, []
    for e in data["evidence"]:
        key = _key(e)
        if not rawstore.exists(key):
            problems.append(f"{e['id']}: not cached at {key}")
            continue
        quote_ok[e["id"]] = find_quote(texts.get(key, e["url"].rsplit("/", 1)[-1]), e["quote"]) >= 0
    return problems + check(data, quote_ok)


def load(conn: psycopg.Connection, path: Path) -> int:
    data = json.loads(path.read_text())
    sources = reference.ensure_sources(conn)
    ev_id, _, _ = load_evidence(conn, data, path, None, "0", sources["sec_edgar"], Stats())
    url = {e["id"]: e["url"] for e in data["evidence"]}
    slice_ = data.get("slice") or path.stem.removeprefix("golden_parachutes_")
    conn.execute("DELETE FROM golden_parachute WHERE research_slice = %s", (slice_,))
    for c in data["cases"]:
        pay, st = c.get("pay") or {}, c.get("stock") or {}
        refs = list(c.get("pay_evidence_refs") or []) + list(st.get("evidence_refs") or [])
        # Pay figures summed from parts are marked unstated; the page labels them "sum of disclosed parts".
        total = pay.get("total")
        stated = bool(pay.get("total_is_stated"))
        if total is None:
            parts = [pay.get(f) for f in PAY_FIELDS[:-1] if pay.get(f) is not None]
            total, stated = (sum(parts), False) if parts else (None, False)
        conn.execute(
            f"""INSERT INTO golden_parachute (id, research_slice, person_name, person_cik, company_name, company_cik,
                  ticker, role, tenure_start, tenure_end, exit_type, exit_words, context, basis,
                  {", ".join(PAY_FIELDS)},
                  total_is_stated, value_of_100, comparison_name, comparison_value_of_100, stock_period_start,
                  stock_period_end, clawback_or_forfeiture, notes, source_urls, evidence_ids)
                VALUES ({", ".join(["%s"] * (14 + len(PAY_FIELDS) + 11))})
                ON CONFLICT (id) DO NOTHING""",
            (c["id"], slice_, c["person"]["name"], c["person"].get("sec_cik"), c["company"]["name"],
             c["company"].get("cik"), c["company"].get("ticker"), c["role"], c.get("tenure_start"), c.get("tenure_end"),
             c["exit_type"], c.get("exit_words"), c["context"], c["basis"],
             *[pay.get(f) for f in PAY_FIELDS[:-1]], total, stated,
             st.get("company_value_of_100"), st.get("comparison_name"), st.get("comparison_value_of_100"),
             _date(st.get("period_start")), _date(st.get("period_end")), c.get("clawback_or_forfeiture"),
             c.get("notes") or None, sorted({url[r] for r in refs}), [ev_id[r] for r in refs]))
    return len(data["cases"])
