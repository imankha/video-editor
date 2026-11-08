"""T15280: analytics_store's PRAGMA user_version schema ladder.

T13930/T14030 already built analytics_store.py (per-writer shards, R2 CAS upload,
_ensure_schema with additive schema steps) and test_t13930_analytics_store.py already
covers open/create + env-prefixed-key persistence + etag-conflict refusal (T15280:C1).
This file adds the one acceptance criterion that had no direct test anywhere:
a DB already stamped at an older PRAGMA user_version reaches the current version too,
not just a brand new file (T15280:C2).

Run with: pytest tests/test_analytics_store.py -v
"""

import sqlite3

from app.services.analytics_store import _SCHEMA_STEPS, _ensure_schema

CURRENT_VERSION = max(_SCHEMA_STEPS)


def test_fresh_file_reaches_current_version():
    conn = sqlite3.connect(":memory:")
    _ensure_schema(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == CURRENT_VERSION
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "r2_ops_daily" in tables
    assert "rollup_meta" in tables  # step 2 table present on a fresh file too


def test_version_1_file_reaches_current_version():
    # Simulate a shard written before step 2 shipped: only step-1 tables, user_version=1.
    conn = sqlite3.connect(":memory:")
    for statement in _SCHEMA_STEPS[1]:
        conn.execute(statement)
    conn.execute("PRAGMA user_version = 1")
    conn.commit()

    _ensure_schema(conn)

    assert conn.execute("PRAGMA user_version").fetchone()[0] == CURRENT_VERSION
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "rollup_meta" in tables, "step 2 must run on top of an existing version-1 file"
    # Pre-existing step-1 data survives the ladder (additive, never destructive).
    conn.execute("INSERT INTO store_meta (key, value) VALUES ('writer_id', 'pre-existing')")
    conn.commit()
    _ensure_schema(conn)  # idempotent: re-running on an already-current file is a no-op
    assert conn.execute("SELECT value FROM store_meta WHERE key = 'writer_id'").fetchone()[0] == "pre-existing"
