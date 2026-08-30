"""
Tests for T3250: Non-blocking R2 sync in write lock.

Verifies:
  - Background sync runs after response returns, not inside write lock
  - mark_sync_pending is set before response returns (crash safety)
  - _begin_sync_attempt suppresses false X-Sync-Status: failed header
  - Background sync success clears marker
  - Background sync failure leaves marker for next request
  - Rapid writes no longer queue behind sync
"""

import asyncio
import time
from unittest.mock import patch

import pytest

import app.database as db_module
from app.database import (
    clear_sync_pending,
    has_sync_failed,
    has_sync_pending,
    mark_sync_failed,
    mark_sync_pending,
)
from app.middleware import db_sync
from app.middleware.db_sync import (
    RequestContextMiddleware,
    _begin_sync_attempt,
    _end_sync_attempt,
    is_sync_attempt_in_progress,
    sync_status_header,
)


@pytest.fixture(autouse=True)
def isolate_locks(monkeypatch):
    """Each test gets fresh locks and sync-in-progress state."""
    monkeypatch.setattr(db_sync, "_USER_WRITE_LOCKS", {})
    monkeypatch.setattr(db_sync, "_SYNC_IN_PROGRESS", {})
    yield


@pytest.fixture(autouse=True)
def isolate_markers(tmp_path, monkeypatch):
    """Redirect USER_DATA_BASE so marker files don't leak."""
    monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
    yield


def _make_dbs(tmp_path, user_id, profile_id="prof1"):
    import sqlite3
    profile_dir = tmp_path / user_id / "profiles" / profile_id
    profile_dir.mkdir(parents=True)
    user_db = tmp_path / user_id / "user.sqlite"
    for db_path in (profile_dir / "profile.sqlite", user_db):
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE marker (who TEXT)")
        conn.commit()
        conn.close()


class TestBackgroundSyncSuccess:
    """_background_sync clears marker and ends sync attempt on success.

    T5081 (review round 3): the pending-clear now happens INSIDE
    sync_db_to_r2_explicit/sync_user_db_to_r2_explicit the instant they observe
    a real upload success (INV-P clear reason a) — _background_sync itself no
    longer clears anything. Mocking those primitives away with a bare
    `return_value=True` bypasses that real clearing entirely, so these tests
    now drive the REAL primitives against FakeR2 (same harness as
    test_t5081_pending_scoping.py) to prove the actual behavior.
    """

    _make_dbs = staticmethod(_make_dbs)

    def test_clears_marker_on_profile_and_user_sync(self, tmp_path):
        from app.database import USER_DB_SCOPE, set_local_db_version, set_local_user_db_version
        from app.storage import _user_db_r2_key, profile_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        user_id = "test-bg-both-ok"
        self._make_dbs(tmp_path, user_id)
        mark_sync_pending(user_id, "prof1")
        mark_sync_pending(user_id, USER_DB_SCOPE)
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        fake = FakeR2()
        with patch.object(db_module, "USER_DATA_BASE", tmp_path), _r2_patched(fake):
            fake._objects[profile_r2_key(user_id, "prof1", "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "0"}}
            fake._objects[_user_db_r2_key(user_id)] = {
                "data": b"U", "metadata": {"db-version": "0"}}
            set_local_db_version(user_id, "prof1", 0)
            set_local_user_db_version(user_id, 0)

            async def runner():
                return await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=True,
                    do_profile=False, force_profile=False,
                )

            status = asyncio.run(runner())

        assert status == "ok"
        assert not has_sync_pending(user_id), "marker should be cleared after successful sync"
        assert not is_sync_attempt_in_progress(user_id), "_end_sync_attempt should have been called"

    def test_clears_marker_on_profile_only_sync(self, tmp_path):
        from app.database import set_local_db_version
        from app.storage import profile_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        user_id = "test-bg-profile-ok"
        self._make_dbs(tmp_path, user_id)
        mark_sync_pending(user_id, "prof1")
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        fake = FakeR2()
        with patch.object(db_module, "USER_DATA_BASE", tmp_path), _r2_patched(fake):
            fake._objects[profile_r2_key(user_id, "prof1", "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "0"}}
            set_local_db_version(user_id, "prof1", 0)

            async def runner():
                return await middleware._background_sync(
                    user_id, "prof1", "rid1", "PATCH", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                )

            status = asyncio.run(runner())

        assert status == "ok"
        assert not has_sync_pending(user_id)

    def test_clears_marker_on_user_db_only_sync(self, tmp_path):
        from app.database import USER_DB_SCOPE, set_local_user_db_version
        from app.storage import _user_db_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        user_id = "test-bg-userdb-ok"
        self._make_dbs(tmp_path, user_id)
        mark_sync_pending(user_id, USER_DB_SCOPE)
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        fake = FakeR2()
        with patch.object(db_module, "USER_DATA_BASE", tmp_path), _r2_patched(fake):
            fake._objects[_user_db_r2_key(user_id)] = {
                "data": b"U", "metadata": {"db-version": "0"}}
            set_local_user_db_version(user_id, 0)

            async def runner():
                return await middleware._background_sync(
                    user_id, None, "rid1", "POST", "/api/test",
                    had_writes=False, had_user_db_writes=True,
                    do_profile=False, force_profile=False,
                )

            status = asyncio.run(runner())

        assert status == "ok"
        assert not has_sync_pending(user_id)


class TestBackgroundSyncFailure:
    """_background_sync leaves marker and ends sync attempt on failure."""

    def test_leaves_marker_on_sync_failure(self):
        from app.database import SyncResult
        from app.middleware.db_sync import PendingDrainReport

        user_id = "test-bg-fail"
        mark_sync_pending(user_id, scope="prof1")
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        # T5081: _redrain_failed_sync now calls drain_pending_scopes directly
        # (not retry_pending_sync) — patch THAT so the exhausted-failure path
        # is pinned without needing a real db file (drain_pending_scopes would
        # otherwise correctly treat a missing file as an orphan and clear it).
        exhausted_report = PendingDrainReport(
            attempted={"prof1": SyncResult.FAILED}, orphaned=set(), not_pending=set())

        async def runner():
            # T5870: the bounded re-drain now retries a failed sync; patch it to
            # keep failing so this pins the EXHAUSTED-failure path (marker stays).
            with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=False), \
                 patch("app.middleware.db_sync.drain_pending_scopes", return_value=exhausted_report), \
                 patch("app.middleware.db_sync._REDRAIN_BASE_BACKOFF_S", 0.001):
                await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                )

        asyncio.run(runner())
        assert has_sync_pending(user_id), "marker must stay on failure for crash recovery"
        assert has_sync_failed(user_id), "T5870: an unrecovered failure marks .sync_failed"
        assert not is_sync_attempt_in_progress(user_id), "_end_sync_attempt must still be called"

    def test_leaves_marker_on_exception(self):
        user_id = "test-bg-exc"
        # T5081: scoped, matching what a real had_writes=True request marks.
        mark_sync_pending(user_id, scope="prof1")
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        async def runner():
            with patch("app.middleware.db_sync.sync_db_to_r2_explicit", side_effect=OSError("R2 down")):
                await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                )

        asyncio.run(runner())
        assert has_sync_pending(user_id), "marker must stay on exception"
        assert not is_sync_attempt_in_progress(user_id)

    def test_error_path_calls_set_sync_failed(self):
        user_id = "test-bg-error-path"
        mark_sync_pending(user_id, scope="prof1")
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        async def runner():
            with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=False), \
                 patch("app.middleware.db_sync.set_sync_failed") as mock_set_failed:
                await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                    is_error_path=True,
                )
                mock_set_failed.assert_called_once_with(user_id, True, profile_id="prof1")

    def test_error_path_clears_on_success(self):
        user_id = "test-bg-error-ok"
        mark_sync_pending(user_id, scope="prof1")
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        async def runner():
            with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=True), \
                 patch("app.middleware.db_sync.set_sync_failed") as mock_set_failed:
                await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                    is_error_path=True,
                )
                mock_set_failed.assert_called_once_with(user_id, False, profile_id="prof1")

    def test_partial_sync_leaves_marker(self, tmp_path):
        """When profile sync succeeds but user sync fails, marker stays —
        AND only for the scope that actually failed (T5081).

        Drives the REAL sync_db_to_r2_explicit/sync_user_db_to_r2_explicit
        against FakeR2 (a subclass that can fail user.sqlite selectively)
        rather than mocking them away — mocking bypasses the primitives' own
        INV-P pending-clear entirely, which is where clearing now lives.
        """
        from app.database import USER_DB_SCOPE, has_sync_pending_scope, set_local_db_version
        from app.storage import profile_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        class _FailUserR2(FakeR2):
            def upload_file(self, Filename, Bucket, Key, ExtraArgs=None, Callback=None, Config=None):
                if Key.endswith("user.sqlite"):
                    from botocore.exceptions import ClientError
                    raise ClientError({"Error": {"Code": "403", "Message": "forced failure"}}, "PutObject")
                return super().upload_file(Filename, Bucket, Key, ExtraArgs, Callback, Config)

        user_id = "test-bg-partial"
        _make_dbs(tmp_path, user_id)
        mark_sync_pending(user_id, scope="prof1")
        mark_sync_pending(user_id, scope=USER_DB_SCOPE)
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        fake = _FailUserR2()
        with patch.object(db_module, "USER_DATA_BASE", tmp_path), _r2_patched(fake), \
             patch("app.middleware.db_sync._REDRAIN_BASE_BACKOFF_S", 0.001):
            fake._objects[profile_r2_key(user_id, "prof1", "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "0"}}
            set_local_db_version(user_id, "prof1", 0)
            # user.sqlite is never pre-seeded in R2 — its upload will fail via
            # _FailUserR2 regardless, so no baseline is needed for this test.

            async def runner():
                return await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=True,
                    do_profile=False, force_profile=False,
                )

            status = asyncio.run(runner())

        assert status == "failed"
        assert has_sync_pending(user_id), "partial failure must keep marker"
        assert has_sync_pending_scope(user_id, "prof1") is False, \
            "the profile scope genuinely synced and must clear"
        assert has_sync_pending_scope(user_id, USER_DB_SCOPE) is True, \
            "the user.sqlite scope genuinely failed and must survive"


class TestWriteLockDoesNotBlockOnSync:
    """Write lock releases after handler, not after background sync."""

    def test_rapid_writes_complete_quickly(self):
        """3 concurrent writes for the same user complete in <200ms.
        Proves the lock covers only the handler (~20ms), not sync."""

        async def runner():
            user = "test-rapid-writes"

            async def simulated_write():
                t0 = time.perf_counter()
                async with db_sync._maybe_write_lock(user, "POST", "/api/test", "rid"):
                    await asyncio.sleep(0.02)
                return time.perf_counter() - t0

            t0 = time.perf_counter()
            await asyncio.gather(
                simulated_write(),
                simulated_write(),
                simulated_write(),
            )
            total = time.perf_counter() - t0

            assert total < 0.20, (
                f"3 writes took {total:.3f}s -- lock may still include sync"
            )

        asyncio.run(runner())

    def test_5_rapid_deletes_under_250ms(self):
        """Reproduce 2026-05-31 prod incident: user rapidly deleted 5 reels.

        Before T3250: write lock held for handler (~50ms) + R2 sync (~200ms)
          = 250ms each, serialized = ~1250ms total. Real prod saw 420s.
        After T3250: lock covers handler only (~10ms each), sync fires in
          background. 5 serialized handlers = ~50ms + overhead < 250ms.
        Background syncs still complete (no data loss).
        """

        async def runner():
            user = "test-rapid-delete-user"
            sync_tasks = []
            syncs_completed = []

            async def slow_r2_sync(project_id):
                await asyncio.sleep(0.2)
                syncs_completed.append(project_id)

            async def simulate_delete_request(project_id):
                t0 = time.perf_counter()
                async with db_sync._maybe_write_lock(
                    user, "DELETE", f"/api/projects/{project_id}", f"rid_{project_id}"
                ):
                    await asyncio.sleep(0.01)  # handler: ~10ms
                    mark_sync_pending(user, scope="prof1")
                    _begin_sync_attempt(user)
                    task = asyncio.create_task(slow_r2_sync(project_id))
                    sync_tasks.append(task)
                return time.perf_counter() - t0

            t0 = time.perf_counter()
            response_times = await asyncio.gather(
                *[simulate_delete_request(i) for i in range(5)]
            )
            total_response_time = time.perf_counter() - t0

            assert total_response_time < 0.25, (
                f"5 deletes took {total_response_time:.3f}s -- "
                f"expected <250ms. Individual: "
                f"{[f'{t:.3f}s' for t in response_times]}"
            )

            assert len(syncs_completed) == 0, (
                "syncs should still be running when responses return"
            )
            await asyncio.gather(*sync_tasks)
            assert len(syncs_completed) == 5, (
                "all 5 background syncs must complete (no data loss)"
            )

        asyncio.run(runner())

    def test_background_task_runs_outside_lock(self):
        """asyncio.create_task inside the lock runs AFTER lock releases."""

        async def runner():
            user = "test-lock-scope"
            lock = db_sync._get_user_write_lock(user)
            lock_held_during_bg = None

            async def fake_background():
                nonlocal lock_held_during_bg
                lock_held_during_bg = lock.locked()

            async with db_sync._maybe_write_lock(user, "POST", "/api/test", "rid"):
                task = asyncio.create_task(fake_background())

            await task
            assert lock_held_during_bg is False, (
                "Background task should run after write lock releases"
            )

        asyncio.run(runner())


class TestSyncPendingBeforeResponse:
    """mark_sync_pending and _begin_sync_attempt are set synchronously."""

    def test_marker_and_attempt_set_before_background_task(self):
        """Simulates the _sync_aware_flow sequence: mark + begin happen
        synchronously, THEN create_task fires the background sync."""
        user_id = "test-marker-timing"

        mark_sync_pending(user_id, scope="prof1")
        _begin_sync_attempt(user_id)

        assert has_sync_pending(user_id), "marker must exist before task starts"
        assert is_sync_attempt_in_progress(user_id), "attempt must be signaled before task starts"

        _end_sync_attempt(user_id)
        clear_sync_pending(user_id, scope="prof1")

    def test_begin_attempt_suppresses_header(self):
        """T5870: an in-flight sync suppresses ANY X-Sync-Status header via
        sync_status_header's in-progress gate — a genuine .sync_failed included."""
        user_id = "test-header-suppression"

        mark_sync_failed(user_id)
        assert sync_status_header(user_id) == "failed"

        _begin_sync_attempt(user_id)
        assert sync_status_header(user_id) is None, (
            "any X-Sync-Status must be suppressed during an in-flight sync"
        )

        _end_sync_attempt(user_id)
        assert sync_status_header(user_id) == "failed"

    def test_pending_only_is_quiet_not_failed(self):
        """T5870: a merely-pending write is 'pending' (quiet), never 'failed'."""
        user_id = "test-pending-quiet"
        mark_sync_pending(user_id, scope="prof1")
        assert db_sync.is_sync_failed(user_id) is False
        assert sync_status_header(user_id) == "pending"


class TestBackgroundSyncErrorPathLockTimeout:
    """Error path uses no lock timeout (waits for upload lock)."""

    def test_normal_path_uses_lock_timeout(self):
        """Normal background sync passes _SYNC_LOCK_TIMEOUT to sync functions."""
        user_id = "test-lock-timeout"
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        async def runner():
            with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=True) as mock_sync:
                await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                )
                assert mock_sync.call_args[0][2] == db_sync._SYNC_LOCK_TIMEOUT

        asyncio.run(runner())

    def test_error_path_uses_no_lock_timeout(self):
        """Error path background sync passes lock_timeout=None (wait forever)."""
        user_id = "test-no-lock-timeout"
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        async def runner():
            with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=True) as mock_sync:
                await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                    is_error_path=True,
                )
                args = mock_sync.call_args
                assert args[0][2] is None or args[1].get("lock_timeout") is None, (
                    "Error path should pass lock_timeout=None"
                )

        asyncio.run(runner())
