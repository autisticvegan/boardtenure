"""Load a researched board file (data/seed/<company>_board_research.json) into the
canonical tables, verifying every quote against the cached filing first.

Idempotent: rows are matched on natural keys and refreshed, and locked rows
(admin-corrected) are left untouched and reported.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path

import psycopg
from lxml import etree

from bt import rawstore
from bt.ingest import reference
from bt.text import document_text, find_quote

EXTRACTOR = "manual_research"
EXCHANGES = {"nasdaq": "XNAS", "new york stock exchange": "XNYS", "nyse": "XNYS", "cboe": "BATS"}
LEADERSHIP_ROLES = {"chair", "executive_chair", "vice_chair", "lead_independent_director", "executive_director"}
INDEPENDENCE_ROLES = {"independent_director": True, "non_independent_director": False}


def parse_partial(s: str | None) -> tuple[date | None, str]:
    """'2021-07-09' -> day, '2016-02' -> month, '2007' -> year, None -> unknown."""
    if not s:
        return None, "unknown"
    parts = s.split("-")
    if len(parts) == 3:
        return date.fromisoformat(s), "day"
    if len(parts) == 2:
        return date(int(parts[0]), int(parts[1]), 1), "month"
    return date(int(parts[0]), 1, 1), "year"


def window(d: date | None, precision: str) -> tuple[date, date]:
    if d is None or precision == "unknown":
        return date.min, date.max
    if precision == "day":
        return d, d
    if precision == "month":
        nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        return d, date.fromordinal(nxt.toordinal() - 1)
    return d, date(d.year, 12, 31)


@dataclass
class Stats:
    documents: int = 0
    evidence: int = 0
    verified: int = 0
    unverified: list[str] = field(default_factory=list)
    people: int = 0
    memberships: int = 0
    roles: int = 0
    independence: int = 0
    snapshots: int = 0
    events: int = 0
    skipped_locked: list[str] = field(default_factory=list)


class _TextCache:
    def __init__(self) -> None:
        self._cache: dict[str, str] = {}

    def get(self, key: str, filename: str) -> str:
        if key not in self._cache:
            self._cache[key] = document_text(rawstore.read(key), filename)
        return self._cache[key]


def _verify_xml_fields(raw: bytes, fields: dict) -> bool:
    root = etree.fromstring(raw, parser=etree.XMLParser(resolve_entities=False, no_network=True))
    for tag, expected in fields.items():
        el = root.find(f".//{tag}")
        if el is None or (el.text or "").strip() != str(expected).strip():
            return False
    return True


def load_evidence(conn: psycopg.Connection, data: dict, path: Path, company_id: int, cik: str, source_id: int,
                  st: Stats) -> tuple[dict[str, int], dict[str, bool], dict[str, int]]:
    """Register each cited filing and store its quote with the machine verification result."""
    texts = _TextCache()
    ev_id: dict[str, int] = {}
    ev_ok: dict[str, bool] = {}
    doc_by_accession: dict[str, int] = {}
    for e in data["evidence"]:
        filename = e["url"].rsplit("/", 1)[-1]
        folder = re.search(r"/Archives/edgar/data/(\d+)/", e["url"])
        key = rawstore.sec_key(folder.group(1) if folder else cik, e["accession"], filename)
        if not rawstore.exists(key):
            raise SystemExit(f"{e['id']}: cached filing missing at {key}; fetch it before loading")
        obj = rawstore.describe(key)
        doc_id = conn.execute(
            """INSERT INTO source_document (source_id, external_id, doc_type, company_id, url, published_at,
                                            retrieved_at, sha256, storage_uri, byte_size, content_type)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (source_id, external_id) DO UPDATE SET sha256 = EXCLUDED.sha256,
                 byte_size = EXCLUDED.byte_size, doc_type = EXCLUDED.doc_type
               RETURNING id""",
            (source_id, f"{e['accession']}/{filename}", e["form"], company_id, e["url"],
             date.fromisoformat(e["filing_date"]), datetime.fromtimestamp(obj.path.stat().st_mtime, UTC),
             obj.sha256, obj.uri, obj.size, "text/xml" if filename.endswith(".xml") else "text/html"),
        ).fetchone()["id"]
        doc_by_accession.setdefault(e["accession"], doc_id)

        ok = find_quote(texts.get(key, filename), e["quote"]) >= 0
        if ok and e.get("xml_fields"):
            ok = _verify_xml_fields(rawstore.read(key), e["xml_fields"])
        ev_ok[e["id"]] = ok
        st.verified += ok
        if not ok:
            st.unverified.append(e["id"])
        locator = "xml" if e.get("xml_fields") else ("table" if e.get("quote_from_table") else None)
        ev_id[e["id"]] = conn.execute(
            """INSERT INTO evidence (source_document_id, quote, locator, quote_verified, quote_verified_at,
                                     extraction_method, extractor, note)
               VALUES (%s, %s, %s, %s, now(), %s, %s, %s)
               ON CONFLICT (source_document_id, md5(coalesce(quote, '')), coalesce(locator, ''))
               DO UPDATE SET quote_verified = EXCLUDED.quote_verified, quote_verified_at = now(),
                 note = EXCLUDED.note
               RETURNING id""",
            (doc_id, e["quote"], locator, ok, EXTRACTOR, f"research:{path.name}", e.get("supports")),
        ).fetchone()["id"]
        st.evidence += 1
    st.documents = len({e["url"] for e in data["evidence"]})

    return ev_id, ev_ok, doc_by_accession


def load(conn: psycopg.Connection, path: Path) -> Stats:
    data = json.loads(path.read_text())
    st = Stats()
    sources = reference.ensure_sources(conn)
    c = data["company"]
    exchange = next((v for k, v in EXCHANGES.items() if k in c.get("exchange", "").lower()), None)
    company_id, _ = reference.ensure_company(conn, reference.CompanySpec(
        slug=c["ticker"].lower(), cik=c["cik"], legal_name=c["legal_name"],
        common_name=c.get("common_name") or re.sub(r",? Inc\.?$", "", c["legal_name"]),
        symbol=c["ticker"], exchange=exchange or "",
        # Long-listed issuers have no IPO in range; the listing year still bounds price-history gaps.
        ipo_date=(date.fromisoformat(c["ipo_date"]) if c.get("ipo_date")
                  else date(int(c["listed_since_year"]), 1, 1) if c.get("listed_since_year") else None),
        state_of_incorporation=c.get("state_of_incorporation"),
    ))
    cik = c["cik"]

    ev_id, ev_ok, doc_by_accession = load_evidence(conn, data, path, company_id, cik, sources["sec_edgar"], st)

    def link(refs: list[str], subject_type: str, subject_id: int, fld: str = "*") -> None:
        for r in refs:
            conn.execute(
                """INSERT INTO evidence_link (evidence_id, subject_type, subject_id, field)
                   VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                (ev_id[r], subject_type, subject_id, fld),
            )

    def confidence(stated: str, refs: list[str]) -> str:
        # Facts resting only on unverified quotes are never above low.
        return stated if any(ev_ok.get(r) for r in refs) else "low"

    # -- people --------------------------------------------------------------------
    person_id: dict[str, int] = {}
    for p in data["people"]:
        pid = upsert_person(conn, p)
        person_id[p["key"]] = pid
        conn.execute("DELETE FROM extracted_fact WHERE fact_type = 'other_board_disclosed' AND resolved_person_id = %s",
                     (pid,))
        for ob in p.get("bio_other_public_boards", []):
            if ob.get("source_ref") not in ev_id:
                continue
            conn.execute(
                """INSERT INTO extracted_fact (evidence_id, company_id, fact_type, person_name, person_cik, payload,
                                               status, resolved_person_id)
                   VALUES (%s, %s, 'other_board_disclosed', %s, %s, %s, 'needs_review', %s)""",
                (ev_id[ob["source_ref"]], company_id, p["full_name"], p.get("sec_cik"),
                 json.dumps({k: v for k, v in ob.items() if k != "source_ref"}), pid),
            )
        st.people += 1

    # -- memberships -------------------------------------------------------------
    memberships: dict[str, list[tuple[int, date, date]]] = defaultdict(list)
    for m in data["memberships"]:
        pid = person_id[m["person_key"]]
        sd, sp = parse_partial(m["start_date"])
        ed, ep = parse_partial(m["end_date"])
        current = bool(m["is_current"])
        conf = confidence(m["confidence"], m["evidence_refs"])
        existing = conn.execute(
            """SELECT id, is_locked FROM board_membership
               WHERE company_id = %s AND person_id = %s AND coalesce(start_date, '0001-01-01') = %s""",
            (company_id, pid, sd or date(1, 1, 1)),
        ).fetchone()
        values = ("current" if current else "former", sd, sp, m.get("start_date_basis"),
                  None if current else ed, None if current else ep,
                  None if current else m.get("end_reason"), m.get("board_class"), conf, m.get("notes"))
        if existing and existing["is_locked"]:
            st.skipped_locked.append(f"membership {m['person_key']} {m['start_date']}")
            mid = existing["id"]
        elif existing:
            mid = existing["id"]
            conn.execute(
                """UPDATE board_membership SET status = %s, start_date = %s, start_precision = %s, start_basis = %s,
                     end_date = %s, end_precision = %s, end_reason = %s, director_class = %s, confidence = %s,
                     notes = %s, review_status = 'reviewed'
                   WHERE id = %s""",
                (*values, mid),
            )
        else:
            mid = conn.execute(
                """INSERT INTO board_membership (company_id, person_id, status, start_date, start_precision,
                     start_basis, end_date, end_precision, end_reason, director_class, confidence, notes, review_status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'reviewed') RETURNING id""",
                (company_id, pid, *values),
            ).fetchone()["id"]
        link(m["evidence_refs"], "board_membership", mid)
        lo, _ = window(sd, sp)
        _, hi = window(ed, ep) if not current else (None, date.max)
        memberships[m["person_key"]].append((mid, lo, hi))
        st.memberships += 1

    def membership_for(person_key: str, d: date | None) -> int:
        seats = memberships[person_key]
        if d is not None:
            for mid, lo, hi in seats:
                if lo <= d <= hi:
                    return mid
        if len(seats) == 1:
            return seats[0][0]
        raise SystemExit(f"cannot place {person_key} @ {d} in a membership")

    # -- roles and independence --------------------------------------------------
    conn.execute(
        """DELETE FROM board_independence WHERE membership_id IN
             (SELECT id FROM board_membership WHERE company_id = %s AND NOT is_locked)""",
        (company_id,),
    )
    for r in data["roles"]:
        sd, sp = parse_partial(r["start_date"])
        ed, ep = parse_partial(r["end_date"])
        mid = membership_for(r["person_key"], sd)
        open_ = r["end_date"] is None
        conf = confidence(r["confidence"], r["evidence_refs"])
        if r["role"] in INDEPENDENCE_ROLES:
            iid = conn.execute(
                """INSERT INTO board_independence (membership_id, is_independent, start_date, start_precision,
                                                  end_date, end_precision, confidence, notes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (mid, INDEPENDENCE_ROLES[r["role"]], sd, sp, ed, None if open_ else ep, conf, r.get("notes")),
            ).fetchone()["id"]
            link(r["evidence_refs"], "board_independence", iid)
            st.independence += 1
            continue
        if r["role"] == "ceo_director":
            role, title = "executive_director", "Chief Executive Officer"
        elif r["role"] in LEADERSHIP_ROLES:
            role, title = r["role"], r.get("officer_title")
        else:
            continue  # e.g. non_employee_director: a status, not a leadership role
        rid = conn.execute(
            """INSERT INTO board_role (membership_id, role, officer_title, start_date, start_precision, end_date,
                                       end_precision, is_current, confidence, notes, review_status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'reviewed')
               ON CONFLICT (membership_id, role, coalesce(start_date, '0001-01-01')) DO UPDATE SET
                 officer_title = EXCLUDED.officer_title, end_date = EXCLUDED.end_date,
                 end_precision = EXCLUDED.end_precision, is_current = EXCLUDED.is_current,
                 confidence = EXCLUDED.confidence, notes = EXCLUDED.notes
               WHERE NOT board_role.is_locked
               RETURNING id""",
            (mid, role, title, sd, sp, ed, None if open_ else ep, open_, conf, r.get("notes")),
        ).fetchone()
        if rid:
            link(r["evidence_refs"], "board_role", rid["id"])
        st.roles += 1

    # -- committee rosters as partial point-in-time snapshots -----------------------
    by_filing: dict[str, list[dict]] = defaultdict(list)
    for cm in data["committees"]:
        by_filing[cm["as_of_filing"]].append(cm)
    for accession, rows in by_filing.items():
        doc_id = doc_by_accession.get(accession) or ev_doc(conn, ev_id[rows[0]["evidence_refs"][0]])
        as_of = date.fromisoformat(rows[0]["as_of_date"])
        form = conn.execute("SELECT doc_type FROM source_document WHERE id = %s", (doc_id,)).fetchone()["doc_type"]
        snap_id = conn.execute(
            """INSERT INTO board_snapshot (company_id, as_of_date, snapshot_type, source_document_id, is_complete,
                                          notes)
               VALUES (%s, %s, %s, %s, false, 'Committee assignments only')
               ON CONFLICT (company_id, source_document_id) DO UPDATE SET as_of_date = EXCLUDED.as_of_date
               RETURNING id""",
            (company_id, as_of, "prospectus" if form in ("424B4", "S-1", "S-1/A") else "proxy", doc_id),
        ).fetchone()["id"]
        conn.execute("DELETE FROM board_snapshot_member WHERE snapshot_id = %s", (snap_id,))
        per_person: dict[str, list[dict]] = defaultdict(list)
        for cm in rows:
            per_person[cm["person_key"]].append(cm)
        for pkey, cms in per_person.items():
            mid = membership_for(pkey, as_of)
            indep = conn.execute(
                """SELECT is_independent FROM board_independence WHERE membership_id = %s
                     AND (start_date IS NULL OR start_date <= %s) AND (end_date IS NULL OR end_date >= %s)
                   ORDER BY start_date DESC NULLS LAST LIMIT 1""",
                (mid, as_of, as_of),
            ).fetchone()
            conn.execute(
                """INSERT INTO board_snapshot_member (snapshot_id, person_id, membership_id, name_as_written,
                                                     is_independent, committees, evidence_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (snap_id, person_id[pkey], mid, next(p["full_name"] for p in data["people"] if p["key"] == pkey),
                 indep["is_independent"] if indep else None,
                 json.dumps([{"committee": x["committee"], "role": x["role"]} for x in cms]),
                 ev_id[cms[0]["evidence_refs"][0]]),
            )
        st.snapshots += 1

    # -- events ------------------------------------------------------------------------
    conn.execute("DELETE FROM board_event WHERE company_id = %s AND review_status <> 'disputed'", (company_id,))
    for e in data["events"]:
        d, prec = parse_partial(e["event_date"])
        pk = e.get("person_key")
        mid = None
        if pk:
            try:
                mid = membership_for(pk, d)
            except SystemExit:
                mid = None
        details = {k: e[k] for k in ("summary", "from_size", "to_size", "decision_date") if e.get(k) is not None}
        eid = conn.execute(
            """INSERT INTO board_event (company_id, person_id, membership_id, event_type, event_date,
                                        event_date_precision, announced_date, details, confidence, review_status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'reviewed') RETURNING id""",
            (company_id, person_id.get(pk) if pk else None, mid, e["type"], d, prec,
             date.fromisoformat(e["announced_date"]) if e.get("announced_date") else None,
             json.dumps(details), confidence("high", e["evidence_refs"])),
        ).fetchone()["id"]
        link(e["evidence_refs"], "board_event", eid)
        st.events += 1

    # -- coverage ----------------------------------------------------------------------
    if data.get("coverage"):
        conn.execute("DELETE FROM coverage_period WHERE company_id = %s", (company_id,))
        for cv in data["coverage"]:
            conn.execute(
                """INSERT INTO coverage_period (company_id, scope, period_start, period_end, level, method,
                                                assessed_at, assessed_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (company_id, cv["scope"], cv["period_start"], cv["period_end"], cv["level"], cv["method"],
                 datetime.fromisoformat(data["as_of"]).replace(tzinfo=UTC), f"research:{path.name}"),
            )
    return st


def upsert_person(conn: psycopg.Connection, p: dict) -> int:
    """Resolve a researched person (CIK first) and record their name forms and CIK."""
    pid = _resolve_person(conn, p)
    conn.execute(
        """INSERT INTO person_alias (person_id, alias, alias_type) VALUES (%s, %s, 'other')
           ON CONFLICT (person_id, normalized_alias) DO NOTHING""",
        (pid, p["full_name"]),
    )
    for alias in p.get("aliases", []):
        conformed = alias.split()[0].lower() == p["full_name"].split()[-1].lower()
        conn.execute(
            """INSERT INTO person_alias (person_id, alias, alias_type) VALUES (%s, %s, %s)
               ON CONFLICT (person_id, normalized_alias) DO NOTHING""",
            (pid, alias, "sec_conformed" if conformed else "other"),
        )
    if p.get("sec_cik"):
        conn.execute(
            """INSERT INTO person_identifier (scheme, value, person_id) VALUES ('sec_cik', %s, %s)
               ON CONFLICT (scheme, value) DO UPDATE SET person_id = EXCLUDED.person_id""",
            (p["sec_cik"], pid),
        )
    return pid


def _resolve_person(conn: psycopg.Connection, p: dict) -> int:
    """The same director appears in several companies' files: match on SEC CIK first, then
    on slug unless that slug belongs to someone with a different CIK (a namesake)."""
    if p.get("sec_cik"):
        row = conn.execute("SELECT person_id FROM person_identifier WHERE scheme = 'sec_cik' AND value = %s",
                           (p["sec_cik"],)).fetchone()
        if row:
            return row["person_id"]
    # Namesakes: fall back to the full legal name ("bradford-l-smith"), then a numeric suffix.
    full = re.sub(r"[^a-z0-9]+", "-", p["full_name"].lower()).strip("-")
    candidates = [p["key"]] + ([full] if full != p["key"] else []) + [f"{p['key']}-{n}" for n in range(2, 50)]
    for slug in candidates:
        row = conn.execute(
            """SELECT p.id, pi.value AS cik FROM person p
               LEFT JOIN person_identifier pi ON pi.person_id = p.id AND pi.scheme = 'sec_cik'
               WHERE p.slug = %s""", (slug,)).fetchone()
        if row is None:
            return conn.execute("INSERT INTO person (slug, full_name) VALUES (%s, %s) RETURNING id",
                                (slug, p["full_name"])).fetchone()["id"]
        if not p.get("sec_cik") or row["cik"] in (None, p["sec_cik"]):
            return row["id"]
    raise SystemExit(f"could not allocate a slug for {p['key']}")


def verify_file(path: Path) -> list[str]:
    """Check every evidence quote against the cached filing without touching the database.
    Returns a list of failures (empty when everything verifies)."""
    data = json.loads(path.read_text())
    texts = _TextCache()
    cik = data["company"]["cik"]
    failures = []
    ids = {e["id"] for e in data["evidence"]}
    for e in data["evidence"]:
        filename = e["url"].rsplit("/", 1)[-1]
        m = re.search(r"/Archives/edgar/data/(\d+)/", e["url"])
        key = rawstore.sec_key(m.group(1) if m else cik, e["accession"], filename)
        if not rawstore.exists(key):
            failures.append(f"{e['id']}: not cached at {key} (fetch with scripts/sec_fetch.py)")
            continue
        if find_quote(texts.get(key, filename), e["quote"]) < 0:
            failures.append(f"{e['id']}: quote not found verbatim in {key}: {e['quote'][:80]!r}")
        elif e.get("xml_fields") and not _verify_xml_fields(rawstore.read(key), e["xml_fields"]):
            failures.append(f"{e['id']}: xml_fields mismatch in {key}")
    for section in ("memberships", "roles", "events", "committees"):
        for i, row in enumerate(data.get(section, [])):
            for r in row.get("evidence_refs", []):
                if r not in ids:
                    failures.append(f"{section}[{i}]: unknown evidence ref {r}")
    keys = {p["key"] for p in data["people"]}
    for section in ("memberships", "roles", "committees"):
        for i, row in enumerate(data.get(section, [])):
            if row.get("person_key") not in keys:
                failures.append(f"{section}[{i}]: unknown person_key {row.get('person_key')}")
    return failures


def ev_doc(conn: psycopg.Connection, evidence_id: int) -> int:
    return conn.execute("SELECT source_document_id FROM evidence WHERE id = %s", (evidence_id,)).fetchone()[
        "source_document_id"]
