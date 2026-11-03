"""Concurrent first touch of a profile.sqlite must not raise "database is locked".

Root cause of the test_t5190 bootstrap flake (Master CI run 41707150317,
2026-11-03): /api/bootstrap gathers several profile.sqlite reads concurrently on
worker threads, and on a user's first visit each one runs ensure_database()'s
first-time init at once (no per-profile serialization), creating the file in
rollback-journal mode. Each connection then runs `PRAGMA journal_mode=WAL` in
get_db_connection. Two connections switching one file to WAL at the same time is
a lock-upgrade deadlock, which SQLite refuses IMMEDIATELY (busy_timeout is not
consulted), so one request fails with sqlite3.OperationalError("database is
locked"). Same mechanism as the user.sqlite race fixed in 05848580f.

The decisive window is "schema created, WAL not yet set": the test reproduces it
by running the first-time init once, then bursting connections behind a barrier.
A second test bursts truly fresh profiles to cover the concurrent init itself.
"""

import sqlite3
import threading

import pytest

THREADS = 16
FRESH_PROFILES = 40


def _burst_first_touch(db, user_id, profile_id):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    barrier = threading.Barrier(THREADS)
    errors = []

    def touch():
        set_current_user_id(user_id)
        set_current_profile_id(profile_id)
        barrier.wait()
        try:
            with db.get_db_connection() as conn:
                conn.execute("SELECT COUNT(*) FROM raw_clips").fetchone()
        except sqlite3.OperationalError as e:
            errors.append(str(e))

    threads = [threading.Thread(target=touch) for _ in range(THREADS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def test_concurrent_first_touch_of_profile_db_has_no_lock_errors(tmp_path, monkeypatch):
    from app import database as db

    monkeypatch.setattr(db, "USER_DATA_BASE", tmp_path)
    monkeypatch.setattr(db, "R2_ENABLED", False)
    monkeypatch.setattr(db, "_initialized_users", set())

    errors = []
    for i in range(FRESH_PROFILES):
        errors += _burst_first_touch(db, f"race-user-{i}", "p1")
    _assert_clean(db, errors)


def test_burst_right_after_first_init_has_no_lock_errors(tmp_path, monkeypatch):
    from app import database as db
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    monkeypatch.setattr(db, "USER_DATA_BASE", tmp_path)
    monkeypatch.setattr(db, "R2_ENABLED", False)
    monkeypatch.setattr(db, "_initialized_users", set())

    errors = []
    for i in range(FRESH_PROFILES):
        set_current_user_id(f"race-user-{i}")
        set_current_profile_id("p1")
        db.ensure_database()
        errors += _burst_first_touch(db, f"race-user-{i}", "p1")
    _assert_clean(db, errors)


def _assert_clean(db, errors):

    assert errors == [], f"{len(errors)} first-touch lock errors: {errors[:3]}"
    for i in range(FRESH_PROFILES):
        conn = sqlite3.connect(str(db.profile_db_path(f"race-user-{i}", "p1")))
        try:
            assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        finally:
            conn.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
