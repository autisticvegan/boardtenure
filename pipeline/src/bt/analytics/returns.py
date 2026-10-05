"""Tenure return calculations.

Pure functions over in-memory series, so every published number can be reproduced
from the stored daily bars and corporate actions. The conventions are specified in
docs/methodology.md; bump METHODOLOGY_VERSION whenever one of them changes.
"""

from __future__ import annotations

import bisect
import calendar
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from itertools import pairwise
from typing import Literal

METHODOLOGY_VERSION = "2026.10.1"
MIN_ANNUALIZE_DAYS = 365
DAYS_PER_YEAR = 365.25

Precision = Literal["day", "month", "year", "unknown"]


@dataclass(frozen=True)
class Bar:
    day: date
    close: float


@dataclass(frozen=True)
class Action:
    ex_date: date
    split_ratio: float = 1.0  # new shares per old share: a 4-for-1 split is 4.0
    cash: float = 0.0  # cash dividend per share, in post-split share units


@dataclass(frozen=True)
class IndexPoint:
    day: date
    close: float
    pr: float  # price-return index (splits only)
    tr: float  # total-return index (splits and dividends reinvested at the ex-date close)


def build_indexes(
    bars: Sequence[Bar], actions: Sequence[Action], *, seed: IndexPoint | None = None
) -> list[IndexPoint]:
    """Forward price- and total-return indexes that start at the first close.

    The value of one share held at the previous close, measured at today's close, is
    split_ratio * (close + cash). An action dated on a non-trading day applies to the
    next session. With `seed` (the last stored point) only bars after it are processed,
    so an incremental refresh extends the series without rewriting history.
    """
    bars = sorted(bars, key=lambda b: b.day)
    if seed is not None:
        bars = [Bar(seed.day, seed.close)] + [b for b in bars if b.day > seed.day]
        out = [seed]
    elif bars:
        out = [IndexPoint(bars[0].day, bars[0].close, bars[0].close, bars[0].close)]
    else:
        return []

    pending = sorted((a for a in actions if a.ex_date > bars[0].day), key=lambda a: a.ex_date)
    i = 0
    for prev, cur in pairwise(bars):
        split, cash = 1.0, 0.0
        while i < len(pending) and pending[i].ex_date <= cur.day:
            split *= pending[i].split_ratio
            cash += pending[i].cash
            i += 1
        last = out[-1]
        out.append(
            IndexPoint(
                cur.day,
                cur.close,
                last.pr * split * cur.close / prev.close,
                last.tr * split * (cur.close + cash) / prev.close,
            )
        )
    return out if seed is None else out[1:]


@dataclass(frozen=True)
class Window:
    """A date known only to lie within [first, last], inclusive."""

    first: date
    last: date

    @property
    def exact(self) -> bool:
        return self.first == self.last


def to_window(d: date | None, precision: Precision | None) -> Window | None:
    if d is None or precision in (None, "unknown"):
        return None
    if precision == "day":
        return Window(d, d)
    if precision == "month":
        return Window(d.replace(day=1), d.replace(day=calendar.monthrange(d.year, d.month)[1]))
    if precision == "year":
        return Window(date(d.year, 1, 1), date(d.year, 12, 31))
    raise ValueError(f"unknown precision {precision!r}")


def asof_index(days: Sequence[date], d: date) -> int | None:
    """Index of the last trading day on or before d, or None if d precedes the series."""
    i = bisect.bisect_right(days, d) - 1
    return i if i >= 0 else None


@dataclass
class TenureResult:
    status: Literal["ok", "approximate", "too_short", "no_price_history", "unknown_dates", "history_gap"]
    is_open: bool
    start_anchor: date | None = None
    start_anchor_reason: str | None = None
    end_anchor: date | None = None
    end_anchor_reason: str | None = None
    start_close: float | None = None
    end_close: float | None = None
    calendar_days: int | None = None
    trading_days: int | None = None
    total_return: float | None = None
    price_return: float | None = None
    annualized_return: float | None = None
    bench_total_return: float | None = None
    bench_annualized_return: float | None = None
    relative_return_pp: float | None = None
    excess_return: float | None = None
    max_drawdown: float | None = None
    mdd_peak: date | None = None
    mdd_trough: date | None = None
    return_low: float | None = None
    return_high: float | None = None
    data_through: date | None = None


def annualize(total_return: float, calendar_days: int) -> float | None:
    """Geometric annualization; None for windows shorter than a year, where it misleads."""
    if calendar_days < MIN_ANNUALIZE_DAYS:
        return None
    return (1.0 + total_return) ** (DAYS_PER_YEAR / calendar_days) - 1.0


def max_drawdown(points: Sequence[IndexPoint]) -> tuple[float, date | None, date | None]:
    """Largest peak-to-trough decline of the total-return index (<= 0)."""
    worst, peak_pt, worst_peak, worst_trough = 0.0, None, None, None
    for p in points:
        if peak_pt is None or p.tr > peak_pt.tr:
            peak_pt = p
        dd = p.tr / peak_pt.tr - 1.0
        if dd < worst:
            worst, worst_peak, worst_trough = dd, peak_pt.day, p.day
    return worst, worst_peak, worst_trough


def _start_candidates(days: Sequence[date], w: Window) -> tuple[list[int], str]:
    """Possible start anchors for a join window, with the anchor reason."""
    first_trade = days[0]
    if w.last < first_trade:
        return [0], "first_trade"  # joined before listing: measure from the first close
    lo = asof_index(days, w.first)
    hi = asof_index(days, w.last)
    if w.exact:
        return [hi], "join_date"
    return list(range(0 if lo is None else lo, hi + 1)), "join_window"


def _end_candidates(days: Sequence[date], w: Window) -> tuple[list[int], str]:
    hi = asof_index(days, w.last)
    lo = asof_index(days, w.first)
    if w.exact:
        return [hi], ("leave_date" if w.last <= days[-1] else "last_trade")
    return list(range(0 if lo is None else lo, hi + 1)), "leave_window"


def tenure_performance(
    series: Sequence[IndexPoint],
    *,
    start: date | None,
    start_precision: Precision,
    end: date | None,
    end_precision: Precision | None,
    is_open: bool,
    benchmark: Sequence[IndexPoint] = (),
    listing_date: date | None = None,
) -> TenureResult:
    """Return statistics for one board tenure. See docs/methodology.md for the rules.

    `listing_date` is the security's first trade date. When stored prices begin later than
    that, a tenure starting before them is a gap in our data (`history_gap`), not a
    pre-listing join, and must not be measured from the first stored close."""
    res = TenureResult(status="ok", is_open=is_open)
    if not series:
        res.status = "history_gap"  # no stored prices yet; not the same as leaving before listing
        return res
    days = [p.day for p in series]
    res.data_through = days[-1]

    sw = to_window(start, start_precision)
    if sw is None:
        res.status = "unknown_dates"
        return res
    has_gap = listing_date is not None and (days[0] - listing_date).days > 7
    if has_gap and sw.first < days[0]:
        res.status = "history_gap"
        return res

    if is_open:
        ends, res.end_anchor_reason = [len(series) - 1], "latest_close"
    else:
        ew = to_window(end, end_precision)
        if ew is None:
            res.status = "unknown_dates"
            return res
        if ew.last < days[0]:
            res.status = "no_price_history"  # left the board before the stock listed
            return res
        ends, res.end_anchor_reason = _end_candidates(days, ew)

    starts, res.start_anchor_reason = _start_candidates(days, sw)

    if len(starts) == 1 and len(ends) == 1:
        s, e = starts[0], ends[0]
        res.start_anchor, res.end_anchor = days[s], days[e]
        res.start_close, res.end_close = series[s].close, series[e].close
        if e <= s:
            # Left no later than the first session of a listing they joined beforehand.
            res.status = "no_price_history" if res.start_anchor_reason == "first_trade" and e == 0 else "too_short"
            return res
        _fill_exact(res, series, s, e, benchmark)
        return res

    # A date is only known to a window: publish bounds, never a falsely precise point.
    res.status = "approximate"
    pairs_ok = max(starts) < min(ends)
    if pairs_ok:
        lo_val = min(series[e].tr for e in ends) / max(series[s].tr for s in starts)
        hi_val = max(series[e].tr for e in ends) / min(series[s].tr for s in starts)
    else:
        ratios = [series[e].tr / series[s].tr for s in starts for e in ends if e > s]
        if not ratios:
            res.status = "too_short"
            return res
        lo_val, hi_val = min(ratios), max(ratios)
    res.return_low, res.return_high = lo_val - 1.0, hi_val - 1.0
    if len(starts) == 1:
        res.start_anchor, res.start_close = days[starts[0]], series[starts[0]].close
    if len(ends) == 1:
        res.end_anchor, res.end_close = days[ends[0]], series[ends[0]].close
    return res


def _fill_exact(
    res: TenureResult, series: Sequence[IndexPoint], s: int, e: int, benchmark: Sequence[IndexPoint]
) -> None:
    a, b = series[s], series[e]
    res.calendar_days = (b.day - a.day).days
    res.trading_days = e - s
    res.total_return = b.tr / a.tr - 1.0
    res.price_return = b.pr / a.pr - 1.0
    res.annualized_return = annualize(res.total_return, res.calendar_days)
    res.max_drawdown, res.mdd_peak, res.mdd_trough = max_drawdown(series[s : e + 1])

    if not benchmark:
        return
    bdays = [p.day for p in benchmark]
    bs, be = asof_index(bdays, a.day), asof_index(bdays, b.day)
    if bs is None or be is None or bdays[bs] != a.day:
        return  # benchmark history does not cover the start anchor
    res.bench_total_return = benchmark[be].tr / benchmark[bs].tr - 1.0
    res.bench_annualized_return = annualize(res.bench_total_return, res.calendar_days)
    res.relative_return_pp = res.total_return - res.bench_total_return
    res.excess_return = (1.0 + res.total_return) / (1.0 + res.bench_total_return) - 1.0
