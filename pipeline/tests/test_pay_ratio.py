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


def test_find_ratio_prefers_the_reported_ceo_total():
    text = ("CEO Pay Ratio. Our CEO's annualized compensation was $2,000,000 and his reported total compensation was "
            "$1,000,000. The median employee's annual total compensation was $50,000, and the median employee "
            "working part time earned $25,000. The ratio of CEO pay to median employee pay was 40 to 1.")
    # both $2.0M/$50K and $1.0M/$25K give 40:1; the Summary Compensation Table total decides
    r = find_ratio(text, known_ceo_pay=(1_000_000.0,))
    assert r and r["ceo_pay"] == 1_000_000 and r["median_pay"] == 25_000
    r = find_ratio(text)
    assert r and r["verified"] and r["ratio"] == 40


def test_find_ratio_skips_an_unrelated_table_before_the_disclosure():
    table = "Other Benefits $31,451 $20,876 $23,455 Total $2,854,753 " + "x " * 120
    disclosure = ("CEO Pay Ratio. For 2024 the ratio of our annual total CEO compensation to the median annual total "
                  "compensation of all our employees was 121 to 1. The median employee's annual total compensation "
                  "was $60,000, and Mr. Smith's annual total compensation was $7,260,000.")
    r = find_ratio(table + disclosure, known_ceo_pay=(7_260_000.0,))
    assert r and r["ceo_pay"] == 7_260_000 and r["median_pay"] == 60_000


def test_find_ratio_keeps_the_required_ratio_over_a_supplemental_one():
    text = ("CEO Pay Ratio. The median employee's annual total compensation was $20,000 and our CEO's annual total "
            "compensation was $9,000,000, a ratio of 450 to 1. " + "y " * 200 +
            "Supplemental ratio: using only our U.S. employees, the median employee's annual total compensation "
            "was $60,000, a ratio of 150 to 1 against the CEO's $9,000,000.")
    r = find_ratio(text, known_ceo_pay=(9_000_000.0,))
    assert r and r["ratio"] == 450 and r["median_pay"] == 20_000
