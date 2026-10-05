"""Materialize tenure_performance from memberships and price indexes."""

from __future__ import annotations

from collections.abc import Iterable

import psycopg

from bt.analytics.returns import METHODOLOGY_VERSION, TenureResult, tenure_performance
from bt.ingest.prices import load_series

_COLUMNS = [
    "status", "is_open", "start_anchor_date", "start_anchor_reason", "end_anchor_date", "end_anchor_reason",
    "start_close", "end_close", "calendar_days", "trading_days", "total_return", "price_return",
    "annualized_return", "bench_total_return", "bench_annualized_return", "relative_return_pp",
    "excess_return", "max_drawdown", "mdd_peak_date", "mdd_trough_date", "return_low", "return_high",
    "data_through",
]


def _values(r: TenureResult) -> list:
    return [r.status, r.is_open, r.start_anchor, r.start_anchor_reason, r.end_anchor, r.end_anchor_reason,
            r.start_close, r.end_close, r.calendar_days, r.trading_days, r.total_return, r.price_return,
            r.annualized_return, r.bench_total_return, r.bench_annualized_return, r.relative_return_pp,
            r.excess_return, r.max_drawdown, r.mdd_peak, r.mdd_trough, r.return_low, r.return_high,
            r.data_through]


def recompute(conn: psycopg.Connection, company_ids: Iterable[int] | None = None) -> int:
    """Recompute every membership of the given companies (all companies if None)
    against every benchmark. Cheap enough to rerun for every open tenure on each refresh."""
    benchmarks = [(b["id"], load_series(conn, b["security_id"]))
                  for b in conn.execute("SELECT id, security_id FROM benchmark ORDER BY id")]
    if company_ids is None:
        company_ids = [r["id"] for r in conn.execute("SELECT id FROM company ORDER BY id")]
    upsert = f"""
        INSERT INTO tenure_performance (membership_id, benchmark_id, company_id, person_id, security_id,
                                        methodology_version, computed_at, {", ".join(_COLUMNS)})
        VALUES (%s, %s, %s, %s, %s, %s, now(), {", ".join(["%s"] * len(_COLUMNS))})
        ON CONFLICT (membership_id, benchmark_id) DO UPDATE SET
          security_id = EXCLUDED.security_id, methodology_version = EXCLUDED.methodology_version,
          computed_at = now(), {", ".join(f"{c} = EXCLUDED.{c}" for c in _COLUMNS)}"""
    n = 0
    for company_id in company_ids:
        sec = conn.execute(
            """SELECT s.id, coalesce(s.first_trade_date, c.ipo_date) AS listed FROM security s
               JOIN company c ON c.id = s.company_id WHERE s.company_id = %s AND s.is_primary""",
            (company_id,)).fetchone()
        series = load_series(conn, sec["id"]) if sec else []
        members = conn.execute(
            """SELECT id, person_id, status, start_date, start_precision, end_date, end_precision
               FROM board_membership WHERE company_id = %s AND seat_type = 'director'""",
            (company_id,),
        ).fetchall()
        rows = []
        for m in members:
            for bench_id, bench_series in benchmarks:
                r = tenure_performance(
                    series,
                    start=m["start_date"], start_precision=m["start_precision"],
                    end=m["end_date"], end_precision=m["end_precision"],
                    is_open=m["status"] == "current", benchmark=bench_series,
                    listing_date=sec["listed"] if sec else None,
                )
                rows.append([m["id"], bench_id, company_id, m["person_id"], sec["id"] if sec else None,
                             METHODOLOGY_VERSION, *_values(r)])
        with conn.cursor() as cur:
            cur.executemany(upsert, rows)
        n += len(rows)
    return n
