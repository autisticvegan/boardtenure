"""Runtime configuration from the environment (and an optional repo-root .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Freshness target: the product shows historical performance, so stored prices and filings
# may lag by up to a week. Refresh runs weekly; staleness alarms allow a weekend/holiday margin.
FRESHNESS_DAYS = 7
STALE_AFTER_DAYS = FRESHNESS_DAYS + 3


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    raw_store: Path
    sec_user_agent: str | None
    anthropic_api_key: str | None

    def require_sec_user_agent(self) -> str:
        # SEC fair-access policy: identify yourself with a reachable contact address.
        if not self.sec_user_agent:
            raise SystemExit(
                "SEC_USER_AGENT is not set. EDGAR requires a declared User-Agent such as "
                "'BoardTenure you@yourdomain.com'; set it in .env."
            )
        return self.sec_user_agent


def settings() -> Settings:
    return Settings(
        database_url=os.environ.get("DATABASE_URL", "postgresql:///boardtenure_dev"),
        raw_store=Path(os.environ.get("RAW_STORE_DIR", REPO_ROOT / "data" / "raw")),
        sec_user_agent=os.environ.get("SEC_USER_AGENT") or None,
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
    )
