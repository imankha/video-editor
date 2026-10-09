"""Concurrent first touch of a user's user.sqlite must not raise "database is locked".

Root cause of the recurring test_t6200_concurrency burst flake (docs/testing/
known-failures.md): ensure_user_database() only guards its "already initialized"
check, so every request that arrives before the first one finishes runs the whole
first-time init at once -- each opens its own connection and runs
`PRAGMA journal_mode=WAL` + the schema script. Switching a fresh file into WAL
needs an exclusive lock, so a concurrent arrival can fail with
sqlite3.OperationalError("database is locked") instead of waiting. In production
this is a user's burst of first requests after a cold start (or after a reheal
drops the init flag).

This test starts many threads behind a barrier on fresh users so they all reach
the init path together, which makes the race fire reliably instead of ~1 in 25.
"""

import sqlite3
import threading

import pytest

THREADS = 16
FRESH_USERS = 60


def _burst_first_touch(m, user_id):
    barrier = threading.Barrier(THREADS)
    errors = []

    def touch():
        barrier.wait()
        try:
            m.ensure_user_database(user_id)
        except sqlite3.OperationalError as e:
            errors.append(str(e))

    threads = [threading.Thread(target=touch) for _ in range(THREADS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def test_concurrent_first_touch_initializes_without_lock_errors(tmp_path, monkeypatch):
    from app.services import user_db as m

    monkeypatch.setattr(m, "USER_DATA_BASE", tmp_path)
    monkeypatch.setattr(m, "_initialized_user_dbs", set())

    errors = []
    for i in range(FRESH_USERS):
        errors += _burst_first_touch(m, f"race-user-{i}")

    assert errors == [], f"{len(errors)} first-touch lock errors: {errors[:3]}"
    # Every user ends up initialized, at head schema, in WAL mode.
    from app.migrations.user_db import RUNNER

    for i in range(FRESH_USERS):
        conn = sqlite3.connect(str(tmp_path / f"race-user-{i}" / "user.sqlite"))
        try:
            assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            assert conn.execute("PRAGMA user_version").fetchone()[0] == RUNNER.latest_version
        finally:
            conn.close()
        assert f"race-user-{i}" in m._initialized_user_dbs


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
