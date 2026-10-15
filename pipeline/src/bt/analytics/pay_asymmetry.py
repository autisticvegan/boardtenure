"""Does CEO pay fall when the stock falls as much as it rises when the stock rises?

Pairs are consecutive fiscal years with the same full-year CEO at a screened company, read from the
company's own pay-versus-performance table (pvp_panel_*): the change in reported (Summary
Compensation Table) pay against the stock's total return in the same year and the year before.
Reported pay is set partly in advance (stock grants are valued when granted, usually early in the
year, on the previous year's results), so both years are measured.

The test is a piecewise regression of the log pay change on the log return's gains and losses
separately, with year effects and standard errors clustered by company. "Luck" splits the return
into the company's chosen peer group's return and the company's return beyond it.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from statistics import median

import psycopg
from psycopg.types.json import Jsonb

MIN_PAY = 100_000  # $1 salaries and token pay make log changes meaningless
BUCKETS = [(-math.inf, -0.4), (-0.4, -0.2), (-0.2, 0.0), (0.0, 0.2), (0.2, 0.4), (0.4, math.inf)]
TITLES = re.compile(r"^(mr|mrs|ms|dr|sir)\.?\s+", re.I)
SUFFIX = re.compile(r",?\s+(jr|sr|ii|iii|iv|phd|m\.?d|esq)\.?$", re.I)


def name_key(name: str | None) -> tuple[str, str] | None:
    """('john', 'smith') from 'Mr. John A. Smith, Jr.'; ('', 'smith') from 'Mr. Smith'."""
    if not name:
        return None
    n = SUFFIX.sub("", TITLES.sub("", name.strip())).replace(".", " ")
    words = [w for w in re.findall(r"[A-Za-z'\-]+", n)]
    if not words:
        return None
    return (words[0].lower() if len(words) > 1 else "", words[-1].lower())


def member_label(key: str) -> str:
    """'ionq:ChapmanMember' -> 'Chapman' when the filing tags no name for the member."""
    local = re.sub(r"Member$", "", key.split(":", 1)[-1])
    return " ".join(re.findall(r"[A-Z][a-z]+|[A-Z]+(?![a-z])|\d+", local)) or key


def same_person(a: dict, b: dict) -> bool:
    if a["peo_key"] and a["peo_key"] == b["peo_key"]:
        return True
    ka, kb = name_key(a["peo_name"]), name_key(b["peo_name"])
    if not ka or not kb or ka[1] != kb[1]:
        return False
    fa, fb = ka[0], kb[0]  # first names: missing, an initial, or a shortening ("Rob" / "Robert") all match
    return not fa or not fb or fa.startswith(fb) or fb.startswith(fa)


def build_pairs(years: list[dict], peos: dict) -> list[dict]:
    """years: one company's table years in order ({period_end, tsr, peer_tsr, peo_count});
    peos: period_end -> list of PEO rows. Returns same-CEO consecutive-year pairs."""
    def ret(i: int, col: str) -> float | None:
        cur = years[i][col]
        prev = 100.0 if i == 0 else years[i - 1][col]
        if cur is None or prev is None or prev <= 0 or cur <= 0:
            return None
        return float(cur) / float(prev) - 1

    out = []
    for i in range(1, len(years)):
        y0, y1 = years[i - 1], years[i]
        gap = (y1["period_end"] - y0["period_end"]).days
        if not 300 <= gap <= 430 or y0["peo_count"] != 1 or y1["peo_count"] != 1:
            continue
        p0s, p1s = peos.get(y0["period_end"], []), peos.get(y1["period_end"], [])
        if len(p0s) != 1 or len(p1s) != 1 or not same_person(p0s[0], p1s[0]):
            continue
        p0, p1 = p0s[0], p1s[0]
        # A new CEO's first year can be partial or carry sign-on awards: skip it as the base year. A first
        # full year after a mid-year change stays in, flagged (the sign-on usually landed in the change year).
        new_base = False
        if i >= 2:
            before = peos.get(years[i - 2]["period_end"], [])
            if years[i - 2]["peo_count"] == 1 and len(before) == 1 and not same_person(before[0], p0):
                continue
            new_base = not any(same_person(b, p0) for b in before) or years[i - 2]["peo_count"] != 1
        if p0["sct"] is None or p1["sct"] is None or min(p0["sct"], p1["sct"]) < MIN_PAY:
            continue
        r = ret(i, "tsr")
        if r is None:
            continue
        out.append({"period_end": y1["period_end"], "peo_name": p1["peo_name"] or member_label(p1["peo_key"]),
                    "sct_prev": p0["sct"], "sct": p1["sct"], "cap_prev": p0["cap"], "cap": p1["cap"],
                    "ret": r, "ret_prev": ret(i - 1, "tsr"), "peer_ret": ret(i, "peer_tsr"),
                    "peer_ret_prev": ret(i - 1, "peer_tsr"), "new_ceo_base": new_base})
    return out


# -- least squares with company-clustered standard errors (k is small; no numpy) ------------------

def _inv(m: list[list[float]]) -> list[list[float]]:
    n = len(m)
    a = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(m)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(a[r][c]))
        if abs(a[p][c]) < 1e-12:
            raise ValueError("singular design matrix")
        a[c], a[p] = a[p], a[c]
        piv = a[c][c]
        a[c] = [v / piv for v in a[c]]
        for r in range(n):
            if r != c and a[r][c]:
                f = a[r][c]
                a[r] = [x - f * y for x, y in zip(a[r], a[c], strict=True)]
    return [row[n:] for row in a]


def ols_clustered(x: list[list[float]], y: list[float], groups: list) -> tuple[list[float], list[list[float]]]:
    """Coefficients and the cluster-robust covariance (CR1)."""
    n, k = len(x), len(x[0])
    xtx = [[sum(r[i] * r[j] for r in x) for j in range(k)] for i in range(k)]
    xty = [sum(r[i] * v for r, v in zip(x, y, strict=True)) for i in range(k)]
    inv = _inv(xtx)
    b = [sum(inv[i][j] * xty[j] for j in range(k)) for i in range(k)]
    score: dict = defaultdict(lambda: [0.0] * k)
    for r, v, g in zip(x, y, groups, strict=True):
        e = v - sum(bi * ri for bi, ri in zip(b, r, strict=True))
        s = score[g]
        for i in range(k):
            s[i] += r[i] * e
    meat = [[sum(s[i] * s[j] for s in score.values()) for j in range(k)] for i in range(k)]
    g = len(score)
    adj = g / max(1, g - 1) * (n - 1) / max(1, n - k)
    bread_meat = [[sum(inv[i][m] * meat[m][j] for m in range(k)) for j in range(k)] for i in range(k)]
    cov = [[adj * sum(bread_meat[i][m] * inv[m][j] for m in range(k)) for j in range(k)] for i in range(k)]
    return b, cov


def _winsor(vals: list[float], p: float = 0.01) -> list[float]:
    s = sorted(vals)
    lo, hi = s[int(p * (len(s) - 1))], s[int((1 - p) * (len(s) - 1))]
    return [min(max(v, lo), hi) for v in vals]


def piecewise(pairs: list[dict], terms: list[str]) -> dict:
    """Regress log pay change on gains and losses (log returns) of each term, with year effects.
    Each term is a pair field holding a simple return; terms may be summed with '+'."""
    rows = []
    for p in pairs:
        vals = []
        for t in terms:
            parts = [p[f] for f in t.split("+")]
            if any(v is None or v <= -1 for v in parts):
                break
            vals.append(sum(math.log1p(v) for v in parts))
        else:
            rows.append((p, vals))
    if len(rows) < 50:
        return {"n": len(rows)}
    years = sorted({p["period_end"].year for p, _ in rows})
    dy = _winsor([math.log(float(p["sct"]) / float(p["sct_prev"])) for p, _ in rows])
    x = []
    for p, vals in rows:
        r = [1.0]
        for v in vals:
            r += [max(v, 0.0), min(v, 0.0)]
        r += [1.0 if p["period_end"].year == yr else 0.0 for yr in years[1:]]
        x.append(r)
    b, cov = ols_clustered(x, dy, [p["cik"] for p, _ in rows])
    out = {"n": len(rows), "companies": len({p["cik"] for p, _ in rows}), "terms": {}}
    for i, t in enumerate(terms):
        up, dn = 1 + 2 * i, 2 + 2 * i
        diff_se = math.sqrt(max(0.0, cov[up][up] + cov[dn][dn] - 2 * cov[up][dn]))
        out["terms"][t] = {
            "up": b[up], "up_se": math.sqrt(cov[up][up]), "down": b[dn], "down_se": math.sqrt(cov[dn][dn]),
            "diff": b[up] - b[dn], "diff_se": diff_se,
            # pay change for a 10% gain or a 10% loss in the stock
            "pay_if_up10": math.exp(b[up] * math.log(1.1)) - 1,
            "pay_if_down10": math.exp(b[dn] * math.log(0.9)) - 1,
        }
    return out


def buckets(pairs: list[dict], field: str, edges: list[tuple[float, float]] = BUCKETS) -> list[dict]:
    out = []
    for lo, hi in edges:
        sel = [p for p in pairs if p[field] is not None and lo <= p[field] < hi]
        ch = [float(p["sct"]) / float(p["sct_prev"]) - 1 for p in sel]
        out.append({"lo": None if lo == -math.inf else lo, "hi": None if hi == math.inf else hi, "n": len(sel),
                    "median_change": median(ch) if ch else None,
                    "share_up": sum(1 for c in ch if c > 0) / len(ch) if ch else None,
                    "median_pay": median(float(p["sct"]) for p in sel) if sel else None})
    return out


def recompute(conn: psycopg.Connection) -> int:
    ok = {r["cik"] for r in conn.execute("SELECT cik FROM pvp_screen_ok WHERE NOT implausible")}
    years: dict = defaultdict(list)
    for r in conn.execute("SELECT * FROM pvp_panel_year ORDER BY cik, period_end"):
        if r["cik"] in ok:
            years[r["cik"]].append(r)
    peos: dict = defaultdict(lambda: defaultdict(list))
    acc: dict = {}
    for r in conn.execute("SELECT * FROM pvp_panel_peo ORDER BY cik, period_end, peo_key"):
        peos[r["cik"]][r["period_end"]].append(r)
        acc[r["cik"]] = r["accession"]
    pairs = []
    for cik, ys in years.items():
        for p in build_pairs(ys, peos[cik]):
            pairs.append({**p, "cik": cik, "accession": acc[cik]})
    conn.execute("DELETE FROM pay_change")
    for p in pairs:
        conn.execute(
            """INSERT INTO pay_change (cik, accession, period_end, peo_name, sct_prev, sct, cap_prev, cap, ret,
                 ret_prev, peer_ret, peer_ret_prev, new_ceo_base)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (p["cik"], p["accession"], p["period_end"], p["peo_name"], p["sct_prev"], p["sct"], p["cap_prev"],
             p["cap"], p["ret"], p["ret_prev"], p["peer_ret"], p["peer_ret_prev"], p["new_ceo_base"]))
    stats = {
        "sample": {"pairs": len(pairs), "companies": len({p["cik"] for p in pairs}),
                   "first_year": min((p["period_end"].year for p in pairs), default=None),
                   "last_year": max((p["period_end"].year for p in pairs), default=None),
                   "panel_companies": len(years)},
        "overall": buckets(pairs, "ret", [(-math.inf, math.inf)])[0],
        "buckets_same": buckets(pairs, "ret"),
        "buckets_prior": buckets(pairs, "ret_prev"),
        "same_year": piecewise(pairs, ["ret"]),
        "both_years": piecewise(pairs, ["ret", "ret_prev"]),
        "two_year": piecewise(pairs, ["ret+ret_prev"]),
        "luck": piecewise([{**p, "excess": (1 + p["ret"]) / (1 + p["peer_ret"]) - 1 if p["peer_ret"] is not None
                            and p["peer_ret"] > -1 else None} for p in pairs], ["peer_ret", "excess"]),
    }
    conn.execute("DELETE FROM pay_asymmetry_stat")
    for k, v in stats.items():
        conn.execute("INSERT INTO pay_asymmetry_stat (key, value) VALUES (%s, %s)", (k, Jsonb(v)))
    return len(pairs)
