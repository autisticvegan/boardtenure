"""The daily update: incremental prices, new SEC filings, analytics, validation.

Each stage commits on its own so one failure doesn't discard the others; the job_run row
records per-stage stats and ends 'partial' if any stage or item failed.
"""

from __future__ import annotations

import json
import traceback
from datetime import date, timedelta

import psycopg

from bt.analytics import tenure
from bt.config import settings
from bt.ingest import prices, reference
from bt.quality import checks
from bt.sources.prices import provider_from_env
from bt.sources.sec import Edgar


def update_prices(conn: psycopg.Connection, today: date) -> dict:
    provider = provider_from_env()
    src = reference.source_ids(conn).get(provider.source_code)
    if src is None:
        raise SystemExit(f"source {provider.source_code!r} missing; run `bt ref init`")
    out: dict = {"provider": provider.source_code, "securities": {}}
    secs = conn.execute(
        """SELECT s.id, s.symbol, s.kind, max(p.trade_date) AS last FROM security s
           LEFT JOIN price_daily p ON p.security_id = s.id
           WHERE (s.is_primary AND s.last_trade_date IS NULL) OR s.id IN (SELECT security_id FROM benchmark)
           GROUP BY s.id""").fetchall()
    for s in secs:
        start = (s["last"] + timedelta(days=1)) if s["last"] else date(1990, 1, 1)
        if start > today:
            continue
        try:
            fetch = provider.daily(s["symbol"], s["kind"], start, today)
            doc = conn.execute(
                """INSERT INTO source_document (source_id, external_id, doc_type, url, retrieved_at, sha256,
                                                storage_uri, byte_size, content_type)
                   VALUES (%s, %s, 'price_history', %s, now(), %s, %s, %s, 'application/json')
                   ON CONFLICT (source_id, external_id) DO UPDATE SET retrieved_at = now() RETURNING id""",
                (src, fetch.raw.key, fetch.url, fetch.raw.sha256, fetch.raw.uri, fetch.raw.size),
            ).fetchone()["id"]
            bars = [b for b in fetch.bars if b.day >= start]
            prices.upsert_bars(conn, s["id"], bars, src, doc)
            changed = prices.upsert_actions(conn, s["id"], fetch.actions, src, "high", doc) if fetch.actions else 0
            prices.reindex(conn, s["id"], full=changed > 0)
            conn.commit()
            out["securities"][s["symbol"]] = len(bars)
        except Exception as e:  # one bad symbol must not stop the rest
            conn.rollback()
            out["securities"][s["symbol"]] = f"error: {e}"
            out["errors"] = out.get("errors", 0) + 1
    return out


def update_sec(conn: psycopg.Connection) -> dict:
    from bt.jobs.sec_sync import sync_company

    edgar = Edgar(settings().require_sec_user_agent())
    from bt.ingest import shares

    out: dict = {}
    for c in conn.execute("SELECT id, slug, cik FROM company WHERE cik IS NOT NULL AND status = 'public'").fetchall():
        try:
            out[c["slug"]] = sync_company(conn, edgar, c["id"], c["cik"])
            if out[c["slug"]].get("new"):
                shares.update_company(conn, edgar, c["id"], c["cik"])  # a new 10-Q/10-K may change the count
            conn.commit()
        except Exception as e:
            conn.rollback()
            out[c["slug"]] = f"error: {e}"
            out["errors"] = out.get("errors", 0) + 1
    return out


def run(conn: psycopg.Connection, *, skip_prices: bool = False, skip_sec: bool = False) -> dict:
    job_id = conn.execute(
        "INSERT INTO job_run (job_name, status, params) VALUES ('daily', 'running', %s) RETURNING id",
        (json.dumps({"skip_prices": skip_prices, "skip_sec": skip_sec}),),
    ).fetchone()["id"]
    conn.commit()
    stats: dict = {}
    failed = False
    stages = [
        ("prices", lambda: None if skip_prices else update_prices(conn, date.today())),
        ("sec", lambda: None if skip_sec else update_sec(conn)),
        ("analytics", lambda: {"tenure_rows": tenure.recompute(conn)}),
        ("quality", lambda: checks.run(conn)),
    ]
    for name, fn in stages:
        try:
            result = fn()
            conn.commit()
            stats[name] = result if result is not None else "skipped"
            failed |= isinstance(result, dict) and bool(result.get("errors"))
        except Exception:
            conn.rollback()
            stats[name] = {"error": traceback.format_exc(limit=3)}
            failed = True
    conn.execute(
        "UPDATE job_run SET status = %s, finished_at = now(), stats = %s WHERE id = %s",
        ("partial" if failed else "succeeded", json.dumps(stats, default=str), job_id),
    )
    conn.commit()
    return stats
