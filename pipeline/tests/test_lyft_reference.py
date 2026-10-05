"""Reference check: every Lyft tenure number the site shows, recomputed independently.

Independent of the pipeline's code path: anchors are found with a plain linear scan,
LYFT returns come straight from raw closes (it has never split or paid a dividend),
and SPY returns use the price-verification step's separately computed adjusted
closes (back-adjusted from State Street's distribution file). Requires the local dev
database and the prototype price files; skipped otherwise.
"""

import csv
import json
from datetime import date

import pytest

from bt.config import REPO_ROOT

PRICES = REPO_ROOT / "data" / "seed" / "prices"
SEED = REPO_ROOT / "data" / "seed" / "lyft_board_research.json"

# Published reference points (citations in docs/research/price-data-verification.md).
SPOT_CLOSES = {date(2019, 3, 29): 78.29, date(2023, 5, 24): 7.99, date(2026, 10, 2): 15.46}


def _csv(name: str) -> dict[date, dict]:
    with (PRICES / name).open() as f:
        return {date.fromisoformat(r["date"]): r for r in csv.DictReader(f)}


def _asof(days: list[date], d: date) -> date | None:
    best = None
    for x in days:  # deliberately naive
        if x <= d:
            best = x
    return best


@pytest.fixture(scope="module")
def db_rows():
    psycopg = pytest.importorskip("psycopg")
    if not (PRICES / "LYFT.csv").exists() or not SEED.exists():
        pytest.skip("prototype price files not present")
    from bt.db import connect

    try:
        conn = connect("test:reference")
    except psycopg.OperationalError:
        pytest.skip("dev database not available")
    rows = conn.execute(
        """SELECT p.slug, m.status AS seat_status, m.start_date, m.start_precision, m.end_date, tp.*
           FROM tenure_performance tp JOIN board_membership m ON m.id = tp.membership_id
           JOIN person p ON p.id = m.person_id JOIN company c ON c.id = m.company_id
           WHERE c.slug = 'lyft'""").fetchall()
    conn.close()
    return rows


def test_spot_closes():
    if not (PRICES / "LYFT.csv").exists():
        pytest.skip("prototype price files not present")
    lyft = _csv("LYFT.csv")
    for d, close in SPOT_CLOSES.items():
        assert float(lyft[d]["close"]) == pytest.approx(close, abs=0.005), d
    assert min(lyft, key=lambda d: float(lyft[d]["close"])) == date(2023, 5, 24)


def test_every_lyft_tenure_matches_independent_computation(db_rows):
    lyft, spy = _csv("LYFT.csv"), _csv("SPY.csv")
    days = sorted(lyft)
    first, last = days[0], days[-1]
    seed = json.loads(SEED.read_text())
    assert len(db_rows) == len(seed["memberships"])
    checked = 0
    for r in db_rows:
        if r["end_date"] and r["end_date"] <= first:
            assert r["status"] == "no_price_history", r["slug"]  # left before listing
            continue
        assert r["status"] == "ok", r["slug"]
        start = first if r["start_date"] < first else _asof(days, r["start_date"])
        end = last if r["end_date"] is None else _asof(days, r["end_date"])
        assert r["start_anchor_date"] == start, r["slug"]
        assert r["end_anchor_date"] == end, r["slug"]
        expected = float(lyft[end]["close"]) / float(lyft[start]["close"]) - 1
        assert r["total_return"] == pytest.approx(expected, abs=1e-9), r["slug"]
        spy_expected = float(spy[end]["adj_close"]) / float(spy[start]["adj_close"]) - 1
        # adj_close is published to 4 decimals; allow that rounding.
        assert r["bench_total_return"] == pytest.approx(spy_expected, abs=2e-5), r["slug"]
        assert r["relative_return_pp"] == pytest.approx(expected - spy_expected, abs=2e-5), r["slug"]
        days_held = (end - start).days
        if days_held >= 365:
            assert r["annualized_return"] == pytest.approx((1 + expected) ** (365.25 / days_held) - 1, abs=1e-9)
        else:
            assert r["annualized_return"] is None
        window = [float(lyft[d]["close"]) for d in days if start <= d <= end]
        peak, mdd = window[0], 0.0
        for c in window:
            peak = max(peak, c)
            mdd = min(mdd, c / peak - 1)
        assert r["max_drawdown"] == pytest.approx(mdd, abs=1e-9), r["slug"]
        checked += 1
    assert checked >= 16
