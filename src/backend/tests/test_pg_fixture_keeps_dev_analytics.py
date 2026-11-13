"""T14210: the pg_conn schema rebuild must not delete rows the tests didn't create.

pg_conn runs against the SHARED dev Postgres. Rebuilding the analytics schema
used to DROP user_actions / user_segments unconditionally, wiping every dev
user's analytics rows and segment origins on every test session.
"""
import os

import psycopg2
from psycopg2.extras import RealDictCursor

from tests.conftest import _build_pg_schema, mark_pg_schema_dirty

_REAL_USER = "t14210-real-dev-user"


def _connect():
    conn = psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)
    conn.autocommit = True
    return conn


def _cleanup(cur):
    cur.execute("DELETE FROM user_actions WHERE user_id = %s", (_REAL_USER,))
    cur.execute("DELETE FROM user_segments WHERE user_id = %s", (_REAL_USER,))
    cur.execute("DELETE FROM users WHERE user_id = %s", (_REAL_USER,))


def test_schema_rebuild_keeps_non_test_analytics_rows(pg_conn):
    conn = _connect()
    cur = conn.cursor()
    try:
        _cleanup(cur)
        cur.execute(
            "INSERT INTO users (user_id, email) VALUES (%s, %s)",
            (_REAL_USER, "t14210@example.invalid"),
        )
        cur.execute(
            "INSERT INTO user_segments (user_id, acquired_at, origin) VALUES (%s, '2020-01-02', 'meta-ads')",
            (_REAL_USER,),
        )
        cur.execute(
            "INSERT INTO user_actions (user_id, action, platform) VALUES (%s, 'session_started', 'web')",
            (_REAL_USER,),
        )

        mark_pg_schema_dirty()
        _build_pg_schema(cur)

        cur.execute("SELECT acquired_at::text AS d, origin FROM user_segments WHERE user_id = %s", (_REAL_USER,))
        seg = cur.fetchone()
        cur.execute("SELECT count(*) AS n FROM user_actions WHERE user_id = %s", (_REAL_USER,))
        actions = cur.fetchone()["n"]
        assert seg == {"d": "2020-01-02", "origin": "meta-ads"}
        assert actions == 1
    finally:
        _cleanup(cur)
        conn.close()



# T15300: the stale-legacy-table repair test lived here and DROPped the real dev
# user_actions to stage itself; it now runs in a scratch schema in
# test_t15300_pg_fixture_stale_analytics.py.
