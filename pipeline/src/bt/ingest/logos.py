"""Company icons for the sites, keyed by SEC CIK.

Wikidata links companies to their CIK (P5531), official website (P856) and logo file on Wikimedia
Commons (P154). For each company the sites name, the square site icon of its official website is
preferred (it reads at badge size); a Commons logo is the fallback. Files go to the raw store
(data/raw/logos/, gitignored), so no trademarked images are committed; the web app draws a lettered
badge for companies with none.
"""

from __future__ import annotations

import re
import struct
import time
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx
import psycopg
from PIL import Image

SPARQL = "https://query.wikidata.org/sparql"
UA = "Boardtape/0.1 (https://github.com/autisticvegan/boardtenure)"
ROOT = Path(__file__).resolve().parents[4] / "data" / "raw" / "logos"
MIN_ICON = 32  # smaller site icons look blurry as badges

QUERY = """SELECT ?cik ?site ?logo WHERE {
  ?item wdt:P5531 ?cik .
  OPTIONAL { ?item wdt:P856 ?site }
  OPTIONAL { ?item wdt:P154 ?logo }
}"""

# Every company a page names: the tracked companies, the screen's well-known companies, and the
# companies in researched cases.
WANTED = """
SELECT cik, max(name) AS name FROM (
  SELECT cik::bigint AS cik, common_name AS name FROM company WHERE cik ~ '^[0-9]+$'
  UNION ALL SELECT cik, entity_name FROM pvp_screen_ok WHERE notable
  UNION ALL SELECT company_cik::bigint, company_name FROM golden_parachute WHERE company_cik ~ '^[0-9]+$'
  UNION ALL SELECT company_cik::bigint, company_name FROM hiw_case WHERE company_cik ~ '^[0-9]+$'
  UNION ALL SELECT from_cik, from_company FROM failing_up_case WHERE from_cik IS NOT NULL
  UNION ALL SELECT to_cik, to_company FROM failing_up_case WHERE to_cik IS NOT NULL
) x GROUP BY cik"""


def wikidata(client: httpx.Client) -> dict[int, dict]:
    r = client.get(SPARQL, params={"query": QUERY}, headers={"Accept": "application/sparql-results+json"},
                   timeout=120)
    r.raise_for_status()
    out: dict[int, dict] = {}
    for b in r.json()["results"]["bindings"]:
        raw = re.sub(r"\D", "", b["cik"]["value"])
        if not raw:
            continue
        row = out.setdefault(int(raw), {"sites": [], "logos": []})
        if "site" in b and b["site"]["value"] not in row["sites"]:
            row["sites"].append(b["site"]["value"])
        if "logo" in b and b["logo"]["value"] not in row["logos"]:
            row["logos"].append(b["logo"]["value"])
    return out


def domain(site: str) -> str | None:
    host = urlparse(site).hostname or ""
    host = re.sub(r"^(www\d?|investors?|ir)\.", "", host.lower())
    return host or None


def image_size(data: bytes) -> tuple[int, int] | None:
    """Pixel size of a PNG, GIF or ICO (largest entry); None for other formats."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:4] == b"GIF8" and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    if data[:4] == b"\x00\x00\x01\x00" and len(data) >= 6:
        n = struct.unpack("<H", data[4:6])[0]
        sizes = [(data[6 + 16 * i] or 256, data[7 + 16 * i] or 256) for i in range(n) if 7 + 16 * i < len(data)]
        return max(sizes) if sizes else None
    return None


def _ext(content_type: str) -> str:
    return {"image/png": "png", "image/svg+xml": "svg", "image/jpeg": "jpg", "image/gif": "gif",
            "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/webp": "webp"}.get(content_type, "img")


def fetch(conn: psycopg.Connection, refresh: bool = False, limit: int | None = None) -> dict[str, int]:
    ROOT.mkdir(parents=True, exist_ok=True)
    stats = {"wanted": 0, "favicon": 0, "commons": 0, "none": 0, "skipped": 0}
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=30) as client:
        wd = wikidata(client)
        # The icon service answers unknown sites with a generic globe; never store that.
        generic = client.get("https://www.google.com/s2/favicons?domain=no-such-site.invalid&sz=128").content
        done = set() if refresh else {r["cik"] for r in conn.execute("SELECT cik FROM company_logo")}
        wanted = [r for r in conn.execute(WANTED) if r["cik"] not in done][:limit]
        stats["wanted"] = len(wanted)
        for r in wanted:
            cik, info = r["cik"], wd.get(r["cik"], {"sites": [], "logos": []})
            site = info["sites"][0] if info["sites"] else None
            got = None
            for s in info["sites"]:
                d = domain(s)
                if not d:
                    continue
                url = f"https://www.google.com/s2/favicons?domain={quote(d)}&sz=128"
                resp = client.get(url)
                ctype = resp.headers.get("content-type", "").split(";")[0]
                size = image_size(resp.content) or (0, 0)
                if (resp.status_code == 200 and ctype.startswith("image/") and resp.content != generic
                        and min(size) >= MIN_ICON):
                    got, site = ("favicon", url, resp.content, ctype), s
                    break
                time.sleep(0.15)
            if not got:
                for logo in info["logos"]:
                    name = logo.rsplit("/", 1)[-1]
                    url = f"https://commons.wikimedia.org/wiki/Special:FilePath/{name}?width=256"
                    resp = client.get(url)
                    ctype = resp.headers.get("content-type", "").split(";")[0]
                    if resp.status_code == 200 and ctype.startswith("image/"):
                        got = ("commons", url, resp.content, ctype)
                        break
                    time.sleep(0.15)
            if got:
                source, url, data, ctype = got
                file = f"{cik}.{_ext(ctype)}"
                for old in ROOT.glob(f"{cik}.*"):
                    old.unlink()
                (ROOT / file).write_bytes(data)
                width, height = image_size(data) or (None, None)
            else:
                source, url, file, ctype, width, height = "none", None, None, None, None, None
            conn.execute(
                """INSERT INTO company_logo (cik, name, website, source, source_url, file, content_type, width, height,
                     website_source) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (cik) DO UPDATE SET name = EXCLUDED.name, website = EXCLUDED.website,
                     source = EXCLUDED.source, source_url = EXCLUDED.source_url, file = EXCLUDED.file,
                     content_type = EXCLUDED.content_type, width = EXCLUDED.width, height = EXCLUDED.height,
                     website_source = EXCLUDED.website_source, tone = NULL, fetched_at = now()""",
                (cik, r["name"], site, source, url, file, ctype, width, height, "wikidata" if site else None))
            conn.commit()
            stats[source] += 1
            time.sleep(0.15)
    return stats


# Hosts proxies link to that aren't the company's own site (voting, transfer agents, solicitors).
NOT_COMPANY = re.compile(r"(sec\.gov|proxyvote|dfinsolutions|virtualshareholdermeeting|investorvote|envisionreports|"
                         r"computershare|"
                         r"broadridge|astfinancial|equiniti|eqshareowner|viewproxy|cstproxy|edocumentview|meetnow|"
                         r"lumiconnect|okapipartners|innisfree|morrowsodali|sodali|georgeson|dfking|mackenziepartners|"
                         r"proxydocs|issuerdirect|allianceadvisors|w3\.org|adobe|microsoft\.com/|google\.com|"
                         r"nyse\.com|nasdaq\.com|irs\.gov|fasb|pcaobus|iss|glasslewis|linkedin|twitter|facebook|youtube)")
DOMAIN = re.compile(rb"(?:https?://)?(?:www\.|investors?\.|ir\.)((?:[a-z0-9-]+\.)+(?:com|net|org|io|co|us|ai|bank|biz))\b",
                    re.I)


def _letters(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


GENERIC = {"the", "inc", "corp", "corporation", "company", "holdings", "holding", "group", "international", "global",
           "solutions", "technologies", "technology", "systems", "services", "partners", "capital", "financial",
           "american", "united", "national", "first", "general", "industries", "enterprises", "brands", "bancorp",
           "therapeutics", "pharmaceuticals", "biosciences", "health", "energy", "resources", "properties", "trust"}


def looks_like(domain_name: str, company: str, tickers: list[str]) -> bool:
    """The domain's name part starts with a ticker or contains the start of the company's first
    distinctive word ("Advantage Solutions" must match "adva...", not "...solutions")."""
    label = _letters(domain_name.rsplit(".", 1)[0].split(".")[-1])
    if any(len(_letters(t)) >= 2 and label.startswith(_letters(t)) for t in tickers):
        return True
    words = [_letters(w) for w in re.split(r"[\s&,/-]+", company.lower())]
    first = next((w for w in words if len(w) >= 4 and w not in GENERIC), None)
    return bool(first) and first[:5] in label


def proxy_domain(raw: bytes, company: str, tickers: list[str]) -> str | None:
    counts: dict[str, int] = {}
    for m in DOMAIN.finditer(raw):
        d = m.group(1).decode("latin-1").lower()
        if NOT_COMPANY.search(d) or not looks_like(d, company, tickers):
            continue
        d = re.sub(r"^(investors?|ir)\.", "", d)
        counts[d] = counts.get(d, 0) + 1
    return max(counts, key=counts.get) if counts else None


def fill_from_proxies(conn: psycopg.Connection) -> dict[str, int]:
    """Second pass for companies with no icon: the website their own latest proxy names."""
    from bt import rawstore

    rows = conn.execute(
        """SELECT l.cik, l.name, f.accession, f.doc_url,
                  coalesce((SELECT array_agg(ticker) FROM sec_ticker t WHERE t.cik = l.cik), '{}') AS tickers
           FROM company_logo l JOIN pvp_panel_filing f ON f.cik = l.cik AND f.status = 'ok'
           WHERE l.source = 'none'""").fetchall()
    stats = {"candidates": len(rows), "favicon": 0, "no_domain": 0, "no_icon": 0}
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=30) as client:
        generic = client.get("https://www.google.com/s2/favicons?domain=no-such-site.invalid&sz=128").content
        for r in rows:
            key = rawstore.sec_key(r["cik"], r["accession"], r["doc_url"].rsplit("/", 1)[-1])
            d = proxy_domain(rawstore.read(key), r["name"] or "", r["tickers"]) if rawstore.exists(key) else None
            if not d:
                stats["no_domain"] += 1
                continue
            url = f"https://www.google.com/s2/favicons?domain={quote(d)}&sz=128"
            resp = client.get(url)
            ctype = resp.headers.get("content-type", "").split(";")[0]
            size = image_size(resp.content) or (0, 0)
            if not (resp.status_code == 200 and ctype.startswith("image/") and resp.content != generic
                    and min(size) >= MIN_ICON):
                stats["no_icon"] += 1
                conn.execute("UPDATE company_logo SET website = %s, website_source = 'proxy' WHERE cik = %s",
                             (f"https://{d}", r["cik"]))
                conn.commit()
                continue
            file = f"{r['cik']}.{_ext(ctype)}"
            (ROOT / file).write_bytes(resp.content)
            conn.execute(
                """UPDATE company_logo SET website = %s, website_source = 'proxy', source = 'favicon', source_url = %s,
                     file = %s, content_type = %s, width = %s, height = %s, tone = NULL, fetched_at = now()
                   WHERE cik = %s""",
                (f"https://{d}", url, file, ctype, size[0], size[1], r["cik"]))
            conn.commit()
            stats["favicon"] += 1
            time.sleep(0.15)
    return stats


def tone(data: bytes) -> str | None:
    """'opaque' when the icon fills its own background, else 'light' or 'dark' by its marks' brightness."""
    import io

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:  # unreadable or SVG: leave it to the default chip
        return None
    img = img.convert("RGBA")
    img.thumbnail((64, 64))
    px = list(img.getdata())
    w, h = img.size
    corners = [px[0], px[w - 1], px[(h - 1) * w], px[h * w - 1]]
    if all(a > 200 for *_, a in corners):
        return "opaque"
    marks = [(r, g, b) for r, g, b, a in px if a > 64]
    if not marks:
        return None
    lum = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in marks) / (255 * len(marks))
    return "light" if lum > 0.75 else "dark"


def classify(conn: psycopg.Connection) -> int:
    n = 0
    for r in conn.execute("SELECT cik, file FROM company_logo WHERE file IS NOT NULL AND tone IS NULL").fetchall():
        path = ROOT / r["file"]
        if path.exists():
            conn.execute("UPDATE company_logo SET tone = %s WHERE cik = %s", (tone(path.read_bytes()), r["cik"]))
            n += 1
    conn.commit()
    return n


def recheck(conn: psycopg.Connection) -> dict[str, int]:
    """Mark which websites came from Wikidata, and drop proxy-derived ones the name check now rejects."""
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=30) as client:
        wd = wikidata(client)
    stats = {"wikidata": 0, "proxy_kept": 0, "proxy_dropped": 0}
    rows = conn.execute(
        """SELECT l.cik, l.name, l.website, coalesce((SELECT array_agg(ticker) FROM sec_ticker t WHERE t.cik = l.cik),
             '{}') AS tickers FROM company_logo l WHERE l.website IS NOT NULL""").fetchall()
    for r in rows:
        if r["website"] in wd.get(r["cik"], {}).get("sites", []):
            conn.execute("UPDATE company_logo SET website_source = 'wikidata' WHERE cik = %s", (r["cik"],))
            stats["wikidata"] += 1
        elif looks_like(domain(r["website"]) or "", r["name"] or "", r["tickers"]):
            conn.execute("UPDATE company_logo SET website_source = 'proxy' WHERE cik = %s", (r["cik"],))
            stats["proxy_kept"] += 1
        else:
            conn.execute(
                """UPDATE company_logo SET website = NULL, website_source = NULL, source = 'none', source_url = NULL,
                     file = NULL, content_type = NULL, width = NULL, height = NULL, tone = NULL WHERE cik = %s""",
                (r["cik"],))
            stats["proxy_dropped"] += 1
    conn.commit()
    return stats
