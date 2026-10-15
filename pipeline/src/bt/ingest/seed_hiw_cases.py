"""Load data/seed/hiw_<kind>*.json: researched Heads I Win cases (golden hellos, layoffs beside CEO pay).

Each case carries a list of figures. A figure records the number as printed and its scale ("$12
billion" -> printed 12, scale "billion"); the printed number must appear in the quotes it cites, and
the scale word with it. Quotes are verified verbatim against the cached filings.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import psycopg

from bt import rawstore
from bt.ingest import reference
from bt.ingest.seed_board import Stats, _TextCache, load_evidence
from bt.ingest.seed_comp import numbers_in
from bt.text import find_quote, normalize_for_match

KINDS = {"golden_hello", "layoffs"}
UNITS = {"usd", "people", "pct", "shares", "x"}
SCALES = {None: 1, "thousand": 1e3, "million": 1e6, "billion": 1e9}
REQUIRED = {"golden_hello": [{"sign_on_total", "first_year_pay"}],
            "layoffs": [{"jobs_cut", "pct_workforce"}, {"ceo_pay"}]}


def _key(e: dict) -> str:
    m = re.search(r"/Archives/edgar/data/(\d+)/", e["url"])
    return rawstore.sec_key(m.group(1), e["accession"], e["url"].rsplit("/", 1)[-1])


def figure_value(f: dict) -> float:
    return float(f["printed"]) * SCALES[f.get("scale")]


def check(data: dict, quote_ok: dict[str, bool] | None = None) -> list[str]:
    ev = {e["id"]: e for e in data["evidence"]}
    problems, ids = [], set()
    for c in data["cases"]:
        tag = c.get("id", "?")
        if tag in ids:
            problems.append(f"{tag}: duplicate id")
        ids.add(tag)
        if c.get("kind") not in KINDS:
            problems.append(f"{tag}: kind must be one of {sorted(KINDS)}")
            continue
        keys = {f.get("key") for f in c.get("figures", [])}
        for need in REQUIRED[c["kind"]]:
            if not keys & need:
                problems.append(f"{tag}: needs a figure with key in {sorted(need)}")
        for f in c.get("figures", []):
            ftag = f"{tag} {f.get('key')}"
            if f.get("unit") not in UNITS:
                problems.append(f"{ftag}: unit must be one of {sorted(UNITS)}")
            if f.get("scale") not in SCALES:
                problems.append(f"{ftag}: scale must be thousand, million, billion or null")
                continue
            refs = f.get("evidence_refs") or []
            if not refs or any(r not in ev for r in refs):
                problems.append(f"{ftag}: missing or unknown evidence {refs}")
                continue
            text = normalize_for_match(" ".join(ev[r]["quote"] for r in refs))
            if float(abs(f["printed"])) not in numbers_in(text):
                problems.append(f"{ftag}: {f['printed']} not in its quotes")
            if f.get("scale") and f["scale"] not in text.lower():
                problems.append(f"{ftag}: scale word '{f['scale']}' not in its quotes")
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
            problems.append(f"{e['id']}: not cached at {key} (fetch with scripts/sec_fetch.py)")
            continue
        quote_ok[e["id"]] = find_quote(texts.get(key, e["url"].rsplit("/", 1)[-1]), e["quote"]) >= 0
    return problems + check(data, quote_ok)


def load(conn: psycopg.Connection, path: Path) -> int:
    data = json.loads(path.read_text())
    sources = reference.ensure_sources(conn)
    ev_id, _, _ = load_evidence(conn, data, path, None, "0", sources["sec_edgar"], Stats())
    url = {e["id"]: e["url"] for e in data["evidence"]}
    conn.execute("DELETE FROM hiw_case WHERE source_file = %s", (path.name,))
    for c in data["cases"]:
        refs = sorted({r for f in c["figures"] for r in f["evidence_refs"]} | set(c.get("evidence_refs", [])))
        figures = [{"key": f["key"], "label": f["label"], "value": figure_value(f), "unit": f["unit"],
                    **({"fiscal_year": f["fiscal_year"]} if f.get("fiscal_year") else {})} for f in c["figures"]]
        person = c.get("person") or {}
        conn.execute(
            """INSERT INTO hiw_case (id, kind, company_name, company_cik, ticker, person_name, role, event_date,
                 headline, figures, notes, source_urls, evidence_ids, source_file)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (c["id"], c["kind"], c["company"]["name"], c["company"].get("cik"), c["company"].get("ticker"),
             person.get("name"), person.get("role"), c.get("date"), c["headline"], json.dumps(figures),
             c.get("notes") or None, sorted({url[r] for r in refs}), [ev_id[r] for r in refs], path.name))
    return len(data["cases"])
