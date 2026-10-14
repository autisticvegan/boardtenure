"""Stock sales by tracked executives during their officer tenure (Form 4 code S).

Prices and share counts are restated to the latest share basis using the security's splits, so a
sale before a 10-for-1 split compares with today's price. "Value at end" is the same shares at the
last close of the tenure window: what selling avoided (if lower) or gave up (if higher).
"""

from __future__ import annotations

from decimal import Decimal

import psycopg

from bt.analytics.returns import METHODOLOGY_VERSION


def split_factor_after(splits: list[tuple], d) -> Decimal:
    """Shares per share at d expressed in the latest share basis (product of later splits)."""
    f = Decimal(1)
    for ex, ratio in splits:
        if ex > d:
            f *= ratio
    return f


def recompute(conn: psycopg.Connection) -> int:
    conn.execute("DELETE FROM executive_sales")
    windows = conn.execute(
        """SELECT etp.company_id, etp.person_id, etp.start_anchor_date AS s, etp.end_anchor_date AS e, etp.security_id,
                  etp.end_close
           FROM executive_tenure_performance etp JOIN benchmark b ON b.id = etp.benchmark_id AND b.code = 'sp500'
           WHERE etp.window_kind = 'tenure' AND etp.start_anchor_date IS NOT NULL AND etp.end_anchor_date IS NOT NULL
             AND EXISTS (SELECT 1 FROM insider_transaction t WHERE t.company_id = etp.company_id
                           AND t.person_id = etp.person_id)""").fetchall()
    splits_by_sec: dict[int, list[tuple]] = {}
    n = 0
    for w in windows:
        splits = splits_by_sec.setdefault(w["security_id"], [
            (r["ex_date"], Decimal(r["split_to"]) / Decimal(r["split_from"])) for r in conn.execute(
                """SELECT ex_date, split_from, split_to FROM corporate_action
                   WHERE security_id = %s AND action_type = 'split' ORDER BY ex_date""", (w["security_id"],))])

        rows = conn.execute(
            """SELECT accession, transaction_date, shares, price, under_10b5_1 FROM insider_transaction
               WHERE company_id = %s AND person_id = %s AND code = 'S' AND price IS NOT NULL AND price > 0
                 AND transaction_date > %s AND transaction_date <= %s""",
            (w["company_id"], w["person_id"], w["s"], w["e"])).fetchall()
        if not rows:
            continue
        shares_adj = sum(r["shares"] * split_factor_after(splits, r["transaction_date"]) for r in rows)
        proceeds = sum(r["shares"] * r["price"] for r in rows)
        plan = sum(r["shares"] * r["price"] for r in rows if r["under_10b5_1"])
        end_adj = (float(Decimal(w["end_close"]) * split_factor_after(splits, w["e"]))
                   if w["end_close"] is not None else None)
        conn.execute(
            """INSERT INTO executive_sales (company_id, person_id, window_start, window_end, sales, filings,
                 shares_sold_adj, proceeds, avg_price_adj, end_close_adj, value_at_end, plan_share, methodology_version)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (w["company_id"], w["person_id"], w["s"], w["e"], len(rows), len({r["accession"] for r in rows}),
             shares_adj, proceeds, float(proceeds / shares_adj) if shares_adj else None, end_adj,
             Decimal(str(end_adj)) * shares_adj if end_adj is not None else None,
             float(plan / proceeds) if proceeds else None, METHODOLOGY_VERSION))
        n += 1
    return n
