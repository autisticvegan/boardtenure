"""Load data/seed/failing_up_research.json: quotes verified verbatim, every recorded number present
in the quotes it cites."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import psycopg

from bt import rawstore
from bt.ingest import reference
from bt.ingest.seed_board import Stats, _TextCache, load_evidence
from bt.ingest.seed_comp import numbers_in
from bt.text import find_quote, normalize_for_match


def _key(e: dict) -> str:
    m = re.search(r"/Archives/edgar/data/(\d+)/", e["url"])
    return rawstore.sec_key(m.group(1), e["accession"], e["url"].rsplit("/", 1)[-1])


def check(data: dict, quote_ok: dict[str, bool] | None = None) -> list[str]:
    ev = {e["id"]: e for e in data["evidence"]}
    problems = []

    def need(tag: str, refs: list[str], values: list) -> None:
        unknown = [r for r in refs if r not in ev]
        if unknown:
            problems.append(f"{tag}: unknown evidence {unknown}")
            return
        found = numbers_in(normalize_for_match(" ".join(ev[r]["quote"] for r in refs)))
        miss = [v for v in values if v and float(abs(v)) not in found]
        if miss:
            problems.append(f"{tag}: numbers not in quotes: {miss}")

    for c in data["cases"]:
        if c["to"].get("kind", "executive") not in ("executive", "director"):
            problems.append(f"{c['id']}: to.kind must be executive or director")
        st = c["from"]["stock"]
        need(f"{c['id']} stock", st["evidence_refs"], [st["company_value_of_100"], st["comparison_value_of_100"]]
             + [o["value_of_100"] for o in st.get("other_comparisons", [])])
        xp = c["from"].get("exit_pay") or {}
        if xp.get("total"):
            need(f"{c['id']} exit pay", xp.get("evidence_refs", []), [xp["total"]])
        for p in c["to"]["pay"]:
            need(f"{c['id']} pay FY{p['fiscal_year']}", [p["evidence_ref"]], [p["total"]])
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
    conn.execute("DELETE FROM failing_up_case WHERE source_file = %s OR source_file IS NULL", (path.name,))
    for c in data["cases"]:
        f, t, st = c["from"], c["to"], c["from"]["stock"]
        xp = f.get("exit_pay") or {}
        refs = st["evidence_refs"] + xp.get("evidence_refs", []) + [p["evidence_ref"] for p in t["pay"]]
        conn.execute(
            f"""INSERT INTO failing_up_case (id, person_name, person_cik, from_company, from_ticker, from_role,
                 from_start, from_end, exit_description, from_value_of_100, comparison_name, comparison_value_of_100,
                 period_start, period_end, exit_pay_total, exit_pay_description, to_company, to_ticker, to_role,
                 to_start, pay, notes, source_urls, evidence_ids, to_kind, source_file, other_comparisons)
               VALUES ({", ".join(["%s"] * 27)})""",
            (c["id"], c["person"]["name"], c["person"].get("sec_cik"), f["company"], f.get("ticker"), f["role"],
             f.get("start"), f.get("end"), f.get("exit_description"), st["company_value_of_100"],
             st["comparison_name"], st["comparison_value_of_100"],
             date.fromisoformat(st["period_start"]) if st.get("period_start") else None,
             date.fromisoformat(st["period_end"]) if st.get("period_end") else None,
             xp.get("total"), xp.get("description"), t["company"], t.get("ticker"), t["role"], t.get("start"),
             json.dumps([{"fiscal_year": p["fiscal_year"], "total": p["total"]} for p in t["pay"]]),
             c.get("notes") or None, sorted({url[r] for r in refs}), [ev_id[r] for r in refs],
             t.get("kind", "executive"), path.name,
             json.dumps([{"name": o["name"], "value_of_100": o["value_of_100"]}
                         for o in st.get("other_comparisons", [])])))
    return len(data["cases"])
