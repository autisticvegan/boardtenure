"""Database access: connections that identify their writer, and the migration runner."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from bt.config import REPO_ROOT, settings

MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"


def connect(actor: str, reason: str | None = None) -> psycopg.Connection:
    """Open a connection whose writes are attributed to `actor` in audit_log."""
    conn = psycopg.connect(settings().database_url, row_factory=dict_row)
    conn.execute("SELECT set_config('bt.actor', %s, false), set_config('bt.reason', %s, false)",
                 (actor, reason or ""))
    conn.commit()
    return conn


@contextmanager
def session(actor: str, reason: str | None = None):
    conn = connect(actor, reason)
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def migrate(conn: psycopg.Connection, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply pending forward-only migrations in filename order, each in its own transaction."""
    conn.execute("""CREATE TABLE IF NOT EXISTS schema_migration (
                      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())""")
    conn.commit()
    applied = {r["version"] for r in conn.execute("SELECT version FROM schema_migration")}
    done = []
    for path in sorted(migrations_dir.glob("*.sql")):
        if path.stem in applied:
            continue
        with conn.transaction():
            conn.execute(path.read_text())
            conn.execute("INSERT INTO schema_migration (version) VALUES (%s)", (path.stem,))
        done.append(path.stem)
    return done
