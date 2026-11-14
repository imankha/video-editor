"""T15300: a stale analytics schema must never cost the shared dev Postgres its rows.

pg_conn runs against the SHARED dev Postgres. When the analytics tables drifted
from _SCHEMA_DDL (another branch's column, a test's sentinel), _build_pg_schema
DROPped user_actions/user_segments outright and recreated them empty: every dev
account's segment origins and actions were lost (found on g-t15200-1).

Each test builds the schema in its own scratch Postgres schema (search_path set
to it alone), so nothing here can reach the real public tables.
"""
import os
import uuid
from pathlib import Path

import psycopg2
import pytest
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

from tests.conftest import _build_pg_schema

_USER = "t15300-real-dev-user"


@pytest.fixture
def scratch_cur():
    load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")
    dsn = os.environ["DATABASE_URL"]
    if "staging" in dsn or "prod" in dsn or "production" in dsn:
        raise RuntimeError("REFUSING to run tests: DATABASE_URL points to a non-dev database.")
    schema = f"t15300_{uuid.uuid4().hex[:10]}"
    conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(f"CREATE SCHEMA {schema}")
    cur.execute(f"SET search_path TO {schema}")
    cur.execute("SELECT current_schema() AS s")
    assert cur.fetchone()["s"] == schema
    try:
        _build_pg_schema(cur)
        cur.execute("INSERT INTO users (user_id, email) VALUES (%s, 't15300@example.invalid')", (_USER,))
        cur.execute(
            "INSERT INTO user_segments (user_id, acquired_at, origin) VALUES (%s, '2020-01-02', 'meta-ads')",
            (_USER,),
        )
        cur.execute(
            "INSERT INTO user_actions (user_id, action, platform) VALUES (%s, 'session_started', 'web')",
            (_USER,),
        )
        yield cur
    finally:
        cur.execute(f"DROP SCHEMA {schema} CASCADE")
        conn.close()


def _rows(cur):
    cur.execute("SELECT acquired_at::text AS d, origin FROM user_segments WHERE user_id = %s", (_USER,))
    seg = cur.fetchall()
    cur.execute("SELECT action FROM user_actions WHERE user_id = %s", (_USER,))
    return seg, [r["action"] for r in cur.fetchall()]


def _columns(cur, table):
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = %s", (table,))
    return {r["column_name"] for r in cur.fetchall()}


def test_drifted_tables_keep_their_rows_and_lose_the_empty_drift(scratch_cur):
    cur = scratch_cur
    cur.execute("ALTER TABLE user_segments ADD COLUMN t15300_branch_col TEXT")
    cur.execute("ALTER TABLE user_actions ADD COLUMN t15300_branch_col TEXT")

    _build_pg_schema(cur)

    assert _rows(cur) == ([{"d": "2020-01-02", "origin": "meta-ads"}], ["session_started"])
    assert "t15300_branch_col" not in _columns(cur, "user_segments")
    assert "t15300_branch_col" not in _columns(cur, "user_actions")


def test_drift_holding_data_refuses_without_changing_anything(scratch_cur):
    cur = scratch_cur
    cur.execute("ALTER TABLE user_segments ADD COLUMN t15300_branch_col TEXT")
    cur.execute("UPDATE user_segments SET t15300_branch_col = 'kept' WHERE user_id = %s", (_USER,))

    with pytest.raises(RuntimeError, match="user_segments"):
        _build_pg_schema(cur)

    assert _rows(cur) == ([{"d": "2020-01-02", "origin": "meta-ads"}], ["session_started"])
    cur.execute("SELECT t15300_branch_col FROM user_segments WHERE user_id = %s", (_USER,))
    assert cur.fetchone()["t15300_branch_col"] == "kept"


def test_legacy_shape_with_rows_refuses_instead_of_dropping(scratch_cur):
    cur = scratch_cur
    cur.execute("ALTER TABLE user_actions ALTER COLUMN platform TYPE varchar(8)")

    with pytest.raises(RuntimeError, match="user_actions"):
        _build_pg_schema(cur)

    assert _rows(cur) == ([{"d": "2020-01-02", "origin": "meta-ads"}], ["session_started"])


def test_empty_stale_table_is_still_rebuilt(scratch_cur):
    cur = scratch_cur
    cur.execute("DROP TABLE user_actions CASCADE")
    cur.execute("CREATE TABLE user_actions (user_id TEXT NOT NULL, event TEXT NOT NULL, count INTEGER)")

    _build_pg_schema(cur)

    cols = _columns(cur, "user_actions")
    assert {"action", "platform"} <= cols
    assert "event" not in cols
    cur.execute("SELECT count(*) AS n FROM user_segments WHERE user_id = %s", (_USER,))
    assert cur.fetchone()["n"] == 1
