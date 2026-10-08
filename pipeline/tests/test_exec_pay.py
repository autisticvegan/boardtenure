from datetime import date

from bt.analytics.exec_pay import (
    counted_years,
    fy_start,
    merge_positions,
    pay_window_end,
    pay_window_start,
    relevant_positions,
    shares_at,
    year_window,
)
from bt.ingest.seed_comp import missing_amounts

BLOCK = ("Logan Green Chief Executive Officer 2022 1 — 18,000,083 — — — 12,345 18,012,429 "
         "2021 1 — — — — — 9,871 9,872 2020 1 (2) — 1,234,567 — — — — 1,234,568")


def test_amounts_are_found_after_their_year_token():
    assert missing_amounts(BLOCK, 2022, [1, 0, 18_000_083, 0, 0, 0, 12_345, 18_012_429]) == []
    assert missing_amounts(BLOCK, 2021, [1, 0, 0, 0, 0, 0, 9_871, 9_872]) == []


def test_amount_from_another_year_does_not_verify():
    # 18,000,083 is a 2022 figure; claiming it for 2021 must fail.
    assert missing_amounts(BLOCK, 2021, [1, 0, 18_000_083, 0, 0, 0, 9_871, 9_872 + 18_000_083]) == [
        18_000_083, 18_009_955]


def test_footnote_markers_do_not_split_rows():
    assert missing_amounts(BLOCK, 2020, [1, 0, 1_234_567, 0, 0, 0, 0, 1_234_568]) == []


def pos(title, start, sp, end=None, ep=None, current=False):
    return {"title": title, "start_date": start, "start_precision": sp, "end_date": end, "end_precision": ep,
            "is_current": current}


def test_merge_positions_spans_titles():
    span = merge_positions([
        pos("President", date(2023, 1, 1), "month", date(2024, 6, 30), "day"),
        pos("Chief Operating Officer", date(2020, 3, 1), "month", date(2022, 12, 31), "day"),
    ])
    assert span["start"] == date(2020, 3, 1) and span["start_precision"] == "month"
    assert span["end"] == date(2024, 6, 30) and not span["is_current"]
    assert span["titles"] == ["Chief Operating Officer", "President"]


def test_current_position_keeps_span_open():
    span = merge_positions([pos("CFO", date(2024, 1, 1), "day", date(2024, 5, 1), "day"),
                            pos("CEO", date(2024, 5, 2), "day", current=True)])
    assert span["is_current"] and span["end"] is None


def test_pay_window_stops_at_last_reported_year():
    span = {"start": date(2023, 4, 17), "start_precision": "day", "end": None, "end_precision": None,
            "is_current": True}
    assert pay_window_end(span, date(2025, 12, 31)) == (date(2025, 12, 31), "day", False)
    left = {**span, "end": date(2024, 3, 1), "end_precision": "day", "is_current": False}
    assert pay_window_end(left, date(2025, 12, 31)) == (date(2024, 3, 1), "day", False)


def test_year_window_clips_to_tenure_and_anchors_on_prior_year_end():
    span = {"start": date(2023, 4, 17), "start_precision": "day", "end": None, "end_precision": None,
            "is_current": True}
    assert year_window(span, date(2023, 12, 31)) == (date(2023, 4, 17), "day", date(2023, 12, 31), "day", False)
    assert year_window(span, date(2024, 12, 31)) == (date(2023, 12, 31), "day", date(2024, 12, 31), "day", False)


def test_pay_window_starts_at_first_paid_year_when_tenure_began_earlier():
    span = {"start": date(2019, 7, 8), "start_precision": "day", "end": date(2025, 3, 6), "end_precision": "day",
            "is_current": False}
    assert pay_window_start(span, date(2023, 12, 31)) == (date(2022, 12, 31), "day")
    late = {**span, "start": date(2023, 5, 19)}
    assert pay_window_start(late, date(2023, 12, 31)) == (date(2023, 5, 19), "day")


def test_counted_years_skip_pre_listing_and_the_year_ending_on_the_window_start():
    paid = [(2018, date(2018, 12, 31)), (2019, date(2019, 12, 31)), (2022, date(2022, 12, 31)),
            (2023, date(2023, 12, 31))]
    assert counted_years(paid, date(2017, 12, 31), date(2023, 12, 31), date(2019, 3, 29)) == [2019, 2022, 2023]
    assert counted_years(paid, date(2022, 12, 31), date(2023, 12, 31), date(2019, 3, 29)) == [2023]


def test_shares_are_restated_across_splits():
    covers = [(date(2020, 7, 20), 186_000_000), (date(2020, 10, 19), 948_000_000)]
    splits = [(date(2020, 8, 31), 5.0)]
    # Cover before a 5-for-1 split, anchor after it: the count is in post-split units.
    assert shares_at(covers, date(2020, 9, 30), splits) == (930_000_000, date(2020, 7, 20))
    assert shares_at(covers, date(2020, 8, 28), splits) == (186_000_000, date(2020, 7, 20))
    # Only a later cover exists (IPO lookahead) and a split falls in between: divide back.
    assert shares_at([(date(2020, 10, 19), 948_000_000)], date(2020, 8, 1), splits) == (189_600_000, date(2020, 10, 19))


def test_fiscal_year_start_uses_the_actual_prior_year_end():
    prev = {date(2025, 1, 26): date(2024, 1, 28)}
    assert fy_start(date(2025, 1, 26), prev) == date(2024, 1, 28)
    assert fy_start(date(2025, 12, 31)) == date(2024, 12, 31)


def test_earlier_stint_before_paid_years_is_dropped():
    rows = [pos("CFO", date(2008, 7, 1), "month", date(2015, 11, 30), "day"),
            pos("CFO", date(2017, 3, 2), "day", date(2019, 3, 13), "day")]
    kept = relevant_positions(rows, date(2017, 12, 31))
    assert [r["start_date"] for r in kept] == [date(2017, 3, 2)]
    assert merge_positions(kept)["start"] == date(2017, 3, 2)
