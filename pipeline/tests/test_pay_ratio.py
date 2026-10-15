from bt.ingest.pay_ratio import find_ratio, matches


def test_matches_rounding():
    assert matches(74.8, 4_417_472, 59_057)
    assert not matches(74.8, 4_417_472, 40_000)


def test_find_ratio_verifies_against_amounts():
    text = ("CEO Pay Ratio. The median of the annual total compensation of all of our employees (except our CEO) for "
            "fiscal 2026 was $165,164, and our CEO's annual total compensation was $1,280,858, resulting in a CEO "
            "to median employee pay ratio of approximately 7.8:1.")
    r = find_ratio(text)
    assert r and r["verified"] and r["ratio"] == 7.8 and r["median_pay"] == 165_164


def test_find_ratio_unverified_without_amounts():
    r = find_ratio("Our CEO to median employee pay ratio for 2025 is 7:1.")
    assert r and not r["verified"] and r["ratio"] == 7


def test_passage_year_prefers_most_mentioned():
    from bt.ingest.pay_ratio import passage_year
    assert passage_year("For 2025: median employee in 2024 was identified; 2025 total was ...") == 2025
