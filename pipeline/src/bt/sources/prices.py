"""End-of-day price providers.

Production must use a feed licensed for public display (see docs/research/data-sources.md;
Tiingo's redistribution tier is the cheapest fit). `nasdaq_com` is a keyless public endpoint
used only for local prototyping: its data must never be shipped.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Protocol

import httpx

from bt import rawstore
from bt.ingest.prices import CorporateAction, PriceBar


@dataclass
class PriceFetch:
    bars: list[PriceBar]
    actions: list[CorporateAction]
    raw: rawstore.StoredObject
    url: str


class PriceProvider(Protocol):
    source_code: str

    def daily(self, symbol: str, kind: str, start: date, end: date) -> PriceFetch: ...


def _store(source: str, symbol: str, start: date, end: date, body: bytes) -> rawstore.StoredObject:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return rawstore.put(f"prices/{source}/{symbol}/{stamp}_{start:%Y%m%d}-{end:%Y%m%d}.json", body)


class NasdaqComDev:
    """Prototype only. Unadjusted OHLCV; no corporate actions."""

    source_code = "nasdaq_com"
    URL = "https://api.nasdaq.com/api/quote/{symbol}/historical"

    def __init__(self, client: httpx.Client | None = None):
        self.http = client or httpx.Client(timeout=30, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/126.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.nasdaq.com",
            "Referer": "https://www.nasdaq.com/",
        })

    def daily(self, symbol: str, kind: str, start: date, end: date) -> PriceFetch:
        params = {"assetclass": "etf" if kind == "etf" else "stocks", "fromdate": start.isoformat(),
                  "todate": end.isoformat(), "limit": "9999"}
        resp = self.http.get(self.URL.format(symbol=symbol), params=params)
        resp.raise_for_status()
        raw = _store(self.source_code, symbol, start, end, resp.content)
        rows = ((json.loads(resp.content).get("data") or {}).get("tradesTable") or {}).get("rows") or []

        def money(v: str) -> float | None:
            v = (v or "").replace("$", "").replace(",", "").strip()
            return float(v) if v and v != "N/A" else None

        bars = []
        for r in rows:
            m, d, y = r["date"].split("/")
            close = money(r["close"])
            if close is None:
                continue
            vol = (r.get("volume") or "").replace(",", "")
            bars.append(PriceBar(date(int(y), int(m), int(d)), money(r.get("open")), money(r.get("high")),
                                 money(r.get("low")), close, int(vol) if vol.isdigit() else None))
        bars.sort(key=lambda b: b.day)
        return PriceFetch(bars, [], raw, str(resp.url))


class Tiingo:
    """Licensed EOD feed (requires TIINGO_API_KEY and a redistribution license for public display).
    Each bar carries divCash and splitFactor, so corporate actions arrive with the prices."""

    source_code = "tiingo"
    URL = "https://api.tiingo.com/tiingo/daily/{symbol}/prices"

    def __init__(self, api_key: str, client: httpx.Client | None = None):
        self.key = api_key
        self.http = client or httpx.Client(timeout=30)

    def daily(self, symbol: str, kind: str, start: date, end: date) -> PriceFetch:
        resp = self.http.get(self.URL.format(symbol=symbol.lower()),
                             params={"startDate": start.isoformat(), "endDate": end.isoformat(),
                                     "format": "json", "resampleFreq": "daily"},
                             headers={"Authorization": f"Token {self.key}"})
        resp.raise_for_status()
        raw = _store(self.source_code, symbol, start, end, resp.content)
        bars, actions = [], []
        for r in json.loads(resp.content):
            d = date.fromisoformat(r["date"][:10])
            bars.append(PriceBar(d, r.get("open"), r.get("high"), r.get("low"), r["close"],
                                 r.get("volume"), r.get("adjClose")))
            if r.get("divCash"):
                actions.append(CorporateAction(d, "cash_dividend", cash_amount=float(r["divCash"])))
            if r.get("splitFactor") not in (None, 1, 1.0):
                f = float(r["splitFactor"])
                actions.append(CorporateAction(d, "split", split_from=1.0, split_to=f))
        return PriceFetch(bars, actions, raw, str(resp.url).replace(self.key, "***"))


def provider_from_env() -> PriceProvider:
    import os

    key = os.environ.get("TIINGO_API_KEY")
    return Tiingo(key) if key else NasdaqComDev()
