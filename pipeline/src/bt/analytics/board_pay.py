"""Board cost per fiscal year against the stock, for the "does director pay track performance" view.

Director pay for a year is mostly set before it starts (an annual grant at the meeting), so each
year also carries the previous fiscal year's stock vs the benchmark: the record the board had when
that pay was set.
"""

from __future__ import annotations

import statistics
from datetime import date

import psycopg

from bt.analytics.exec_pay import shares_at
from bt.analytics.returns import METHODOLOGY_VERSION, tenure_performance
from bt.ingest.prices import load_series


def recompute(conn: psycopg.Connection) -> int:
    bench = conn.execute("SELECT id, security_id FROM benchmark WHERE code = 'sp500'").fetchone()
    bench_series = load_series(conn, bench["security_id"])
    conn.execute("DELETE FROM board_pay_year")
    n = 0
    for company_id in [r["company_id"] for r in conn.execute("SELECT DISTINCT company_id FROM director_comp")]:
        sec = conn.execute(
            """SELECT s.id, coalesce(s.first_trade_date, c.ipo_date) AS listed FROM security s
               JOIN company c ON c.id = s.company_id WHERE s.company_id = %s AND s.is_primary""",
            (company_id,)).fetchone()
        series = load_series(conn, sec["id"])
        covers = [(r["as_of_date"], int(r["shares"])) for r in conn.execute(
            "SELECT as_of_date, shares FROM shares_outstanding WHERE company_id = %s ORDER BY as_of_date",
            (company_id,))]
        splits = [(r["ex_date"], float(r["split_to"] / r["split_from"])) for r in conn.execute(
            """SELECT ex_date, split_from, split_to FROM corporate_action
               WHERE security_id = %s AND action_type = 'split' ORDER BY ex_date""", (sec["id"],))]
        years = conn.execute(
            """SELECT fiscal_year, max(fiscal_year_end) AS fy_end, count(*)::int AS listed,
                      count(*) FILTER (WHERE total > 0)::int AS paid, sum(total) AS board_total,
                      array_agg(total) FILTER (WHERE total > 0) AS totals
               FROM director_comp_latest WHERE company_id = %s GROUP BY fiscal_year ORDER BY fiscal_year""",
            (company_id,)).fetchall()
        ends = {y["fiscal_year"]: y["fy_end"] for y in years}
        rel: dict[int, float | None] = {}
        rows = []
        for y in years:
            fy, end = y["fiscal_year"], y["fy_end"]
            start = ends.get(fy - 1) or date(end.year - 1, end.month, end.day)
            r = tenure_performance(series, start=start, start_precision="day", end=end, end_precision="day",
                                   is_open=False, benchmark=bench_series, listing_date=sec["listed"])
            rel[fy] = r.relative_return_pp
            shares, _ = shares_at(covers, r.start_anchor, splits)
            mcap = round(shares * r.start_close) if shares and r.start_close else None
            total = int(y["board_total"])
            rows.append((company_id, fy, end, y["listed"], y["paid"], total,
                         statistics.median(y["totals"]) if y["totals"] else None, mcap,
                         total / mcap if mcap else None, r.status, r.total_return, r.bench_total_return,
                         r.relative_return_pp))
        for row in rows:
            conn.execute(
                """INSERT INTO board_pay_year (company_id, fiscal_year, fiscal_year_end, directors_listed,
                     directors_paid,
                     board_total, median_paid, start_market_cap, pay_share_of_mcap, status, total_return,
                     bench_total_return, relative_return_pp, prior_relative_pp, methodology_version)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (*row, rel.get(row[1] - 1), METHODOLOGY_VERSION))
            n += 1
    return n
