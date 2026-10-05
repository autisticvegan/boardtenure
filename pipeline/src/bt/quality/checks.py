"""Data-quality checks.

Each check is a query that returns findings. The runner upserts them into data_issue by
fingerprint, so re-running is idempotent. A finding that stops firing is marked resolved.
Priority follows the coverage rule: 1 = current board, 2 = directors who left in the last
five years, 3 = everything older.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import psycopg
from psycopg.rows import tuple_row

# Shared SQL fragment: priority tier of a membership row aliased `m`.
PRIORITY = """CASE WHEN m.status = 'current' THEN 1
                   WHEN m.end_date >= current_date - interval '5 years' THEN 2 ELSE 3 END"""


@dataclass(frozen=True)
class Check:
    code: str
    severity: str  # error | warning | info
    sql: str  # must select: key, priority, company_id, person_id, subject_type, subject_id, message, details


CHECKS: list[Check] = [
    Check("membership_end_before_start", "error", f"""
        SELECT m.id::text AS key, {PRIORITY} AS priority, m.company_id, m.person_id,
               'board_membership' AS subject_type, m.id AS subject_id,
               p.full_name || ': departure precedes appointment' AS message,
               json_build_object('start', m.start_date, 'end', m.end_date) AS details
        FROM board_membership m JOIN person p ON p.id = m.person_id
        WHERE bt_window_end(m.end_date, m.end_precision) < bt_window_start(m.start_date, m.start_precision)"""),

    Check("overlapping_memberships", "error", f"""
        SELECT a.id || '-' || b.id AS key, {PRIORITY.replace('m.', 'a.')} AS priority, a.company_id, a.person_id,
               'board_membership' AS subject_type, a.id AS subject_id,
               p.full_name || ': two seats at the same company overlap in time' AS message,
               json_build_object('a', a.id, 'b', b.id) AS details
        FROM board_membership a
        JOIN board_membership b ON b.company_id = a.company_id AND b.person_id = a.person_id AND b.id > a.id
        JOIN person p ON p.id = a.person_id
        WHERE coalesce(bt_window_start(a.start_date, a.start_precision), '-infinity')
                <= coalesce(bt_window_end(b.end_date, b.end_precision), 'infinity')
          AND coalesce(bt_window_start(b.start_date, b.start_precision), '-infinity')
                <= coalesce(bt_window_end(a.end_date, a.end_precision), 'infinity')
          AND NOT (a.end_precision IN ('month', 'year') OR b.start_precision IN ('month', 'year'))"""),

    Check("current_director_no_start_date", "warning", """
        SELECT m.id::text, 1, m.company_id, m.person_id, 'board_membership', m.id,
               p.full_name || ': current director with no established start date',
               '{}'::json
        FROM board_membership m JOIN person p ON p.id = m.person_id
        WHERE m.status = 'current' AND m.start_precision = 'unknown'"""),

    Check("current_director_low_confidence", "warning", """
        SELECT m.id::text, 1, m.company_id, m.person_id, 'board_membership', m.id,
               p.full_name || ': current seat rests on low-confidence evidence', '{}'::json
        FROM board_membership m JOIN person p ON p.id = m.person_id
        WHERE m.status = 'current' AND m.confidence = 'low'"""),

    Check("membership_without_evidence", "error", f"""
        SELECT m.id::text, {PRIORITY}, m.company_id, m.person_id, 'board_membership', m.id,
               p.full_name || ': board seat has no linked source', '{{}}'::json
        FROM board_membership m JOIN person p ON p.id = m.person_id
        WHERE NOT EXISTS (SELECT 1 FROM evidence_link el
                          WHERE el.subject_type = 'board_membership' AND el.subject_id = m.id)"""),

    Check("current_director_no_sec_identity", "info", """
        SELECT m.id::text, 1, m.company_id, m.person_id, 'person', p.id,
               p.full_name || ': no SEC reporting-owner CIK linked (expected from Form 3)', '{}'::json
        FROM board_membership m JOIN person p ON p.id = m.person_id
        JOIN company c ON c.id = m.company_id
        WHERE m.status = 'current' AND c.cik IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM person_identifier pi WHERE pi.person_id = p.id AND pi.scheme = 'sec_cik')"""),

    Check("role_outside_membership", "error", f"""
        SELECT r.id::text, {PRIORITY}, m.company_id, m.person_id, 'board_role', r.id,
               p.full_name || ': role dates fall outside the board seat', '{{}}'::json
        FROM board_role r JOIN board_membership m ON m.id = r.membership_id JOIN person p ON p.id = m.person_id
        WHERE bt_window_end(r.start_date, r.start_precision) < bt_window_start(m.start_date, m.start_precision)
           OR (m.end_date IS NOT NULL AND
               bt_window_start(r.start_date, r.start_precision) > bt_window_end(m.end_date, m.end_precision))"""),

    Check("current_role_on_former_seat", "error", f"""
        SELECT r.id::text, {PRIORITY}, m.company_id, m.person_id, 'board_role', r.id,
               p.full_name || ': role marked current on a former seat', '{{}}'::json
        FROM board_role r JOIN board_membership m ON m.id = r.membership_id JOIN person p ON p.id = m.person_id
        WHERE r.is_current AND m.status = 'former'"""),

    Check("board_size_mismatch", "warning", """
        WITH stated AS (
          SELECT DISTINCT ON (company_id) company_id, event_date, (details->>'to_size')::int AS size
          FROM board_event WHERE event_type = 'BOARD_SIZE_CHANGE' AND details ? 'to_size'
            AND event_date <= current_date
          ORDER BY company_id, event_date DESC),
        cur AS (SELECT company_id, count(*) AS n FROM board_membership
                WHERE status = 'current' AND seat_type = 'director' GROUP BY company_id)
        SELECT s.company_id::text, 1, s.company_id, NULL::bigint, 'company', s.company_id,
               'Current director count (' || coalesce(c.n, 0) || ') differs from last stated board size ('
                 || s.size || ' as of ' || s.event_date || ')',
               json_build_object('current', c.n, 'stated', s.size, 'as_of', s.event_date)
        FROM stated s LEFT JOIN cur c ON c.company_id = s.company_id
        WHERE coalesce(c.n, 0) <> s.size
          AND NOT EXISTS (SELECT 1 FROM board_event e WHERE e.company_id = s.company_id
                          AND e.event_type IN ('BOARD_JOIN', 'BOARD_LEAVE') AND e.event_date > s.event_date)"""),

    Check("unverified_quote", "warning", """
        SELECT e.id::text, 2, d.company_id, NULL::bigint, 'board_membership', NULL::bigint,
               'Evidence quote not found verbatim in ' || d.doc_type || ' ' || d.external_id,
               json_build_object('evidence_id', e.id, 'url', d.url)
        FROM evidence e JOIN source_document d ON d.id = e.source_document_id
        WHERE e.quote_verified IS FALSE"""),

    Check("possible_duplicate_person", "warning", """
        SELECT a.id || '-' || b.id, 2, NULL::bigint, a.id, 'person', a.id,
               'Possible duplicate people: ' || a.full_name || ' / ' || b.full_name,
               json_build_object('a', a.slug, 'b', b.slug, 'similarity', round(similarity(a.normalized_name, b.normalized_name)::numeric, 2))
        FROM person a JOIN person b ON b.id > a.id
        WHERE a.merged_into_person_id IS NULL AND b.merged_into_person_id IS NULL
          AND similarity(a.normalized_name, b.normalized_name) > 0.6
          AND NOT EXISTS (SELECT 1 FROM person_identifier x JOIN person_identifier y
                            ON x.scheme = y.scheme AND x.value <> y.value
                          WHERE x.person_id = a.id AND y.person_id = b.id AND x.scheme = 'sec_cik')"""),

    Check("price_jump_without_action", "warning", """
        WITH r AS (
          SELECT security_id, trade_date, close,
                 lag(close) OVER (PARTITION BY security_id ORDER BY trade_date) AS prev
          FROM price_daily)
        SELECT r.security_id || ':' || r.trade_date, 2, s.company_id, NULL::bigint, 'company', s.company_id,
               s.symbol || ' moved ' || round((r.close / r.prev - 1) * 100, 1) || '% on ' || r.trade_date
                 || ' with no corporate action recorded (possible unrecorded split)',
               json_build_object('prev', r.prev, 'close', r.close)
        FROM r JOIN security s ON s.id = r.security_id
        WHERE r.prev IS NOT NULL AND (r.close / r.prev > 1.9 OR r.close / r.prev < 0.52)
          AND NOT EXISTS (SELECT 1 FROM corporate_action ca WHERE ca.security_id = r.security_id
                          AND ca.ex_date = r.trade_date)"""),

    Check("missing_trading_days", "warning", """
        WITH bench AS (SELECT security_id FROM benchmark WHERE is_default),
        span AS (SELECT p.security_id, min(trade_date) AS lo, max(trade_date) AS hi FROM price_daily p
                 JOIN security s ON s.id = p.security_id WHERE s.is_primary GROUP BY p.security_id),
        missing AS (
          SELECT sp.security_id, b.trade_date FROM span sp
          JOIN price_daily b ON b.security_id = (SELECT security_id FROM bench) AND b.trade_date BETWEEN sp.lo AND sp.hi
          WHERE NOT EXISTS (SELECT 1 FROM price_daily p WHERE p.security_id = sp.security_id
                            AND p.trade_date = b.trade_date))
        SELECT m.security_id::text, 2, s.company_id, NULL::bigint, 'company', s.company_id,
               s.symbol || ': ' || count(*) || ' benchmark trading days missing from price history',
               json_build_object('first_missing', min(m.trade_date), 'count', count(*))
        FROM missing m JOIN security s ON s.id = m.security_id GROUP BY m.security_id, s.company_id, s.symbol"""),

    Check("stale_prices", "warning", """
        WITH latest AS (SELECT security_id, max(trade_date) AS d FROM price_daily GROUP BY security_id),
        bench AS (SELECT max(trade_date) AS d FROM price_daily
                  WHERE security_id = (SELECT security_id FROM benchmark WHERE is_default))
        SELECT s.id::text, 1, s.company_id, NULL::bigint, 'company', s.company_id,
               s.symbol || ' prices end ' || l.d || ', behind the benchmark (' || b.d || ')', '{}'::json
        FROM security s JOIN latest l ON l.security_id = s.id, bench b
        WHERE s.is_primary AND s.last_trade_date IS NULL AND l.d < b.d"""),

    Check("stale_benchmark", "warning", """
        SELECT 'bench', 1, NULL::bigint, NULL::bigint, 'company', NULL::bigint,
               'Benchmark prices are more than 4 days old (latest ' || max(trade_date) || ')', '{}'::json
        FROM price_daily WHERE security_id = (SELECT security_id FROM benchmark WHERE is_default)
        HAVING max(trade_date) < current_date - 4"""),

    Check("stale_tenure_analytics", "warning", """
        SELECT tp.company_id::text, 1, tp.company_id, NULL::bigint, 'company', tp.company_id,
               'Tenure returns computed through ' || min(tp.data_through) || ' but prices run to ' || max(l.d),
               '{}'::json
        FROM tenure_performance tp
        JOIN LATERAL (SELECT max(trade_date) AS d FROM price_daily WHERE security_id = tp.security_id) l ON true
        WHERE tp.is_open AND tp.data_through < l.d GROUP BY tp.company_id"""),

    Check("pending_board_filing", "warning", """
        SELECT f.accession_number, 1, f.company_id, NULL::bigint, 'company', f.company_id,
               f.form_type || ' filed ' || f.filing_date || ' may change the board; needs review',
               json_build_object('accession', f.accession_number, 'items', f.items)
        FROM sec_filing f WHERE f.processing_status = 'needs_review'"""),

    Check("unresolved_insider_director", "warning", """
        SELECT x.id::text, 1, x.company_id, x.resolved_person_id, 'extracted_fact', x.id,
               coalesce(x.person_name, '?') || ' reported as a director on Form ' || (x.payload->>'form')
                 || ' but has no current seat on record',
               x.payload::json
        FROM extracted_fact x
        WHERE x.fact_type = 'insider_relationship' AND x.status = 'needs_review'"""),
]


def run(conn: psycopg.Connection) -> dict[str, int]:
    seen: set[str] = set()
    counts: dict[str, int] = {}
    for check in CHECKS:
        # Positional rows: check queries don't alias every column.
        with conn.cursor(row_factory=tuple_row) as cur:
            rows = cur.execute(check.sql).fetchall()
        counts[check.code] = len(rows)
        for key, priority, company_id, person_id, subject_type, subject_id, message, details in rows:
            fp = f"{check.code}:{key}"
            seen.add(fp)
            conn.execute(
                """INSERT INTO data_issue (check_code, fingerprint, severity, priority, company_id, person_id,
                                           subject_type, subject_id, message, details)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (fingerprint) DO UPDATE SET last_seen_at = now(), message = EXCLUDED.message,
                     details = EXCLUDED.details, priority = EXCLUDED.priority,
                     status = CASE WHEN data_issue.status = 'resolved' THEN 'open' ELSE data_issue.status END,
                     resolved_at = CASE WHEN data_issue.status = 'resolved' THEN NULL ELSE data_issue.resolved_at END""",
                (check.code, fp, check.severity, priority, company_id, person_id, subject_type, subject_id,
                 message, json.dumps(details) if not isinstance(details, str) else details),
            )
    # Anything previously open that no check reported this run is resolved.
    resolved = conn.execute(
        """UPDATE data_issue SET status = 'resolved', resolved_at = now(), resolved_by = 'pipeline:quality',
                                 resolution_note = 'check no longer fires'
           WHERE status IN ('open', 'acknowledged') AND NOT (fingerprint = ANY(%s))""",
        (list(seen),),
    ).rowcount
    counts["_resolved"] = resolved
    return counts
