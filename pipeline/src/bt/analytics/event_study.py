"""Market reaction to board changes (market-model event study).

For each announced board join or departure, the stock's daily total return is regressed on SPY's
over trading days [-250, -31] before the announcement; abnormal returns are actual minus predicted
on days -1, 0 and +1 (day 0 = first trading day on or after the announcement date, so news released
after a close lands on day 0 or +1). Announcements by one company on one day form one event.

Categories separate news from non-news: a mid-year appointment or resignation is a surprise to the
market; an election at the annual meeting or a decision not to stand was disclosed earlier (in the
proxy), so the meeting day carries little. CEO and other executive changes are their own category.
"""

from __future__ import annotations

import bisect
import re
from collections import defaultdict
from statistics import fmean

import psycopg

from bt.analytics.exec_pay import shares_at
from bt.analytics.returns import METHODOLOGY_VERSION
from bt.ingest.prices import load_series

EST_FIRST, EST_LAST = -250, -31
# 8-K items that are the board change itself or routine; any other item that day is other news.
ROUTINE_ITEMS = {"5.02", "5.03", "5.07", "7.01", "9.01"}
MIN_EST = 120

EXEC = re.compile(r"\b(CEO|Chief Executive|President|executive chair|Executive Chairman|co-founder|founder)\b", re.I)
ELECTED = re.compile(r"\b(elected at|annual meeting|stockholders elected|shareholders elected)\b", re.I)
NOT_STANDING = re.compile(
    r"\b(not stand|re-?election|term (ends|expires)|retire[sd]? at|did not stand|will not stand)\b", re.I)


def classify(event_type: str, summary: str, exec_seat: bool) -> str:
    if exec_seat or EXEC.search(summary or ""):
        return "exec_change"
    if event_type == "BOARD_JOIN":
        return "elected" if ELECTED.search(summary or "") else "appointed"
    return "not_standing" if NOT_STANDING.search(summary or "") else "resigned"


def market_model(ri: list[float], rm: list[float]) -> tuple[float, float, float]:
    """OLS alpha, beta and residual standard deviation."""
    mx, my = fmean(rm), fmean(ri)
    sxx = sum((x - mx) ** 2 for x in rm)
    beta = sum((x - mx) * (y - my) for x, y in zip(rm, ri, strict=True)) / sxx if sxx else 0.0
    alpha = my - beta * mx
    resid = [y - alpha - beta * x for x, y in zip(rm, ri, strict=True)]
    sigma = (sum(e * e for e in resid) / max(1, len(resid) - 2)) ** 0.5
    return alpha, beta, sigma


def recompute(conn: psycopg.Connection) -> int:
    bench = conn.execute("SELECT security_id FROM benchmark WHERE code = 'sp500'").fetchone()
    spy = {p.day: p.tr for p in load_series(conn, bench["security_id"])}
    events = conn.execute(
        """SELECT e.id, e.company_id, e.person_id, e.event_type, e.announced_date,
                  coalesce(e.details->>'summary', '') AS summary,
                  EXISTS (SELECT 1 FROM board_role r WHERE r.membership_id = e.membership_id
                            AND r.role = 'executive_director') AS exec_seat
           FROM board_event e
           WHERE e.event_type IN ('BOARD_JOIN', 'BOARD_LEAVE') AND e.announced_date IS NOT NULL""").fetchall()
    by_company: dict[int, list[dict]] = defaultdict(list)
    for e in events:
        by_company[e["company_id"]].append(e)
    conn.execute("DELETE FROM director_event")
    n = 0
    for company_id, evs in by_company.items():
        sec = conn.execute("SELECT id FROM security WHERE company_id = %s AND is_primary", (company_id,)).fetchone()
        if not sec:
            continue
        series = [p for p in load_series(conn, sec["id"]) if p.day in spy]
        days = [p.day for p in series]
        ri = [0.0] + [b.tr / a.tr - 1 for a, b in zip(series, series[1:], strict=False)]
        days_spy = [spy[d] for d in days]
        rm = [0.0] + [b / a - 1 for a, b in zip(days_spy, days_spy[1:], strict=False)]
        covers = [(r["as_of_date"], int(r["shares"])) for r in conn.execute(
            "SELECT as_of_date, shares FROM shares_outstanding WHERE company_id = %s ORDER BY as_of_date",
            (company_id,))]
        splits = [(r["ex_date"], float(r["split_to"] / r["split_from"])) for r in conn.execute(
            """SELECT ex_date, split_from, split_to FROM corporate_action
               WHERE security_id = %s AND action_type = 'split' ORDER BY ex_date""", (sec["id"],))]
        groups: dict[tuple, list[dict]] = defaultdict(list)
        for e in evs:
            i0 = bisect.bisect_left(days, e["announced_date"])
            if i0 + EST_FIRST < 1 or i0 + 1 >= len(days):
                continue  # no estimation year before it, or no trading after it yet
            groups[(i0, classify(e["event_type"], e["summary"], e["exec_seat"]))].append(e)
        day_count = defaultdict(int)
        for (i0, _), g in groups.items():
            day_count[i0] += len(g)
        for (i0, category), g in groups.items():
            est = range(i0 + EST_FIRST, i0 + EST_LAST + 1)
            if len(est) < MIN_EST:
                continue
            alpha, beta, sigma = market_model([ri[i] for i in est], [rm[i] for i in est])
            ar = [ri[i] - alpha - beta * rm[i] for i in (i0 - 1, i0, i0 + 1)]
            lo, hi = days[i0 - 1], days[i0 + 1]
            news = conn.execute(
                """SELECT bool_or(form IN ('10-Q', '10-K') OR '2.02' = ANY(items)) AS earnings,
                          bool_or(form IN ('8-K', '8-K/A') AND NOT (items <@ %s::text[])) AS other
                   FROM filing_index f JOIN company c ON c.cik::bigint = f.cik
                   WHERE c.id = %s AND f.filing_date BETWEEN %s AND %s""",
                (list(ROUTINE_ITEMS), company_id, lo, hi)).fetchone()
            shares, _ = shares_at(covers, days[i0 - 1], splits)
            mcap = round(shares * series[i0 - 1].close) if shares else None
            conn.execute(
                """INSERT INTO director_event (company_id, day0, announced_date, category, people, event_ids, summaries,
                     bundled, n_estimation, alpha, beta, sigma, ar_m1, ar_0, ar_p1, car, start_market_cap,
                     methodology_version, near_earnings, other_news)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (company_id, days[i0], min(e["announced_date"] for e in g), category,
                 sorted({e["person_id"] for e in g if e["person_id"]}), [e["id"] for e in g],
                 [e["summary"] for e in g], day_count[i0] > 1, len(est), alpha, beta, sigma, *ar, sum(ar), mcap,
                 METHODOLOGY_VERSION, bool(news["earnings"]), bool(news["other"])))
            n += 1
    return n
