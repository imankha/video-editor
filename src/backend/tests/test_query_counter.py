"""Self-test + usage example for the query_counter fixture (conftest.py).

The fixture exists to catch N+1 query patterns at test time: seed N rows,
hit the endpoint, assert the statement count stays flat as N grows.
"""
import sqlite3


def test_query_counter_counts_statements(query_counter, tmp_path):
    conn = sqlite3.connect(str(tmp_path / "t.sqlite"))
    conn.execute("CREATE TABLE t (id INTEGER)")
    conn.executemany("INSERT INTO t VALUES (?)", [(i,) for i in range(3)])
    conn.execute("SELECT * FROM t").fetchall()
    conn.close()

    assert any("CREATE TABLE" in s for s in query_counter.statements)
    assert len(query_counter.selects) == 1


def test_query_counter_flat_under_growth(query_counter, tmp_path):
    """The pattern real endpoint tests should follow: query count must not
    scale with row count (one SELECT for 3 rows AND for 300 rows)."""
    conn = sqlite3.connect(str(tmp_path / "t.sqlite"))
    conn.execute("CREATE TABLE reels (id INTEGER)")
    conn.executemany("INSERT INTO reels VALUES (?)", [(i,) for i in range(300)])

    before = len(query_counter.selects)
    conn.execute("SELECT * FROM reels").fetchall()
    assert len(query_counter.selects) - before == 1  # flat: not one-per-row
    conn.close()
