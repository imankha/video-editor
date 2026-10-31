"""T13965: pg_conn builds the Postgres schema once per session, not per test.

Sentinel: a COMMENT on user_actions. The old per-test rebuild DROPs and
recreates user_actions, wiping the comment; a once-per-session build keeps it.
Tests run in file order (pytest default); each depends on the previous one.
"""
import psycopg2

_SENTINEL = "t13965-sentinel"


def _comment(dsn):
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        cur.execute("SELECT obj_description('user_actions'::regclass, 'pg_class')")
        return cur.fetchone()[0]
    finally:
        conn.close()


def _set_comment(dsn, text):
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    conn.cursor().execute(f"COMMENT ON TABLE user_actions IS '{text}'")
    conn.close()


def test_a_plant_sentinel(pg_conn):
    _set_comment(pg_conn, _SENTINEL)
    assert _comment(pg_conn) == _SENTINEL


def test_b_schema_not_rebuilt_per_test(pg_conn):
    assert _comment(pg_conn) == _SENTINEL, "pg_conn rebuilt the schema for this test"


def test_c_dirty_mark_forces_rebuild(pg_conn):
    from tests.conftest import mark_pg_schema_dirty
    mark_pg_schema_dirty()
    # the NEXT pg_conn setup must rebuild; simulated in test_d
    assert _comment(pg_conn) == _SENTINEL


def test_d_rebuilt_after_dirty(pg_conn):
    assert _comment(pg_conn) is None, "dirty mark did not trigger a schema rebuild"
