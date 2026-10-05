"""Daily price storage and total-return index maintenance."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import psycopg

from bt.analytics.returns import Action, Bar, IndexPoint, build_indexes


@dataclass(frozen=True)
class PriceBar:
    day: date
    open: float | None
    high: float | None
    low: float | None
    close: float
    volume: int | None
    vendor_adj_close: float | None = None


@dataclass(frozen=True)
class CorporateAction:
    ex_date: date
    action_type: str  # 'split' | 'cash_dividend' | 'special_dividend'
    split_from: float | None = None
    split_to: float | None = None
    cash_amount: float | None = None
    pay_date: date | None = None
    record_date: date | None = None


def read_bars_csv(path: Path) -> list[PriceBar]:
    """CSV with header date,open,high,low,close[,adj_close],volume[,...]."""
    def num(v: str | None) -> float | None:
        return float(v) if v not in (None, "", "null") else None

    out = []
    with path.open(newline="") as f:
        for r in csv.DictReader(f):
            out.append(PriceBar(date.fromisoformat(r["date"]), num(r.get("open")), num(r.get("high")),
                                num(r.get("low")), float(r["close"]),
                                int(float(r["volume"])) if r.get("volume") else None,
                                num(r.get("adj_close"))))
    return out


def read_actions_csv(path: Path) -> list[CorporateAction]:
    """CSV with header ex_date,action_type,cash_amount,record_date,pay_date,split_from,split_to."""
    def d(v: str | None) -> date | None:
        return date.fromisoformat(v) if v else None

    def f(v: str | None) -> float | None:
        return float(v) if v else None

    with path.open(newline="") as fh:
        return [CorporateAction(date.fromisoformat(r["ex_date"]), r["action_type"], f(r.get("split_from")),
                                f(r.get("split_to")), f(r.get("cash_amount")), d(r.get("pay_date")),
                                d(r.get("record_date"))) for r in csv.DictReader(fh)]


def upsert_bars(conn: psycopg.Connection, security_id: int, bars: list[PriceBar], source_id: int,
                source_document_id: int | None = None) -> int:
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO price_daily (security_id, trade_date, open, high, low, close, volume,
                                        vendor_adj_close, source_id, source_document_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (security_id, trade_date) DO UPDATE SET
                 open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
                 volume = EXCLUDED.volume, vendor_adj_close = EXCLUDED.vendor_adj_close,
                 source_id = EXCLUDED.source_id, source_document_id = EXCLUDED.source_document_id,
                 ingested_at = now(),
                 -- a changed close invalidates the stored indexes from this day on
                 pr_index = CASE WHEN price_daily.close = EXCLUDED.close THEN price_daily.pr_index END,
                 tr_index = CASE WHEN price_daily.close = EXCLUDED.close THEN price_daily.tr_index END""",
            [(security_id, b.day, b.open, b.high, b.low, b.close, b.volume, b.vendor_adj_close,
              source_id, source_document_id) for b in bars],
        )
    return len(bars)


def upsert_actions(conn: psycopg.Connection, security_id: int, actions: list[CorporateAction],
                   source_id: int, confidence: str, source_document_id: int | None = None) -> int:
    """Insert/refresh corporate actions; returns how many rows were new or changed."""
    changed = 0
    for a in actions:
        row = conn.execute(
            """INSERT INTO corporate_action (security_id, action_type, ex_date, record_date, pay_date,
                                             split_from, split_to, cash_amount, currency, source_id,
                                             source_document_id, confidence)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'USD', %s, %s, %s)
               ON CONFLICT (security_id, action_type, ex_date) DO UPDATE SET
                 split_from = EXCLUDED.split_from, split_to = EXCLUDED.split_to,
                 cash_amount = EXCLUDED.cash_amount, record_date = EXCLUDED.record_date,
                 pay_date = EXCLUDED.pay_date, source_id = EXCLUDED.source_id,
                 source_document_id = EXCLUDED.source_document_id, confidence = EXCLUDED.confidence
               WHERE (corporate_action.split_from, corporate_action.split_to, corporate_action.cash_amount)
                     IS DISTINCT FROM (EXCLUDED.split_from, EXCLUDED.split_to, EXCLUDED.cash_amount)
               RETURNING id""",
            (security_id, a.action_type, a.ex_date, a.record_date, a.pay_date, a.split_from, a.split_to,
             a.cash_amount, source_id, source_document_id, confidence),
        ).fetchone()
        changed += row is not None
    return changed


def load_actions(conn: psycopg.Connection, security_id: int) -> list[Action]:
    rows = conn.execute(
        """SELECT ex_date, action_type, split_from, split_to, cash_amount FROM corporate_action
           WHERE security_id = %s AND action_type IN ('split', 'cash_dividend', 'special_dividend')
           ORDER BY ex_date""",
        (security_id,),
    )
    out = []
    for r in rows:
        if r["action_type"] == "split":
            out.append(Action(r["ex_date"], split_ratio=float(r["split_to"]) / float(r["split_from"])))
        else:
            out.append(Action(r["ex_date"], cash=float(r["cash_amount"])))
    return out


def reindex(conn: psycopg.Connection, security_id: int, *, full: bool = False) -> int:
    """(Re)build pr_index/tr_index. Incremental from the last indexed day unless `full`,
    or unless an earlier row lost its index because its close changed."""
    seed = None
    if not full:
        gap = conn.execute(
            """SELECT min(trade_date) AS d FROM price_daily WHERE security_id = %s AND tr_index IS NULL""",
            (security_id,),
        ).fetchone()["d"]
        if gap is None:
            return 0
        row = conn.execute(
            """SELECT trade_date, close, pr_index, tr_index FROM price_daily
               WHERE security_id = %s AND trade_date < %s AND tr_index IS NOT NULL
               ORDER BY trade_date DESC LIMIT 1""",
            (security_id, gap),
        ).fetchone()
        if row:
            seed = IndexPoint(row["trade_date"], float(row["close"]), row["pr_index"], row["tr_index"])
    since = seed.day if seed else date.min
    bars = [Bar(r["trade_date"], float(r["close"])) for r in conn.execute(
        "SELECT trade_date, close FROM price_daily WHERE security_id = %s AND trade_date >= %s ORDER BY trade_date",
        (security_id, since))]
    points = build_indexes(bars, load_actions(conn, security_id), seed=seed)
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE price_daily SET pr_index = %s, tr_index = %s WHERE security_id = %s AND trade_date = %s",
            [(p.pr, p.tr, security_id, p.day) for p in points],
        )
    return len(points)


def load_series(conn: psycopg.Connection, security_id: int) -> list[IndexPoint]:
    return [IndexPoint(r["trade_date"], float(r["close"]), r["pr_index"], r["tr_index"]) for r in conn.execute(
        """SELECT trade_date, close, pr_index, tr_index FROM price_daily
           WHERE security_id = %s AND tr_index IS NOT NULL ORDER BY trade_date""",
        (security_id,))]
