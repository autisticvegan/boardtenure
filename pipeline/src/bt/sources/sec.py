"""SEC EDGAR client.

Fair-access rules (https://www.sec.gov/os/accessing-edgar-data): declared User-Agent,
at most 10 requests/second. We default to 5/s. Filing documents are immutable once
accepted, so they are cached in the raw store and never fetched twice.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime

import httpx

from bt import rawstore

DATA = "https://data.sec.gov"
ARCHIVES = "https://www.sec.gov/Archives/edgar/data"


def pad_cik(cik: str | int) -> str:
    return f"{int(cik):010d}"


@dataclass(frozen=True)
class Filing:
    cik: str  # 10-digit issuer CIK
    accession: str
    form: str
    filing_date: date
    report_date: date | None
    acceptance: datetime | None
    items: tuple[str, ...]
    primary_document: str
    primary_doc_description: str

    @property
    def folder_url(self) -> str:
        return f"{ARCHIVES}/{int(self.cik)}/{self.accession.replace('-', '')}"

    @property
    def index_url(self) -> str:
        return f"{self.folder_url}/{self.accession}-index.htm"

    def document_url(self, filename: str | None = None) -> str:
        return f"{self.folder_url}/{filename or self.primary_document}"


def _parse_date(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def _rows(block: dict) -> Iterator[dict]:
    keys = list(block)
    for values in zip(*(block[k] for k in keys), strict=True):
        yield dict(zip(keys, values, strict=True))


class EdgarError(RuntimeError):
    pass


class Edgar:
    def __init__(self, user_agent: str, max_rps: float = 5.0, client: httpx.Client | None = None):
        self.http = client or httpx.Client(
            headers={"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"},
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
        )
        self._interval = 1.0 / max_rps
        self._last = 0.0

    def get(self, url: str, *, attempts: int = 4) -> bytes:
        for attempt in range(attempts):
            wait = self._last + self._interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            resp = self.http.get(url)
            if resp.status_code == 200:
                return resp.content
            if resp.status_code == 403 and b"Undeclared Automated Tool" in resp.content:
                raise EdgarError("SEC rejected the User-Agent; set SEC_USER_AGENT to 'Name contact@domain'")
            if resp.status_code == 404:
                raise EdgarError(f"404 {url}")
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                time.sleep(2 ** attempt * 2)
                continue
            raise EdgarError(f"HTTP {resp.status_code} for {url}")
        raise AssertionError("unreachable")

    def get_json(self, url: str) -> dict:
        import json

        return json.loads(self.get(url))

    # -- company filing lists -------------------------------------------------

    def submissions(self, cik: str | int) -> dict:
        return self.get_json(f"{DATA}/submissions/CIK{pad_cik(cik)}.json")

    def filings(self, cik: str | int, *, include_history: bool = True) -> list[Filing]:
        """All filings listed for an issuer, newest first (includes Forms 3/4/5 by insiders)."""
        sub = self.submissions(cik)
        blocks = [sub["filings"]["recent"]]
        if include_history:
            for f in sub["filings"].get("files", []):
                blocks.append(self.get_json(f"{DATA}/submissions/{f['name']}"))
        out = []
        for block in blocks:
            for r in _rows(block):
                out.append(
                    Filing(
                        cik=pad_cik(cik),
                        accession=r["accessionNumber"],
                        form=r["form"],
                        filing_date=date.fromisoformat(r["filingDate"]),
                        report_date=_parse_date(r.get("reportDate") or None),
                        acceptance=(datetime.fromisoformat(r["acceptanceDateTime"].replace("Z", "+00:00"))
                                    if r.get("acceptanceDateTime") else None),
                        items=tuple(i for i in (r.get("items") or "").split(",") if i),
                        primary_document=r.get("primaryDocument") or "",
                        primary_doc_description=r.get("primaryDocDescription") or "",
                    )
                )
        out.sort(key=lambda f: (f.filing_date, f.accession), reverse=True)
        return out

    # -- documents -------------------------------------------------------------

    def filing_index(self, filing: Filing) -> list[dict]:
        """Files in a filing folder: [{'name', 'type', 'size', ...}]."""
        data = self.get_json(f"{filing.folder_url}/index.json")
        return data["directory"]["item"]

    def document(self, filing: Filing, filename: str | None = None) -> rawstore.StoredObject:
        name = filename or filing.primary_document
        key = rawstore.sec_key(filing.cik, filing.accession, name)
        if rawstore.exists(key):
            return rawstore.describe(key)
        return rawstore.put(key, self.get(filing.document_url(name)))

    def daily_form_index(self, day: date) -> list[dict]:
        """Every filing accepted on `day` across EDGAR (one request per day at any scale)."""
        qtr = (day.month - 1) // 3 + 1
        url = f"https://www.sec.gov/Archives/edgar/daily-index/{day.year}/QTR{qtr}/master.{day:%Y%m%d}.idx"
        try:
            text = self.get(url).decode("latin-1")
        except EdgarError as e:
            if str(e).startswith("404"):
                return []  # weekends/holidays have no index
            raise
        rows, started = [], False
        for line in text.splitlines():
            if line.startswith("-----"):
                started = True
                continue
            if not started or "|" not in line:
                continue
            cik, company, form, filed, filename = line.split("|")
            rows.append({"cik": pad_cik(cik), "company": company, "form": form,
                         "filing_date": filed, "filename": filename,
                         "accession": filename.rsplit("/", 1)[-1].removesuffix(".txt")})
        return rows
