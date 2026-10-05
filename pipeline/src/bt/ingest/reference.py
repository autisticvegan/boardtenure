"""Reference rows every environment needs: sources, benchmark securities, companies."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import psycopg

SOURCES = [
    # code, name, kind, homepage, default confidence, license notes
    ("sec_edgar", "SEC EDGAR", "regulatory_filing", "https://www.sec.gov/edgar", "high",
     "U.S. government work; public filings. Fair-access rate limits apply."),
    ("manual_research", "Manual research from primary sources", "manual", None, "high",
     "Facts researched by hand from cited primary documents; confidence set per fact."),
    ("admin", "Admin correction", "manual", None, "high", "Audited manual correction."),
    ("company_ir", "Company investor-relations website", "company_website", None, "medium", None),
    ("nasdaq_com", "Nasdaq.com historical quotes", "market_data", "https://www.nasdaq.com", "medium",
     "Keyless public endpoint used for the local prototype only; not licensed for redistribution."),
    ("prototype_keyless", "Keyless public price sources (cross-verified)", "market_data", None, "medium",
     "Merged from several keyless public endpoints for the local prototype; see docs/research/price-data-*.md. "
     "Not licensed for redistribution."),
    ("ssga", "State Street Global Advisors (SPY distributions)", "market_data",
     "https://www.ssga.com", "high", "Fund sponsor's published distribution history."),
]


def ensure_sources(conn: psycopg.Connection) -> dict[str, int]:
    for code, name, kind, url, conf, notes in SOURCES:
        conn.execute(
            """INSERT INTO source (code, name, kind, homepage_url, default_confidence, license_notes)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind,
                 homepage_url = EXCLUDED.homepage_url, license_notes = EXCLUDED.license_notes""",
            (code, name, kind, url, conf, notes),
        )
    return source_ids(conn)


def ensure_source(conn: psycopg.Connection, code: str, name: str, kind: str, confidence: str,
                  homepage: str | None = None, license_notes: str | None = None) -> int:
    row = conn.execute(
        """INSERT INTO source (code, name, kind, homepage_url, default_confidence, license_notes)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
           RETURNING id""",
        (code, name, kind, homepage, confidence, license_notes),
    ).fetchone()
    return row["id"]


def source_ids(conn: psycopg.Connection) -> dict[str, int]:
    return {r["code"]: r["id"] for r in conn.execute("SELECT id, code FROM source")}


@dataclass(frozen=True)
class CompanySpec:
    slug: str
    cik: str
    legal_name: str
    common_name: str
    symbol: str
    exchange: str
    country: str = "US"
    ipo_date: date | None = None
    sic_code: str | None = None
    website: str | None = None
    fiscal_year_end: str | None = None
    state_of_incorporation: str | None = None


def ensure_company(conn: psycopg.Connection, spec: CompanySpec) -> tuple[int, int]:
    """Upsert a company and its primary listing; returns (company_id, security_id)."""
    company_id = conn.execute(
        """INSERT INTO company (slug, cik, legal_name, common_name, country, ipo_date, sic_code,
                                website, fiscal_year_end, state_of_incorporation)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (cik) DO UPDATE SET legal_name = EXCLUDED.legal_name,
             common_name = EXCLUDED.common_name, ipo_date = coalesce(EXCLUDED.ipo_date, company.ipo_date),
             sic_code = coalesce(EXCLUDED.sic_code, company.sic_code),
             website = coalesce(EXCLUDED.website, company.website),
             fiscal_year_end = coalesce(EXCLUDED.fiscal_year_end, company.fiscal_year_end),
             state_of_incorporation = coalesce(EXCLUDED.state_of_incorporation, company.state_of_incorporation)
           RETURNING id""",
        (spec.slug, spec.cik, spec.legal_name, spec.common_name, spec.country, spec.ipo_date,
         spec.sic_code, spec.website, spec.fiscal_year_end, spec.state_of_incorporation),
    ).fetchone()["id"]
    row = conn.execute("SELECT id FROM security WHERE company_id = %s AND is_primary", (company_id,)).fetchone()
    if row:
        security_id = row["id"]
    else:
        security_id = conn.execute(
            """INSERT INTO security (company_id, kind, symbol, exchange, name, is_primary, first_trade_date)
               VALUES (%s, 'common_stock', %s, %s, %s, true, %s) RETURNING id""",
            (company_id, spec.symbol, spec.exchange, f"{spec.legal_name} common stock", spec.ipo_date),
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO security_symbol (security_id, symbol, exchange, valid_from) VALUES (%s, %s, %s, %s)",
            (security_id, spec.symbol, spec.exchange, spec.ipo_date or date(1900, 1, 1)),
        )
    return company_id, security_id


BENCHMARKS = [
    # code, display name, ETF symbol, exchange, ETF name, default?, proxy note
    ("sp500", "S&P 500 (SPY)", "SPY", "ARCX", "SPDR S&P 500 ETF Trust", True,
     "Total return of the SPDR S&P 500 ETF Trust (SPY), dividends reinvested at the ex-date close. A proxy for "
     "the index: it trails the index slightly because of its 0.0945% expense ratio."),
]


def ensure_benchmarks(conn: psycopg.Connection) -> dict[str, int]:
    """Benchmark code -> security_id."""
    out = {}
    for code, name, symbol, exchange, etf_name, is_default, note in BENCHMARKS:
        row = conn.execute("SELECT id FROM security WHERE kind = 'etf' AND upper(symbol) = %s",
                           (symbol,)).fetchone()
        security_id = row["id"] if row else conn.execute(
            """INSERT INTO security (kind, symbol, exchange, name) VALUES ('etf', %s, %s, %s) RETURNING id""",
            (symbol, exchange, etf_name),
        ).fetchone()["id"]
        conn.execute(
            """INSERT INTO benchmark (code, name, security_id, is_default, proxy_note)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, security_id = EXCLUDED.security_id,
                 proxy_note = EXCLUDED.proxy_note""",
            (code, name, security_id, is_default, note),
        )
        out[code] = security_id
    return out
