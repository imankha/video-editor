"""T14150: SIGTERM shutdown uploads only DBs that may differ from R2 (a .sync_pending
marker, or changed since their last restore/upload), pending oldest first."""
import logging
import os
import time
from unittest.mock import patch

import pytest

from app import database, main, storage

N_CLEAN = 2000


def _make_profile(base, user, profile):
    d = base / user / "profiles" / profile
    d.mkdir(parents=True)
    (d / "profile.sqlite").write_bytes(b"")
    return d / "profile.sqlite"


def _restored(path):
    """Record `path` as just restored from R2 (what the download primitives do)."""
    storage.commit_db_clean_mark(path, storage.capture_db_clean_mark(path))
    return path


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
        _restored(_make_profile(user_base, f"clean{i}", "p1"))
    _restored(_make_profile(user_base, "dirty", "p9"))
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


def _collect_uploads():
    calls = []
    profile = patch("app.storage.sync_database_to_r2_with_version",
                    side_effect=lambda u, f, v, skip_version_check=False, profile_id=None:
                    (calls.append((u, profile_id)), (True, 2))[1])
    user = patch("app.storage.sync_user_db_to_r2_with_version",
                 side_effect=lambda u, f, v, skip_version_check=False:
                 (calls.append((u, database.USER_DB_SCOPE)), (True, 2))[1])
    return calls, profile, user


def test_db_written_without_a_pending_marker_is_uploaded(user_base):
    # A write outside a request (webhook, export worker, admin cross-user grant) leaves
    # no .sync_pending marker: that is only written when an upload FAILS. Local disk
    # dies with the machine, so such a DB must still be uploaded (T4320 guarantee).
    _make_profile(user_base, "worker", "p1")
    (user_base / "webhook").mkdir()
    (user_base / "webhook" / "user.sqlite").write_bytes(b"")
    calls, profile, user = _collect_uploads()
    with profile, user, \
         patch.object(database, "get_local_db_version", return_value=1), \
         patch.object(database, "get_local_user_db_version", return_value=1):
        _run_shutdown()
    assert sorted(calls) == [("webhook", database.USER_DB_SCOPE), ("worker", "p1")]


def test_change_after_restore_is_uploaded_untouched_restore_is_not(user_base):
    untouched = _restored(_make_profile(user_base, "untouched", "p1"))
    raw_write = _restored(_make_profile(user_base, "raw", "p2"))
    raw_write.write_bytes(b"page")  # a raw sqlite3 writer (migration, materialization)
    tracked = _restored(_make_profile(user_base, "tracked", "p3"))
    storage.note_db_write(tracked)  # TrackedConnection write, file not yet changed
    wal = _restored(_make_profile(user_base, "wal", "p4"))
    (wal.parent / "profile.sqlite-wal").write_bytes(b"frame")  # committed, not checkpointed
    (untouched.parent / "profile.sqlite-wal").write_bytes(b"")  # a reader opened it: empty WAL
    calls, profile, user = _collect_uploads()
    with profile, user, patch.object(database, "get_local_db_version", return_value=1):
        _run_shutdown()
    assert sorted(calls) == [("raw", "p2"), ("tracked", "p3"), ("wal", "p4")]


def test_pending_dbs_go_before_other_changed_dbs(user_base):
    _make_profile(user_base, "changed", "p1")
    _restored(_make_profile(user_base, "pending", "p2"))
    database.mark_sync_pending("pending", "p2")
    calls, profile, user = _collect_uploads()
    with profile, user, patch.object(database, "get_local_db_version", return_value=1):
        _run_shutdown()
    assert calls == [("pending", "p2"), ("changed", "p1")]


def test_unmarked_db_untouched_since_process_start_is_skipped(user_base):
    # A local file this process never restored, uploaded or wrote (left by a previous
    # process on a dev disk) is the previous process's responsibility; re-uploading it
    # with no version baseline is CAS-refused and logged as lost on every restart.
    old = _make_profile(user_base, "leftover", "p1")
    past = time.time() - 3600
    os.utime(old, (past, past))
    _make_profile(user_base, "new-this-boot", "p2")
    calls, profile, user = _collect_uploads()
    with profile, user, patch.object(database, "get_local_db_version", return_value=1):
        _run_shutdown()
    assert calls == [("new-this-boot", "p2")]
