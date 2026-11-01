"""T13965: pg_conn builds the Postgres schema once per session, not per test.

Sentinel: a stray column on user_actions (schema drift, as a test that alters the
schema leaves it). A per-test rebuild would remove it; a once-per-session build
keeps it until a test marks the schema dirty, and then the rebuild must remove it.
T14210: the rebuild drops the analytics tables only on such drift, never on a
clean shape, so the sentinel must be structural (a COMMENT is not drift).
Tests run in file order (pytest default); each depends on the previous one.
"""
import psycopg2

_SENTINEL = "t13965_sentinel"


def _has_sentinel(dsn):
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'user_actions' AND column_name = %s", (_SENTINEL,))
        return cur.fetchone() is not None
    finally:
        conn.close()


def test_a_plant_sentinel(pg_conn):
    conn = psycopg2.connect(pg_conn)
    conn.autocommit = True
    conn.cursor().execute(f"ALTER TABLE user_actions ADD COLUMN {_SENTINEL} TEXT")
    conn.close()
    assert _has_sentinel(pg_conn)


def test_b_schema_not_rebuilt_per_test(pg_conn):
    assert _has_sentinel(pg_conn), "pg_conn rebuilt the schema for this test"


def test_c_dirty_mark_forces_rebuild(pg_conn):
    from tests.conftest import mark_pg_schema_dirty
    mark_pg_schema_dirty()
    # the NEXT pg_conn setup must rebuild; simulated in test_d
    assert _has_sentinel(pg_conn)


def test_d_rebuilt_after_dirty(pg_conn):
    assert not _has_sentinel(pg_conn), "dirty mark did not repair the drifted analytics schema"
