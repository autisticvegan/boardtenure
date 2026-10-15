import math
import random
from datetime import date

from bt.analytics.pay_asymmetry import build_pairs, member_label, name_key, ols_clustered, piecewise, same_person
from bt.ingest.screen import is_viewer_page, panel_rows


def test_name_key_strips_titles_and_suffixes():
    assert name_key("Mr. John A. Smith, Jr.") == ("john", "smith")
    assert name_key("Mr. McKenney") == ("", "mckenney")
    assert name_key(None) is None


def test_member_label():
    assert member_label("ionq:ChapmanMember") == "Chapman"
    assert member_label("aal:RobertIsomMember") == "Robert Isom"


def test_same_person_by_member_or_name():
    a = {"peo_key": "aal:IsomMember", "peo_name": None}
    assert same_person(a, {"peo_key": "aal:IsomMember", "peo_name": None})
    assert same_person({"peo_key": "", "peo_name": "John Smith"}, {"peo_key": "", "peo_name": "Mr. Smith"})
    assert not same_person({"peo_key": "", "peo_name": "John Smith"}, {"peo_key": "", "peo_name": "Jane Smith"})
    assert not same_person({"peo_key": "", "peo_name": None}, {"peo_key": "", "peo_name": None})


def _year(y, tsr, count=1):
    return {"period_end": date(y, 12, 31), "tsr": tsr, "peer_tsr": None, "peo_count": count}


def _peo(name, sct):
    return {"peo_key": "", "peo_name": name, "sct": sct, "cap": None}


def test_build_pairs_needs_same_full_year_ceo():
    years = [_year(2021, 120), _year(2022, 60), _year(2023, 90, count=2), _year(2024, 99), _year(2025, 110)]
    peos = {date(2021, 12, 31): [_peo("Ann Lee", 1_000_000)], date(2022, 12, 31): [_peo("Ann Lee", 1_500_000)],
            date(2023, 12, 31): [_peo("Ann Lee", 2_000_000), _peo("Bo Park", 900_000)],
            date(2024, 12, 31): [_peo("Bo Park", 5_000_000)], date(2025, 12, 31): [_peo("Bo Park", 4_000_000)]}
    pairs = build_pairs(years, peos)
    # 2023 has two CEOs; 2024 is Park's first full year, so it can be a base year
    assert [p["period_end"].year for p in pairs] == [2022, 2025]
    assert [p["new_ceo_base"] for p in pairs] == [False, True]
    assert abs(pairs[0]["ret"] - (60 / 120 - 1)) < 1e-9
    assert abs(pairs[0]["ret_prev"] - 0.2) < 1e-9


def test_build_pairs_skips_new_ceo_first_year():
    years = [_year(2021, 100), _year(2022, 100), _year(2023, 100)]
    peos = {date(2021, 12, 31): [_peo("Ann Lee", 1_000_000)], date(2022, 12, 31): [_peo("Bo Park", 9_000_000)],
            date(2023, 12, 31): [_peo("Bo Park", 4_000_000)]}
    assert build_pairs(years, peos) == []


def test_ols_recovers_coefficients():
    rng = random.Random(1)
    x, y, g = [], [], []
    for i in range(400):
        a = rng.uniform(-1, 1)
        x.append([1.0, a])
        y.append(0.5 + 2.0 * a + rng.gauss(0, 0.1))
        g.append(i // 4)
    b, cov = ols_clustered(x, y, g)
    assert abs(b[0] - 0.5) < 0.05 and abs(b[1] - 2.0) < 0.05
    assert 0 < cov[1][1] < 0.01


def test_piecewise_finds_asymmetry():
    rng = random.Random(2)
    pairs = []
    for i in range(600):
        r = rng.uniform(-0.5, 0.8)
        lr = math.log1p(r)
        dlog = 0.6 * max(lr, 0) + 0.1 * min(lr, 0) + rng.gauss(0, 0.05)
        pairs.append({"cik": i // 3, "period_end": date(2021 + i % 4, 12, 31), "ret": r, "ret_prev": None,
                      "sct_prev": 1_000_000, "sct": 1_000_000 * math.exp(dlog)})
    t = piecewise(pairs, ["ret"])["terms"]["ret"]
    assert abs(t["up"] - 0.6) < 0.1 and abs(t["down"] - 0.1) < 0.1 and t["diff"] > 3 * t["diff_se"]


def test_panel_rows_assigns_names():
    from decimal import Decimal as D
    parsed = {"undim": {("TotalShareholderRtnAmt", "2024-12-31"): [D(90)],
                        ("TotalShareholderRtnAmt", "2025-12-31"): [D(80)],
                        ("PeoTotalCompAmt", "2024-12-31"): [D(5000000), D("5.0")],
                        ("PeoTotalCompAmt", "2025-12-31"): [D(6000000)]},
              "dims": {}, "names": ["Ann Lee"], "member_names": {}, "year_names": {"2025-12-31": "Ann Lee"}}
    years, peos = panel_rows(parsed)
    assert [p["name_basis"] for p in peos] == ["sole", "year"]
    assert peos[0]["sct"] == D(5000000)
    assert [y["peo_count"] for y in years] == [1, 1]



def test_viewer_pages_are_not_documents_named_r():
    assert is_viewer_page("R12.htm") and is_viewer_page("FS1.htm")
    assert not is_viewer_page("rost-20260406.htm") and not is_viewer_page("regn-20260424.htm")
