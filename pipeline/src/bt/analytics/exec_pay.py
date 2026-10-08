"""Stock vs benchmark during executive tenures, aligned with reported pay.

Each executive's officer positions at a company merge into one span. Two windows are
measured with the board-tenure engine (returns.tenure_performance):
  * tenure: the whole span, through the latest close for current executives;
  * pay: only the fiscal years with reported pay (first paid year's start to last paid year's
    end), clipped to the span, so pay and the stock cover the same period. Proxies disclose
    pay only for the years someone was a named executive, which is often part of a tenure.
Each paid fiscal year is also measured on its own, clipped to the tenure.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

import psycopg

from bt.analytics.returns import METHODOLOGY_VERSION, Precision, TenureResult, tenure_performance, to_window
from bt.ingest.prices import load_series

# A start anchor this close to a cover date may use the next cover (IPO-anchored windows).
SHARES_LOOKAHEAD_DAYS = 120


def merge_positions(rows: list[dict]) -> dict:
    """One span per person: the earliest start and the latest end (open if any position is)."""
    first = min(rows, key=lambda r: (r["start_date"] is not None, r["start_date"] or date.min))
    current = any(r["is_current"] for r in rows)
    last = None if current else max(rows, key=lambda r: r["end_date"] or date.min)
    titles = [r["title"] for r in sorted(rows, key=lambda r: r["start_date"] or date.min)]
    return {
        "start": first["start_date"], "start_precision": first["start_precision"],
        "end": last["end_date"] if last else None, "end_precision": last["end_precision"] if last else None,
        "is_current": current, "titles": list(dict.fromkeys(titles)),
    }


def fy_start(fy_end: date) -> date:
    """The prior fiscal year end: as-of anchoring then measures from that year's last close."""
    return date(fy_end.year - 1, fy_end.month, fy_end.day)


def pay_window_start(span: dict, first_fy_end: date | None) -> tuple[date | None, Precision]:
    """Start of the pay window: the tenure start, unless the first paid fiscal year begins later."""
    if first_fy_end is None:
        return span["start"], span["start_precision"]
    w = to_window(span["start"], span["start_precision"])
    if w is None or w.last <= fy_start(first_fy_end):
        return fy_start(first_fy_end), "day"
    return span["start"], span["start_precision"]


def counted_years(paid: list[tuple[int, date]], start: date | None, end: date | None,
                  listed: date | None) -> list[int]:
    """Paid fiscal years that overlap the pay window after listing (dates, not anchors, so a
    window starting on Dec 31 doesn't pick up the year that ends that day)."""
    lo = max(d for d in (start, listed) if d is not None) if (start or listed) else date.min
    hi = end or date.max
    return [fy for fy, fy_end in paid if fy_end > lo and fy_start(fy_end) < hi]


def pay_window_end(span: dict, last_fy_end: date | None) -> tuple[date | None, Precision | None, bool]:
    """End of the pay window: the tenure end, cut at the last reported fiscal year end."""
    if last_fy_end is None:
        return span["end"], span["end_precision"], span["is_current"]
    if span["is_current"]:
        return last_fy_end, "day", False
    w = to_window(span["end"], span["end_precision"])
    if w is None or w.first > last_fy_end:
        return last_fy_end, "day", False
    return span["end"], span["end_precision"], False


def year_window(span: dict, fy_end: date) -> tuple[date, Precision, date | None, Precision | None, bool]:
    """A fiscal year clipped to the tenure, starting at the prior fiscal year end."""
    start, sp = fy_start(fy_end), "day"
    sw = to_window(span["start"], span["start_precision"])
    if sw is not None and sw.first > start:
        start, sp = span["start"], span["start_precision"]
    if span["is_current"]:
        return start, sp, fy_end, "day", False
    ew = to_window(span["end"], span["end_precision"])
    if ew is not None and ew.last < fy_end:
        return start, sp, span["end"], span["end_precision"], False
    return start, sp, fy_end, "day", False


def _shares_at(covers: list[tuple[date, int]], d: date | None) -> tuple[int | None, date | None]:
    if d is None or not covers:
        return None, None
    before = [c for c in covers if c[0] <= d]
    if before:
        return before[-1][1], before[-1][0]
    after = covers[0]
    if (after[0] - d).days <= SHARES_LOOKAHEAD_DAYS:
        return after[1], after[0]
    return None, None


_TP_COLUMNS = [
    "status", "start_anchor_date", "start_anchor_reason", "end_anchor_date", "end_anchor_reason", "start_close",
    "end_close", "calendar_days", "total_return", "annualized_return", "bench_total_return", "relative_return_pp",
    "excess_return", "annualized_excess", "max_drawdown", "return_low", "return_high", "data_through",
]


def _tp_values(r: TenureResult) -> list:
    return [r.status, r.start_anchor, r.start_anchor_reason, r.end_anchor, r.end_anchor_reason, r.start_close,
            r.end_close, r.calendar_days, r.total_return, r.annualized_return, r.bench_total_return,
            r.relative_return_pp, r.excess_return, r.annualized_excess, r.max_drawdown, r.return_low,
            r.return_high, r.data_through]


def recompute(conn: psycopg.Connection, company_ids: list[int] | None = None) -> int:
    benchmarks = [(b["id"], load_series(conn, b["security_id"]))
                  for b in conn.execute("SELECT id, security_id FROM benchmark ORDER BY id")]
    if company_ids is None:
        company_ids = [r["company_id"] for r in
                       conn.execute("SELECT DISTINCT company_id FROM executive_position ORDER BY 1")]
    n = 0
    for company_id in company_ids:
        sec = conn.execute(
            """SELECT s.id, coalesce(s.first_trade_date, c.ipo_date) AS listed FROM security s
               JOIN company c ON c.id = s.company_id WHERE s.company_id = %s AND s.is_primary""",
            (company_id,)).fetchone()
        series = load_series(conn, sec["id"]) if sec else []
        covers = [(r["as_of_date"], int(r["shares"])) for r in conn.execute(
            "SELECT as_of_date, shares FROM shares_outstanding WHERE company_id = %s ORDER BY as_of_date",
            (company_id,))]
        by_person: dict[int, list[dict]] = defaultdict(list)
        for r in conn.execute("SELECT * FROM executive_position WHERE company_id = %s", (company_id,)):
            by_person[r["person_id"]].append(r)
        paid_years = defaultdict(list)
        pay = {}
        for r in conn.execute(
                """SELECT person_id, fiscal_year, fiscal_year_end, total, stock_awards + option_awards AS equity
                   FROM executive_comp_latest WHERE company_id = %s ORDER BY fiscal_year""", (company_id,)):
            paid_years[r["person_id"]].append((r["fiscal_year"], r["fiscal_year_end"]))
            pay[(r["person_id"], r["fiscal_year"])] = (int(r["total"]), int(r["equity"]))

        conn.execute("DELETE FROM executive_tenure_performance WHERE company_id = %s", (company_id,))
        conn.execute("DELETE FROM executive_year_performance WHERE company_id = %s", (company_id,))
        listed = sec["listed"] if sec else None
        for person_id, rows in by_person.items():
            span = merge_positions(rows)
            paid = paid_years[person_id]
            pay_start, pay_start_prec = pay_window_start(span, paid[0][1] if paid else None)
            pay_end, pay_end_prec, pay_open = pay_window_end(span, paid[-1][1] if paid else None)
            windows = {
                "tenure": (span["start"], span["start_precision"], span["end"], span["end_precision"],
                           span["is_current"]),
                "pay": (pay_start, pay_start_prec, pay_end, pay_end_prec, pay_open),
            }
            sw, ew = to_window(pay_start, pay_start_prec), to_window(pay_end, pay_end_prec)
            counted = counted_years(paid, sw.first if sw else None, ew.last if ew else None, listed)
            pay_cols = [len(counted), sum(pay[(person_id, y)][0] for y in counted),
                        sum(pay[(person_id, y)][1] for y in counted), min(counted, default=None),
                        max(counted, default=None)]
            for bench_id, bench in benchmarks:
                for kind, (start, start_prec, end, end_prec, is_open) in windows.items():
                    r = tenure_performance(series, start=start, start_precision=start_prec,
                                           end=end, end_precision=end_prec, is_open=is_open, benchmark=bench,
                                           listing_date=listed)
                    shares, shares_as_of = _shares_at(covers, r.start_anchor)
                    mcap = round(shares * r.start_close) if shares and r.start_close else None
                    conn.execute(
                        f"""INSERT INTO executive_tenure_performance (company_id, person_id, benchmark_id, window_kind,
                              security_id, tenure_start, tenure_start_precision, tenure_end, tenure_end_precision,
                              is_current, titles, start_shares, start_shares_as_of, start_market_cap, pay_years,
                              pay_total, equity_awards, first_pay_year, last_pay_year,
                              methodology_version, {", ".join(_TP_COLUMNS)})
                            VALUES ({", ".join(["%s"] * (20 + len(_TP_COLUMNS)))})""",
                        [company_id, person_id, bench_id, kind, sec["id"] if sec else None, span["start"],
                         span["start_precision"], span["end"], span["end_precision"], span["is_current"],
                         span["titles"], shares, shares_as_of, mcap,
                         *(pay_cols if kind == "pay" else [None] * 5), METHODOLOGY_VERSION, *_tp_values(r)])
                    n += 1
                for fy, fy_end in paid_years[person_id]:
                    s, sp, e, ep, open_ = year_window(span, fy_end)
                    r = tenure_performance(series, start=s, start_precision=sp, end=e, end_precision=ep,
                                           is_open=open_, benchmark=bench, listing_date=listed)
                    conn.execute(
                        """INSERT INTO executive_year_performance (company_id, person_id, benchmark_id, fiscal_year,
                             status, start_anchor_date, end_anchor_date, calendar_days, total_return,
                             bench_total_return, relative_return_pp, methodology_version)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (company_id, person_id, bench_id, fy, r.status, r.start_anchor, r.end_anchor,
                         r.calendar_days, r.total_return, r.bench_total_return, r.relative_return_pp,
                         METHODOLOGY_VERSION))
    return n
