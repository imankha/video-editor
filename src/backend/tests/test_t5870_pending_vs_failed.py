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
    monkeypatch.setattr(db_sync, "_SYNC_IN_PROGRESS", set())
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
        mark_sync_pending(u)
        assert has_sync_pending(u)
        # RED without fix: old is_sync_failed := has_sync_pending returned True.
        assert is_sync_failed(u) is False

    def test_pending_marker_emits_quiet_pending_header(self):
        u = "t5870-pending-hdr"
        mark_sync_pending(u)
        assert sync_status_header(u) == "pending"

    def test_in_flight_sync_suppresses_header(self):
        u = "t5870-inflight"
        mark_sync_pending(u)
        _begin_sync_attempt(u)
        assert sync_status_header(u) is None  # covered by the in-progress set
        _end_sync_attempt(u)
        assert sync_status_header(u) == "pending"

    def test_failed_marker_emits_failed_header(self):
        u = "t5870-failed-hdr"
        mark_sync_pending(u)
        mark_sync_failed(u)
        assert is_sync_failed(u) is True
        assert sync_status_header(u) == "failed"

    def test_conflict_outranks_failed(self):
        u = "t5870-conflict-hdr"
        mark_sync_pending(u)
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
        mark_sync_pending(u)
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
        u = "t5870-redrain-exhaust"
        mark_sync_pending(u)
        _begin_sync_attempt(u)
        mw = RequestContextMiddleware(app=None)

        with patch("app.middleware.db_sync.sync_db_to_r2_explicit",
                   return_value=SyncResult.FAILED), \
             patch("app.middleware.db_sync.retry_pending_sync", return_value=False):
            _run(mw._background_sync(
                u, "prof1", "rid", "POST", "/clips/working/actions",
                had_writes=True, had_user_db_writes=False,
                do_profile=False, force_profile=False,
            ))

        assert has_sync_failed(u), "an unrecoverable failure must be marked failed"
        assert sync_status_header(u) == "failed"

    def test_conflict_skips_redrain(self):
        """A CAS conflict is NOT blind-retryable -> the re-drain (retry_pending_sync)
        must not run; it is surfaced as 'conflict' for the restore path instead."""
        u = "t5870-conflict-skip"
        mark_sync_pending(u)
        _begin_sync_attempt(u)
        mw = RequestContextMiddleware(app=None)

        def _conflict(user_id, profile_id, lock_timeout=None, skip_version_check=False):
            mark_sync_conflict(user_id)          # mirrors real sync_db_to_r2_explicit
            return SyncResult.CONFLICT

        with patch("app.middleware.db_sync.sync_db_to_r2_explicit", side_effect=_conflict), \
             patch("app.middleware.db_sync.retry_pending_sync", return_value=True) as retry_fn:
            _run(mw._background_sync(
                u, "prof1", "rid", "POST", "/clips/working/actions",
                had_writes=True, had_user_db_writes=False,
                do_profile=False, force_profile=False,
            ))
            retry_fn.assert_not_called()

        assert has_sync_conflict(u)
        assert sync_status_header(u) == "conflict"


# --------------------------------------------------------------------------
# Criterion 4: Retry (or the next write's sync) recovers WITHOUT a refresh.
# --------------------------------------------------------------------------
class TestRecoversWithoutRefresh:
    def test_failed_banner_clears_on_next_successful_sync_no_refresh(self):
        """A 'failed' banner is showing. The user's next edit syncs successfully;
        the banner clears with NO page reload.

        RED without fix: remove `clear_sync_failed(user_id)` from the ok branch of
        _background_sync -> .sync_failed persists and the header stays 'failed'
        even after a successful sync (the exact refresh-only-recovery bug).
        """
        u = "t5870-no-refresh"
        mark_sync_pending(u)
        mark_sync_failed(u)
        assert sync_status_header(u) == "failed"

        _begin_sync_attempt(u)
        mw = RequestContextMiddleware(app=None)
        with patch("app.middleware.db_sync.sync_db_to_r2_explicit",
                   return_value=SyncResult.OK):
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
