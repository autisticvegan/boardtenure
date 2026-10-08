#!/usr/bin/env python3
"""Fetch an SEC URL through the shared raw-store cache, rate-limited across processes.

Several research processes may run at once, but EDGAR's fair-access limit (10 req/s)
applies to the whole machine, so every fetch goes through one file-locked limiter
capped at MAX_RPS. Filing documents are immutable and cached forever under
data/raw/sec/<cik>/<accession>/<filename>; API responses (submissions JSON, full-text
search) are cached per UTC day under data/raw/sec/_api/.

Usage: scripts/sec_fetch.py URL        -> prints the cached file path
"""

from __future__ import annotations

import fcntl
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "sec"
LOCK = ROOT / "data" / "raw" / ".sec_ratelimit"
MAX_RPS = 6
ARCHIVE = re.compile(r"https://www\.sec\.gov/Archives/edgar/data/(\d+)/(\d{18})/([^/?#]+)$")


def user_agent() -> str:
    ua = os.environ.get("SEC_USER_AGENT")
    env = ROOT / ".env"
    if not ua and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("SEC_USER_AGENT="):
                ua = line.split("=", 1)[1].strip()
    return ua or "Boardtape research@example.com"


def cache_path(url: str) -> Path:
    m = ARCHIVE.match(url)
    if m:
        cik, acc, name = m.groups()
        accession = f"{acc[:10]}-{acc[10:12]}-{acc[12:]}"
        return RAW / str(int(cik)) / accession / name
    day = datetime.now(UTC).strftime("%Y%m%d")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", url.split("://", 1)[-1])[:150]
    return RAW / "_api" / day / f"{slug}_{hashlib.sha1(url.encode()).hexdigest()[:8]}"


def throttle() -> None:
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK, "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        try:
            stamps = json.loads(f.read() or "[]")
        except json.JSONDecodeError:
            stamps = []
        now = time.time()
        stamps = [t for t in stamps if now - t < 1.0]
        if len(stamps) >= MAX_RPS:
            time.sleep(1.0 - (now - stamps[0]) + 0.01)
            now = time.time()
            stamps = [t for t in stamps if now - t < 1.0]
        stamps.append(now)
        f.seek(0)
        f.truncate()
        f.write(json.dumps(stamps))


def fetch(url: str) -> Path:
    path = cache_path(url)
    if path.exists():
        return path
    for attempt in range(5):
        throttle()
        req = urllib.request.Request(url, headers={"User-Agent": user_agent(), "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt * 2)
                continue
            raise SystemExit(f"HTTP {e.code} for {url}") from None
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(body)
    tmp.replace(path)
    return path


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    print(fetch(sys.argv[1]))
