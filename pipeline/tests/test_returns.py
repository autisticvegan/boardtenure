from datetime import date, timedelta

import pytest

from bt.analytics.returns import (
    Action,
    Bar,
    IndexPoint,
    annualize,
    build_indexes,
    max_drawdown,
    tenure_performance,
    to_window,
)


def weekdays(start: date, closes: list[float]) -> list[Bar]:
    """Bars on consecutive weekdays starting at `start` (a weekday)."""
    out, d = [], start
    for c in closes:
        while d.weekday() >= 5:
            d += timedelta(days=1)
        out.append(Bar(d, c))
        d += timedelta(days=1)
    return out


def test_indexes_without_actions_track_close():
    idx = build_indexes(weekdays(date(2024, 1, 1), [10, 11, 9.9]), [])
    assert [round(p.tr, 9) for p in idx] == [10, 11, 9.9]
    assert [p.pr for p in idx] == [p.tr for p in idx]


def test_split_is_return_neutral():
    # 4-for-1 split on day 3: close drops from 100 to 25 with no economic change.
    bars = weekdays(date(2024, 1, 1), [100, 100, 25, 26])
    idx = build_indexes(bars, [Action(bars[2].day, split_ratio=4.0)])
    assert idx[2].tr == pytest.approx(100)
    assert idx[3].tr == pytest.approx(104)
    assert idx[3].pr == pytest.approx(104)


def test_dividend_reinvested_in_total_return_only():
    bars = weekdays(date(2024, 1, 1), [50, 49])  # $1 dividend goes ex on day 2
    idx = build_indexes(bars, [Action(bars[1].day, cash=1.0)])
    assert idx[1].tr == pytest.approx(50)  # 49 + 1 == 50: flat total return
    assert idx[1].pr == pytest.approx(49)


def test_action_on_non_trading_day_applies_to_next_session():
    bars = [Bar(date(2024, 1, 5), 100), Bar(date(2024, 1, 8), 50)]  # Fri, Mon
    idx = build_indexes(bars, [Action(date(2024, 1, 6), split_ratio=2.0)])  # Saturday
    assert idx[1].tr == pytest.approx(100)


def test_seeded_build_matches_full_build():
    bars = weekdays(date(2024, 1, 1), [10, 11, 12, 6.5, 7])
    actions = [Action(bars[3].day, split_ratio=2.0, cash=0.1)]
    full = build_indexes(bars, actions)
    tail = build_indexes(bars, actions, seed=full[2])
    assert [(p.day, p.tr) for p in tail] == [(p.day, p.tr) for p in full[3:]]


def test_windows():
    assert to_window(date(2021, 2, 17), "day").first == date(2021, 2, 17)
    m = to_window(date(2024, 2, 1), "month")
    assert (m.first, m.last) == (date(2024, 2, 1), date(2024, 2, 29))
    y = to_window(date(2015, 1, 1), "year")
    assert (y.first, y.last) == (date(2015, 1, 1), date(2015, 12, 31))
    assert to_window(None, "unknown") is None


def test_annualize_threshold():
    assert annualize(0.5, 364) is None
    assert annualize(0.21, 730) == pytest.approx(1.21 ** (365.25 / 730) - 1)


def test_max_drawdown():
    pts = [IndexPoint(date(2024, 1, i), c, c, c) for i, c in enumerate([10, 12, 6, 11, 13, 9.1], start=1)]
    dd, peak, trough = max_drawdown(pts)
    assert dd == pytest.approx(-0.5)
    assert (peak, trough) == (date(2024, 1, 2), date(2024, 1, 3))


def series(closes: list[float], start=date(2024, 1, 1)) -> list[IndexPoint]:
    return build_indexes(weekdays(start, closes), [])


def test_weekend_join_anchors_to_prior_close():
    s = series([10, 11, 12, 13, 14, 15, 16])  # Mon 1 Jan .. Tue 9 Jan
    r = tenure_performance(s, start=date(2024, 1, 6), start_precision="day",  # Saturday
                           end=date(2024, 1, 9), end_precision="day", is_open=False)
    assert r.status == "ok"
    assert r.start_anchor == date(2024, 1, 5) and r.start_anchor_reason == "join_date"
    assert r.end_anchor == date(2024, 1, 9) and r.end_anchor_reason == "leave_date"
    assert r.total_return == pytest.approx(16 / 14 - 1)
    assert r.trading_days == 2 and r.calendar_days == 4
    assert r.annualized_return is None


def test_pre_listing_join_measures_from_first_trade():
    s = series([20, 18, 22], start=date(2019, 3, 29))
    r = tenure_performance(s, start=date(2010, 1, 1), start_precision="year",
                           end=None, end_precision=None, is_open=True)
    assert r.status == "ok"
    assert r.start_anchor == date(2019, 3, 29) and r.start_anchor_reason == "first_trade"
    assert r.end_anchor_reason == "latest_close"
    assert r.total_return == pytest.approx(0.1)


def test_left_before_listing_has_no_price_history():
    s = series([20, 18], start=date(2019, 3, 29))
    r = tenure_performance(s, start=date(2015, 1, 1), start_precision="year",
                           end=date(2018, 6, 1), end_precision="day", is_open=False)
    assert r.status == "no_price_history"


def test_imprecise_join_publishes_bounds_not_a_point():
    # Joined "in 2024-01" (month precision); left on a known day.
    s = series([10, 8, 12, 9, 10] + [10] * 25 + [15])
    r = tenure_performance(s, start=date(2024, 1, 1), start_precision="month",
                           end=s[-1].day, end_precision="day", is_open=False)
    assert r.status == "approximate"
    assert r.total_return is None
    assert r.return_low == pytest.approx(15 / 12 - 1)
    assert r.return_high == pytest.approx(15 / 8 - 1)


def test_unknown_start_date():
    r = tenure_performance(series([1, 2]), start=None, start_precision="unknown",
                           end=None, end_precision=None, is_open=True)
    assert r.status == "unknown_dates"


def test_same_session_join_and_leave_is_too_short():
    s = series([10, 11, 12])
    r = tenure_performance(s, start=date(2024, 1, 2), start_precision="day",
                           end=date(2024, 1, 2), end_precision="day", is_open=False)
    assert r.status == "too_short" and r.total_return is None


def test_benchmark_relative_return():
    stock = series([100] + [100] * 400 + [80])
    bench = series([50] + [50] * 400 + [60])
    r = tenure_performance(stock, start=stock[0].day, start_precision="day",
                           end=None, end_precision=None, is_open=True, benchmark=bench)
    assert r.total_return == pytest.approx(-0.2)
    assert r.bench_total_return == pytest.approx(0.2)
    assert r.relative_return_pp == pytest.approx(-0.4)
    assert r.excess_return == pytest.approx(0.8 / 1.2 - 1)
    assert r.annualized_return is not None and r.bench_annualized_return is not None


def test_left_in_listing_month_before_first_trade():
    # Pre-IPO director who resigned "in March 2019" when the stock first traded 2019-03-29.
    s = series([78.29, 69.01], start=date(2019, 3, 29))
    r = tenure_performance(s, start=date(2015, 5, 1), start_precision="month",
                           end=date(2019, 3, 1), end_precision="month", is_open=False)
    assert r.status == "no_price_history"
