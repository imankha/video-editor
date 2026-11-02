# ruff: noqa: F811  (env is a fixture imported from the T14380 suite)
"""T14390: an idle user whose last writes were never uploaded is synced, then evicted.

Heartbeat, session-close and /api/quests/achievements write user.sqlite on
SKIP_SYNC_PATHS, so almost every user who closed a tab reads DIRTY. The eviction
pass now uploads such a user (CAS, outside _EVICT_LOCK) and then evicts it in the
same pass; a failed or refused upload keeps the user resident and logs ERROR.

Also the T14380 review minors: an unmatched release logs CRITICAL (m2), per-user
skips are DEBUG with one INFO aggregate (m3), DB files left by an earlier process
are counted (m4), a rollback journal blocks eviction and is unlinked (m5), and the
privacy export fails loudly when the profile list cannot be read (m7).
"""

import logging
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from tests.test_t14380_db_eviction import (  # noqa: F401
    _db_files,
    _profile_path,
    _r2_rows,
    _residency,
    _seed,
    _set_context,
    _user_path,
    _write_projects,
    env,
)


def _make_idle(user: str) -> None:
    r = _residency()
    with r._EVICT_LOCK:
        r._LAST_USED[user] = time.monotonic() - 10 * r.MIN_IDLE_S


def _dirty_user_db(user: str) -> None:
    """What heartbeat / session-close / achievements do: write user.sqlite, no upload."""
    from app.services import user_db

    with user_db.get_user_db_connection(user) as conn:
        conn.execute("UPDATE profiles SET name = 'renamed' WHERE id = 'p1'")
        conn.commit()


def _pass(min_idle_s=None):
    r = _residency()
    kwargs = {} if min_idle_s is None else {"min_idle_s": min_idle_s}
    return r.run_eviction_pass(0, **kwargs)


# --------------------------------------------------------------------------- sync-before-evict

def test_dirty_idle_user_is_synced_then_evicted_in_one_pass(env, tmp_path_factory):
    """T14390:C1. Real MIN_IDLE_S: the pass's own holds must not make the user recent."""
    from app import storage

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    _write_projects(user, "p1", ["never uploaded"])
    _dirty_user_db(user)
    assert storage.db_write_state(_user_path(env.base, user)) == storage.DbWriteState.DIRTY
    _make_idle(user)

    report = _pass()

    assert _db_files(env.base, user) == [], f"a dirty idle user must be synced and evicted: {report}"
    assert user in report.evicted
    scratch = tmp_path_factory.mktemp("r2")
    assert _r2_rows(env.fake, user, "p1", scratch) == ["a", "never uploaded"], \
        "the evicted profile's unsynced row must be in R2"


@pytest.mark.parametrize("result", ["FAILED", "CONFLICT"])
@pytest.mark.parametrize("db", ["user", "profile"])
def test_failed_or_refused_upload_keeps_the_user_dirty_and_resident(env, caplog, result, db):
    """T14390:C2."""
    from app import database, storage
    from app.database import SyncResult

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    if db == "user":
        _dirty_user_db(user)
        target, fn = _user_path(env.base, user), "sync_user_db_to_r2_explicit"
    else:
        _write_projects(user, "p1", ["never uploaded"])
        target, fn = _profile_path(env.base, user, "p1"), "sync_db_to_r2_explicit"

    caplog.set_level(logging.INFO)
    with patch.object(database, fn, lambda *a, **k: SyncResult[result]):
        report = _pass(min_idle_s=0)

    assert len(_db_files(env.base, user)) == 2, f"evicted after a {result} upload"
    assert user not in report.evicted
    assert storage.db_write_state(target) == storage.DbWriteState.DIRTY
    assert any(r.levelno == logging.ERROR and user in r.getMessage() and "sync" in r.getMessage()
               for r in caplog.records), "a failed pre-evict sync must log ERROR"


def test_no_upload_runs_while_the_evict_lock_is_held(env):
    """T14390:C3."""
    from app import database

    r = _residency()
    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    _write_projects(user, "p1", ["b"])
    _dirty_user_db(user)
    seen = []
    real_user, real_profile = database.sync_user_db_to_r2_explicit, database.sync_db_to_r2_explicit

    def spy_user(*a, **k):
        seen.append(("user", r._EVICT_LOCK.locked(), r._HOLDS.get(user, 0)))
        return real_user(*a, **k)

    def spy_profile(*a, **k):
        seen.append(("profile", r._EVICT_LOCK.locked(), r._HOLDS.get(user, 0)))
        return real_profile(*a, **k)

    with patch.object(database, "sync_user_db_to_r2_explicit", spy_user), \
            patch.object(database, "sync_db_to_r2_explicit", spy_profile):
        _pass(min_idle_s=0)

    assert sorted(s[0] for s in seen) == ["profile", "user"], seen
    assert not any(locked for _, locked, _ in seen), f"an upload ran under _EVICT_LOCK: {seen}"
    assert all(holds > 0 for _, _, holds in seen), f"an upload ran without holding the user: {seen}"
    assert _db_files(env.base, user) == []


def test_marked_dirty_user_is_not_synced(env):
    """A marked user is the request path's / retry's business, never the pass's."""
    from app import database

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    _write_projects(user, "p1", ["b"])
    database.mark_sync_failed(user, "p1")
    calls = []
    with patch.object(database, "sync_db_to_r2_explicit", lambda *a, **k: calls.append(a)):
        _pass(min_idle_s=0)
    assert calls == []
    assert len(_db_files(env.base, user)) == 2


def test_recent_dirty_user_is_not_synced(env):
    from app import database

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    _write_projects(user, "p1", ["b"])
    calls = []
    with patch.object(database, "sync_db_to_r2_explicit", lambda *a, **k: calls.append(a)):
        _pass()  # just touched: recent under the real MIN_IDLE_S
    assert calls == []
    assert len(_db_files(env.base, user)) == 2


# --------------------------------------------------------------------------- review minors

def test_unmatched_release_logs_critical(caplog):
    """m2."""
    r = _residency()
    caplog.set_level(logging.INFO)
    try:
        r.release_hold("t14390-never-held")
        assert any(rec.levelno == logging.CRITICAL and "t14390-never-held" in rec.getMessage()
                   for rec in caplog.records)
        assert "t14390-never-held" not in r._HOLDS
        assert "t14390-never-held" not in r._LAST_USED, "an unmatched release is not use"
    finally:
        r._reset_for_tests()


def test_skips_log_one_info_aggregate_and_per_user_debug(env, caplog):
    """m3."""
    from app import database

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    caplog.set_level(logging.INFO, logger="app.services.db_residency")
    with database.get_db_connection():
        _pass(min_idle_s=0)
    info = [rec.getMessage() for rec in caplog.records if rec.levelno == logging.INFO]
    assert not any("skip user=" in m for m in info), f"per-user skip lines must be DEBUG: {info}"
    assert any("skipped={'held': 1}" in m for m in info), info

    caplog.clear()
    caplog.set_level(logging.DEBUG, logger="app.services.db_residency")
    with database.get_db_connection():
        _pass(min_idle_s=0)
    assert f"skip user={user} reason=held" in caplog.text


def test_db_files_left_by_an_earlier_process_are_counted(env):
    """m4: a restart empties _LAST_USED; the startup scan puts the files back."""
    r = _residency()
    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    with r._EVICT_LOCK:
        r._LAST_USED.clear()
    assert r.resident_bytes() == 0

    r.seed_resident_users()

    assert user in r._LAST_USED
    assert r.resident_bytes() == sum(p.stat().st_size for p in _db_files(env.base, user))


def test_rollback_journal_blocks_eviction_and_is_unlinked(env, caplog):
    """m5."""
    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    journal = Path(str(_profile_path(env.base, user, "p1")) + "-journal")
    journal.write_bytes(b"x")

    caplog.set_level(logging.DEBUG)
    _pass(min_idle_s=0)
    assert len(_db_files(env.base, user)) == 2, "evicted under a rollback journal"
    assert "reason=sidecar" in caplog.text

    r = _residency()
    real = r._sidecars_present
    with patch.object(r, "_sidecars_present", lambda db: real(db) and db.name != "profile.sqlite"):
        _pass(min_idle_s=0)
    assert _db_files(env.base, user) == []
    assert not journal.exists(), "the -journal must be unlinked with its DB"


@pytest.mark.asyncio
async def test_privacy_export_fails_loudly_when_profiles_cannot_be_listed(env, monkeypatch):
    """m7: an export missing profiles must not look complete."""
    from unittest.mock import MagicMock

    from app.routers.privacy import export_user_data

    user = env.new_user()
    _seed(user, {"p1": ["a"]})

    def broken(_uid):
        raise RuntimeError("user.sqlite unreadable")

    monkeypatch.setattr("app.routers.privacy.get_user_by_id", lambda uid: None)
    monkeypatch.setattr("app.routers.privacy.get_profiles", broken)
    _set_context(user, "p1")
    with pytest.raises(RuntimeError, match="unreadable"):
        await export_user_data(MagicMock())
