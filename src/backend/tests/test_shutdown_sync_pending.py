"""T14150: SIGTERM shutdown uploads only DBs with a .sync_pending marker, oldest first."""
import logging
import os
import time
from unittest.mock import patch

import pytest

from app import database, main

N_CLEAN = 2000


def _make_profile(base, user, profile):
    d = base / user / "profiles" / profile
    d.mkdir(parents=True)
    (d / "profile.sqlite").write_bytes(b"")
    return d / "profile.sqlite"


@pytest.fixture
def user_base(tmp_path):
    with patch.object(database, "USER_DATA_BASE", tmp_path), \
         patch("app.storage.R2_ENABLED", True), \
         patch("app.services.analytics_store.final_flush_blocking"), \
         patch("sqlite3.connect"):
        yield tmp_path


def _run_shutdown():
    with pytest.raises(SystemExit):
        main._run_graceful_shutdown()


def test_only_pending_dbs_are_uploaded(user_base):
    for i in range(N_CLEAN):
        _make_profile(user_base, f"clean{i}", "p1")
    _make_profile(user_base, "dirty", "p9")
    database.mark_sync_pending("dirty", "p9")

    calls = []

    def fake_sync(user_id, db_file, version, skip_version_check=False, profile_id=None):
        calls.append((user_id, profile_id))
        return True, version + 1

    with patch("app.storage.sync_database_to_r2_with_version", side_effect=fake_sync), \
         patch("app.storage.sync_user_db_to_r2_with_version") as user_sync, \
         patch.object(database, "get_local_db_version", return_value=1):
        start = time.perf_counter()
        _run_shutdown()
        elapsed = time.perf_counter() - start

    assert calls == [("dirty", "p9")]
    user_sync.assert_not_called()
    assert elapsed < 5


def test_pending_synced_oldest_first_and_user_db(user_base):
    for user, profile in [("a", "pa"), ("b", "pb")]:
        _make_profile(user_base, user, profile)
    (user_base / "c").mkdir()
    (user_base / "c" / "user.sqlite").write_bytes(b"")
    database.mark_sync_pending("b", "pb")
    database.mark_sync_pending("c", database.USER_DB_SCOPE)
    database.mark_sync_pending("a", "pa")
    now = time.time()
    for user, scope, age in [("b", "pb", 300), ("c", "user", 200), ("a", "pa", 100)]:
        marker = database._scoped_marker_path(user, "pending", scope)
        os.utime(marker, (now - age, now - age))

    order = []
    with patch("app.storage.sync_database_to_r2_with_version",
               side_effect=lambda u, f, v, skip_version_check=False, profile_id=None:
               (order.append(u), (True, 2))[1]), \
         patch("app.storage.sync_user_db_to_r2_with_version",
               side_effect=lambda u, f, v, skip_version_check=False:
               (order.append(u), (True, 2))[1]), \
         patch.object(database, "get_local_db_version", return_value=1), \
         patch.object(database, "get_local_user_db_version", return_value=1):
        _run_shutdown()

    assert order == ["b", "c", "a"]


def test_unsynced_pending_at_deadline_logs_critical(user_base, caplog):
    for user in ("a", "b"):
        _make_profile(user_base, user, "p")
        database.mark_sync_pending(user, "p")

    def slow_sync(*a, **kw):
        time.sleep(0.05)
        return True, 2

    with patch.object(main, "SHUTDOWN_SYNC_DEADLINE_S", 0.01), \
         patch("app.storage.sync_database_to_r2_with_version", side_effect=slow_sync), \
         patch.object(database, "get_local_db_version", return_value=1), \
         caplog.at_level(logging.CRITICAL):
        _run_shutdown()

    critical = [r for r in caplog.records if r.levelno == logging.CRITICAL]
    assert critical and "pending" in critical[0].getMessage()
