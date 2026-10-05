"""Quality checks fire on bad data and resolve when it's fixed (dev DB; rolled back)."""

import pytest


@pytest.fixture
def conn():
    psycopg = pytest.importorskip("psycopg")
    from bt.db import connect

    try:
        c = connect("test:quality")
    except psycopg.OperationalError:
        pytest.skip("dev database not available")
    if not c.execute("SELECT 1 FROM company WHERE slug = 'lyft'").fetchone():
        pytest.skip("lyft not loaded")
    yield c
    c.rollback()
    c.close()


def test_bad_membership_is_flagged_then_resolved(conn):
    from bt.quality import checks

    company = conn.execute("SELECT id FROM company WHERE slug = 'lyft'").fetchone()["id"]
    pid = conn.execute("INSERT INTO person (slug, full_name) VALUES ('qa-test-person', 'Qa Test Person') "
                       "RETURNING id").fetchone()["id"]
    mid = conn.execute(
        """INSERT INTO board_membership (company_id, person_id, status, start_date, start_precision, end_date,
                                         end_precision, end_reason, confidence)
           VALUES (%s, %s, 'former', '2024-05-01', 'day', '2024-01-01', 'day', 'resigned', 'high') RETURNING id""",
        (company, pid),
    ).fetchone()["id"]
    checks.run(conn)
    issues = {r["check_code"] for r in conn.execute(
        "SELECT check_code FROM data_issue WHERE subject_id = %s AND status = 'open'", (mid,))}
    assert {"membership_end_before_start", "membership_without_evidence"} <= issues

    conn.execute("UPDATE board_membership SET end_date = '2024-09-01' WHERE id = %s", (mid,))
    checks.run(conn)
    status = conn.execute(
        "SELECT status FROM data_issue WHERE fingerprint = %s", (f"membership_end_before_start:{mid}",)
    ).fetchone()["status"]
    assert status == "resolved"
