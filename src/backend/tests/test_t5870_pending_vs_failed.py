"""T5870: separate "pending" from "failed"; re-drain a transient failure; make
Retry recover without a page refresh; resolve a conflict via restore-if-newer.

Drives the REAL markers, the REAL sync_status_header decision, and the REAL
_background_sync (only the R2 boundary is patched). Each of the four
acceptance-criterion regressions is designed to go RED when its production hunk
is reverted (demonstrated in the task report).
"""

import asyncio
from unittest.mock import patch

import pytest

import app.database as db_module
from app.database import (
    SyncResult,
    has_sync_conflict,
    has_sync_failed,
    has_sync_pending,
    mark_sync_conflict,
    mark_sync_failed,
    mark_sync_pending,
)
from app.middleware import db_sync
from app.middleware.db_sync import (
    RequestContextMiddleware,
    _begin_sync_attempt,
    _end_sync_attempt,
    is_sync_failed,
    sync_status_header,
)


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    """Fresh markers + in-progress state + fast re-drain backoff per test."""
    monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
    monkeypatch.setattr(db_sync, "_SYNC_IN_PROGRESS", {})
    monkeypatch.setattr(db_sync, "_REDRAIN_BASE_BACKOFF_S", 0.001)
    yield


def _run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------
# Criterion 1: a merely pending/in-flight sync never tells the user it failed.
# --------------------------------------------------------------------------
class TestPendingIsNotFailed:
    def test_pending_marker_alone_is_not_a_failure(self):
        u = "t5870-pending"
        mark_sync_pending(u, scope="prof1")
        assert has_sync_pending(u)
        # RED without fix: old is_sync_failed := has_sync_pending returned True.
        assert is_sync_failed(u) is False

    def test_pending_marker_emits_quiet_pending_header(self):
        u = "t5870-pending-hdr"
        mark_sync_pending(u, scope="prof1")
        assert sync_status_header(u) == "pending"

    def test_in_flight_sync_suppresses_header(self):
        u = "t5870-inflight"
        mark_sync_pending(u, scope="prof1")
        _begin_sync_attempt(u)
        assert sync_status_header(u) is None  # covered by the in-progress set
        _end_sync_attempt(u)
        assert sync_status_header(u) == "pending"

    def test_failed_marker_emits_failed_header(self):
        u = "t5870-failed-hdr"
        mark_sync_pending(u, scope="prof1")
        mark_sync_failed(u)
        assert is_sync_failed(u) is True
        assert sync_status_header(u) == "failed"

    def test_conflict_outranks_failed(self):
        u = "t5870-conflict-hdr"
        mark_sync_pending(u, scope="prof1")
        mark_sync_failed(u)
        mark_sync_conflict(u)
        assert sync_status_header(u) == "conflict"


# --------------------------------------------------------------------------
# Criterion 2: a transient failure is re-drained in-band and never alarms.
# --------------------------------------------------------------------------
class TestReDrainHealsTransient:
    def test_transient_failure_then_successful_retry_clears_silently(self):
        """First sync FAILS (e.g. a 0.5s defer); the bounded re-drain retries and
        succeeds. The write lands, markers clear, and NO failed header is shown.

        RED without fix: remove the re-drain call in _background_sync -> the
        marker stays and sync_status_header returns 'failed'.
        """
        u = "t5870-redrain-heal"
        # T5081: scoped, matching what a real had_writes=True request marks.
        mark_sync_pending(u, scope="prof1")
        _begin_sync_attempt(u)
        mw = RequestContextMiddleware(app=None)

        with patch("app.middleware.db_sync.sync_db_to_r2_explicit",
                   return_value=SyncResult.FAILED), \
             patch("app.middleware.db_sync.retry_pending_sync", return_value=True):
            _run(mw._background_sync(
                u, "prof1", "rid", "POST", "/clips/working/actions",
                had_writes=True, had_user_db_writes=False,
                do_profile=False, force_profile=False,
            ))

        assert not has_sync_failed(u), "re-drain healed it -> no genuine failure"
        assert not has_sync_pending(u), "healed write clears the pending marker"
        assert sync_status_header(u) is None, "no banner after a healed transient failure"

    def test_exhausted_redrain_marks_genuinely_failed(self):
        """When every re-drain attempt fails, the write IS genuinely failed and
        the user must be told (no silencing)."""
        from app.middleware.db_sync import PendingDrainReport

        u = "t5870-redrain-exhaust"
        mark_sync_pending(u, scope="prof1")
        _begin_sync_attempt(u)
        mw = RequestContextMiddleware(app=None)

        # T5081: _redrain_failed_sync now calls drain_pending_scopes directly
        # (not retry_pending_sync) — patch THAT to keep reporting a failure.
        failed_report = PendingDrainReport(
            attempted={"prof1": SyncResult.FAILED}, orphaned=set(), not_pending=set())

        with patch("app.middleware.db_sync.sync_db_to_r2_explicit",
                   return_value=SyncResult.FAILED), \
             patch("app.middleware.db_sync.drain_pending_scopes", return_value=failed_report):
            _run(mw._background_sync(
                u, "prof1", "rid", "POST", "/clips/working/actions",
                had_writes=True, had_user_db_writes=False,
                do_profile=False, force_profile=False,
            ))

        assert has_sync_failed(u), "an unrecoverable failure must be marked failed"
        assert sync_status_header(u) == "failed"

    def test_conflict_skips_redrain(self):
        """A CAS conflict is NOT blind-retryable -> the re-drain (drain_pending_scopes)
        must not run; it is surfaced as 'conflict' for the restore path instead."""
        u = "t5870-conflict-skip"
        mark_sync_pending(u, scope="prof1")
        _begin_sync_attempt(u)
        mw = RequestContextMiddleware(app=None)

        def _conflict(user_id, profile_id, lock_timeout=None, skip_version_check=False):
            mark_sync_conflict(user_id)          # mirrors real sync_db_to_r2_explicit
            return SyncResult.CONFLICT

        with patch("app.middleware.db_sync.sync_db_to_r2_explicit", side_effect=_conflict), \
             patch("app.middleware.db_sync.drain_pending_scopes", return_value=None) as drain_fn:
            _run(mw._background_sync(
                u, "prof1", "rid", "POST", "/clips/working/actions",
                had_writes=True, had_user_db_writes=False,
                do_profile=False, force_profile=False,
            ))
            drain_fn.assert_not_called()

        assert has_sync_conflict(u)
        assert sync_status_header(u) == "conflict"


# --------------------------------------------------------------------------
# Criterion 4: Retry (or the next write's sync) recovers WITHOUT a refresh.
# --------------------------------------------------------------------------
class TestRecoversWithoutRefresh:
    def test_failed_banner_clears_on_next_successful_sync_no_refresh(self, tmp_path):
        """A 'failed' banner is showing. The user's next edit syncs successfully;
        the banner clears with NO page reload.

        T5081 (review round 3): the .sync_failed clear-on-success now lives
        INSIDE sync_db_to_r2_explicit itself (alongside its INV-P pending
        clear) rather than in _background_sync's own "ok" branch — mocking the
        primitive away bypasses that real clearing, so this drives it for real
        against FakeR2.
        """
        import sqlite3

        from app.database import set_local_db_version
        from app.storage import profile_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        u = "t5870-no-refresh"
        profile_dir = tmp_path / u / "profiles" / "prof1"
        profile_dir.mkdir(parents=True)
        conn = sqlite3.connect(str(profile_dir / "profile.sqlite"))
        conn.execute("CREATE TABLE marker (who TEXT)")
        conn.commit()
        conn.close()
        mark_sync_pending(u, scope="prof1")
        mark_sync_failed(u)
        assert sync_status_header(u) == "failed"

        _begin_sync_attempt(u)
        mw = RequestContextMiddleware(app=None)

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            fake._objects[profile_r2_key(u, "prof1", "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "0"}}
            set_local_db_version(u, "prof1", 0)
            _run(mw._background_sync(
                u, "prof1", "rid", "POST", "/clips/working/actions",
                had_writes=True, had_user_db_writes=False,
                do_profile=False, force_profile=False,
            ))

            assert not has_sync_failed(u)
            assert sync_status_header(u) is None, "banner cleared without any refresh"


# --------------------------------------------------------------------------
# Criterion 5: an unrecoverable conflict is resolved honestly, never looping.
# --------------------------------------------------------------------------
class TestConflictRetryRestores:
    def _ctx(self, monkeypatch, user_id):
        from app import profile_context, user_context
        monkeypatch.setattr("app.routers.health.R2_ENABLED", True)
        user_context.set_current_user_id(user_id)
        profile_context.set_current_profile_id("deadbeef")

    def test_retry_on_conflict_restores_if_newer_and_reports_restored(self, monkeypatch):
        """RED without fix: revert the health.py conflict branch -> Retry calls
        sync_db_to_cloud, which re-refuses ('conflict') and returns success=False,
        never restoring — the loop the user was stuck in."""
        from app.routers import health

        u = "t5870-retry-conflict"
        mark_sync_conflict(u)
        self._ctx(monkeypatch, u)

        confirmed = []
        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write",
            lambda user_id, profile_id=None: confirmed.append((user_id, profile_id)),
        )
        result = _run(health.retry_sync())
        assert result["success"] is True
        assert result.get("restored") is True
        assert (u, None) in confirmed, "user.sqlite restored-if-newer"
        assert not has_sync_conflict(u), "conflict marker cleared after restore"

    def test_retry_on_conflict_refresh_failure_states_honestly_no_loop(self, monkeypatch):
        from app.routers import health
        from app.services.db_refresh import RefreshFailed

        u = "t5870-retry-conflict-fail"
        mark_sync_conflict(u)
        self._ctx(monkeypatch, u)

        def _boom(user_id, profile_id=None):
            raise RefreshFailed("R2 unreachable")

        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write", _boom
        )
        result = _run(health.retry_sync())
        assert result["success"] is False
        assert result.get("conflict") is True
        assert "reload" in result["message"].lower(), "honest, non-looping message"
        assert has_sync_conflict(u), "still conflicted; not silently cleared"


class TestConflictRetryDeliversAGenuinelyDeferredScope:
    """T5081 (round 6 review, Finding 3): _retry_resolve_conflict used to
    report success/restored right after the two confirm_current_before_write
    calls, without ever draining whatever .sync_pending markers survived them.
    A scope that was merely deferred (a committed local write that was never
    behind R2 at all, so its restore is a no-op) kept its marker through that
    no-op — correctly, per INV-P — but nothing then uploaded it: Retry
    reported "restored" while quietly leaving that write stranded. Retry must
    now drain whatever remains after the confirms, so a merely-deferred scope
    actually gets delivered instead of just correctly not-lied-about."""

    def _ctx(self, monkeypatch, user_id):
        from app import profile_context, user_context
        monkeypatch.setattr("app.routers.health.R2_ENABLED", True)
        user_context.set_current_user_id(user_id)
        profile_context.set_current_profile_id("deadbeef")

    def test_retry_uploads_a_merely_deferred_user_db_alongside_the_conflict(self, monkeypatch):
        """RED without the post-confirm drain: revert _retry_resolve_conflict
        to return success right after the two confirm_current_before_write
        calls -> user.sqlite's committed-but-never-uploaded write never
        reaches R2, even though the endpoint reports restored=True."""
        import sqlite3

        from app.database import (
            USER_DB_SCOPE,
            get_local_user_db_version,
            has_sync_pending_scope,
            mark_sync_pending,
            set_local_user_db_version,
        )
        from app.routers import health
        from app.storage import _user_db_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        u = "t5081-c6-deferred-user-db"
        base_dir = db_module.USER_DATA_BASE
        user_db_path = base_dir / u / "user.sqlite"
        user_db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(user_db_path))
        conn.execute("CREATE TABLE marker (who TEXT)")
        conn.execute("INSERT INTO marker (who) VALUES ('deferred_write')")
        conn.commit()
        conn.close()

        fake = FakeR2()
        with _r2_patched(fake):
            key = _user_db_r2_key(u)
            fake._objects[key] = {"data": b"old", "metadata": {"db-version": "1"}}
            set_local_user_db_version(u, 1)  # local matches R2 -- never behind, just unsynced
            mark_sync_pending(u, USER_DB_SCOPE)  # the committed write's durability record

            mark_sync_conflict(u)  # unrelated profile conflict is what triggers Retry
            self._ctx(monkeypatch, u)
            monkeypatch.setattr(
                "app.services.db_refresh.confirm_current_before_write",
                lambda user_id, profile_id=None: None,
            )

            result = _run(health.retry_sync())

        assert result["success"] is True
        assert result.get("restored") is True
        assert fake._objects[key]["data"] != b"old", \
            "the merely-deferred user.sqlite write must actually reach R2, not just avoid being lied about"
        assert get_local_user_db_version(u) == 2
        assert not has_sync_pending_scope(u, USER_DB_SCOPE)


# ==========================================================================
# Round 2 review fixes
# ==========================================================================

class TestForeignFailureDoesNotAlarmSession:  # MAJOR-1
    def test_foreign_profile_failure_alarms_owner_not_session(self):
        """A foreign profile.sqlite upload fails while the SESSION's own sync is
        clean. The session (whose data reached R2) must NOT get the red alarm; the
        FOREIGN owner (whose write did not land) must.

        RED without fix: gate `mark_sync_failed(user_id)` on the aggregate instead
        of own_status -> the session gets .sync_failed ('failed' header) for work
        that actually saved (the escalated false-positive the reviewer found).
        """
        session = "t5870-m1-session"
        fuid, fpid = "t5870-m1-foreign", "beadfeed"
        mw = RequestContextMiddleware(app=None)
        _begin_sync_attempt(session)

        def _sync(uid, pid, lock_timeout=None, skip_version_check=False):
            return SyncResult.OK if uid == session else SyncResult.FAILED

        with patch("app.middleware.db_sync.sync_db_to_r2_explicit", side_effect=_sync):
            _run(mw._background_sync(
                session, "sprof", "rid", "POST", "/api/admin/x",
                had_writes=True, had_user_db_writes=False,
                do_profile=False, force_profile=False,
                foreign_profile_dbs={(fuid, fpid)},
            ))

        assert has_sync_failed(fuid), "the FOREIGN owner's failed write must alarm THEM"
        assert not has_sync_failed(session), "session's own data reached R2 -> no alarm"
        assert sync_status_header(session) is None, "session stays quiet, not a red banner"


class TestReDrainNoStampede:  # MAJOR-2
    def test_redrain_skips_while_upload_in_progress(self):
        """While a per-user upload is already in flight, the re-drain must NOT
        block-acquire and stampede byte-identical uploads (T1537 429s).

        RED without fix: remove the non-blocking probe -> retry_pending_sync is
        called even though an upload holds the lock.
        """
        from app.storage import get_upload_lock

        u = "t5870-m2-stampede"
        lock = get_upload_lock(u, "profile")
        assert lock.acquire(blocking=False), "lock must start free for this test"
        try:
            mw = RequestContextMiddleware(app=None)
            with patch("app.middleware.db_sync.retry_pending_sync", return_value=True) as retry_fn, \
                 patch("app.middleware.db_sync._REDRAIN_BASE_BACKOFF_S", 0.001):
                healed = _run(mw._redrain_failed_sync(u, "prof1"))
            assert healed is False, "every attempt skips while the lock is held"
            retry_fn.assert_not_called()
        finally:
            lock.release()


class TestInProgressRefcount:  # MAJOR-3
    def test_overlapping_attempts_keep_cover_until_last_ends(self):
        """Two overlapping attempts for one user: the FIRST to end must NOT drop
        in-flight cover while the second still runs.

        RED without fix: a set (discard on end) -> after the first end the header
        surfaces 'failed' though a sync is still running (the flashing false alarm).
        """
        u = "t5870-m3-refcount"
        mark_sync_failed(u)
        _begin_sync_attempt(u)   # attempt A
        _begin_sync_attempt(u)   # attempt B (overlap)
        _end_sync_attempt(u)     # A ends; B still running
        assert sync_status_header(u) is None, "B in flight -> still suppressed"
        _end_sync_attempt(u)     # B ends
        assert sync_status_header(u) == "failed"


class TestConflictRetryRequiresProfile:  # MAJOR-4
    def test_retry_without_profile_context_refuses_and_keeps_markers(self, monkeypatch):
        """A conflict Retry with no profile context cannot restore the conflicted
        profile.sqlite, so it must refuse honestly — never clear markers / claim
        success (No silent fallbacks for internal data).

        RED without fix: swallow the RuntimeError and set profile_id=None -> only
        user.sqlite is confirmed, yet .sync_conflict is cleared and success=True.
        """
        from app import user_context
        from app.routers import health

        u = "t5870-m4-noprofile"
        mark_sync_conflict(u)
        mark_sync_pending(u, scope="prof1")
        monkeypatch.setattr("app.routers.health.R2_ENABLED", True)
        user_context.set_current_user_id(u)

        def _no_profile():
            raise RuntimeError("no profile context")

        # confirm succeeds if reached — proves refusal happens BEFORE any restore.
        monkeypatch.setattr("app.routers.health.get_current_profile_id", _no_profile)
        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write",
            lambda user_id, profile_id=None: None,
        )
        result = _run(health.retry_sync())
        assert result["success"] is False
        assert result.get("conflict") is True
        assert has_sync_conflict(u), "markers must NOT be cleared without a confirmed restore"
