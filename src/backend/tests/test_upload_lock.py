"""
Tests for T1539: Per-user per-key upload lock.

Covers:
- get_upload_lock: returns same lock for same (user, db_type), different for different
- Upload lock serializes concurrent PutObject calls on same key
- Different keys (profile vs user) get independent locks (can upload in parallel)
- tryLock optimization in retry_pending_sync skips when upload in progress
"""

import threading
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# 1. get_upload_lock — lock identity and isolation
# ---------------------------------------------------------------------------

class TestGetUploadLock:
    """Tests for the per-(user, db_type) lock factory."""

    def setup_method(self):
        """Clear the lock dict between tests to avoid cross-test pollution."""
        from app.storage import _USER_UPLOAD_LOCKS
        _USER_UPLOAD_LOCKS.clear()

    def test_same_user_same_db_returns_same_lock(self):
        from app.storage import get_upload_lock
        lock1 = get_upload_lock("user1", "profile")
        lock2 = get_upload_lock("user1", "profile")
        assert lock1 is lock2

    def test_same_user_different_db_returns_different_locks(self):
        from app.storage import get_upload_lock
        profile_lock = get_upload_lock("user1", "profile")
        user_lock = get_upload_lock("user1", "user")
        assert profile_lock is not user_lock

    def test_different_users_same_db_returns_different_locks(self):
        from app.storage import get_upload_lock
        lock1 = get_upload_lock("user1", "profile")
        lock2 = get_upload_lock("user2", "profile")
        assert lock1 is not lock2

    def test_returns_threading_lock(self):
        from app.storage import get_upload_lock
        lock = get_upload_lock("user1", "profile")
        assert isinstance(lock, type(threading.Lock()))


# ---------------------------------------------------------------------------
# 2. Upload lock serializes concurrent uploads on same key
# ---------------------------------------------------------------------------

class TestUploadLockSerialization:
    """Verify that concurrent uploads to the same key are serialized."""

    def setup_method(self):
        from app.storage import _USER_UPLOAD_LOCKS
        _USER_UPLOAD_LOCKS.clear()

    def test_concurrent_uploads_same_key_are_serialized(self):
        """Two threads uploading profile.sqlite for the same user must not overlap."""
        from app.storage import get_upload_lock

        lock = get_upload_lock("user1", "profile")
        overlap_detected = threading.Event()
        in_upload = threading.Event()
        upload_order = []

        def fake_upload(name, delay=0.1):
            with lock:
                if in_upload.is_set():
                    overlap_detected.set()
                in_upload.set()
                upload_order.append(f"{name}_start")
                time.sleep(delay)
                upload_order.append(f"{name}_end")
                in_upload.clear()

        t1 = threading.Thread(target=fake_upload, args=("A",))
        t2 = threading.Thread(target=fake_upload, args=("B",))
        t1.start()
        time.sleep(0.01)  # give t1 a head start
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        assert not overlap_detected.is_set(), "Uploads overlapped — lock did not serialize"
        assert upload_order == ["A_start", "A_end", "B_start", "B_end"]

    def test_concurrent_uploads_different_keys_can_overlap(self):
        """profile.sqlite and user.sqlite uploads for same user can run in parallel."""
        from app.storage import get_upload_lock

        profile_lock = get_upload_lock("user1", "profile")
        user_lock = get_upload_lock("user1", "user")
        both_in_upload = threading.Event()
        a_started = threading.Event()

        def upload_profile():
            with profile_lock:
                a_started.set()
                time.sleep(0.15)

        def upload_user():
            a_started.wait(timeout=5)
            with user_lock:
                # If we get here while profile upload is still running, they overlapped
                both_in_upload.set()

        t1 = threading.Thread(target=upload_profile)
        t2 = threading.Thread(target=upload_user)
        t1.start()
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        assert both_in_upload.is_set(), "Different-key uploads should run in parallel"


# ---------------------------------------------------------------------------
# 3. sync_database_to_r2_with_version acquires the upload lock
# ---------------------------------------------------------------------------

class TestSyncDatabaseAcquiresLock:
    """Verify that sync_database_to_r2_with_version holds the upload lock during PutObject."""

    def setup_method(self):
        from app.storage import _USER_UPLOAD_LOCKS
        _USER_UPLOAD_LOCKS.clear()

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.storage.PROFILING_ENABLED", False)
    @patch("app.storage.get_r2_sync_client")
    @patch("app.storage.r2_key", return_value="dev/users/u1/profiles/p1/profile.sqlite")
    def test_lock_held_during_upload(self, mock_r2_key, mock_get_client):
        """The upload lock is held while retry_r2_call runs."""
        from app.storage import sync_database_to_r2_with_version, get_upload_lock

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        lock = get_upload_lock("u1", "profile")
        lock_was_held = threading.Event()

        def fake_retry_r2_call(func, *args, **kwargs):
            # Check that lock is held (non-blocking acquire should fail)
            if not lock.acquire(blocking=False):
                lock_was_held.set()
            else:
                lock.release()

        with patch("app.utils.retry.retry_r2_call", fake_retry_r2_call):
            fake_path = MagicMock(spec=Path)
            fake_path.exists.return_value = True
            fake_path.__str__ = lambda self: "/fake/profile.sqlite"

            sync_database_to_r2_with_version("u1", fake_path, 5, skip_version_check=True)

        assert lock_was_held.is_set(), "Upload lock was not held during PutObject"

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.storage.PROFILING_ENABLED", False)
    @patch("app.storage.get_r2_sync_client")
    @patch("app.storage.r2_key", return_value="dev/users/u1/profiles/p1/profile.sqlite")
    def test_lock_released_after_upload_failure(self, mock_r2_key, mock_get_client):
        """The upload lock is released even if the upload raises an exception."""
        from app.storage import sync_database_to_r2_with_version, get_upload_lock

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        lock = get_upload_lock("u1", "profile")

        def fake_retry_r2_call(func, *args, **kwargs):
            raise Exception("network error")

        with patch("app.utils.retry.retry_r2_call", fake_retry_r2_call):
            fake_path = MagicMock(spec=Path)
            fake_path.exists.return_value = True
            fake_path.__str__ = lambda self: "/fake/profile.sqlite"

            success, version = sync_database_to_r2_with_version("u1", fake_path, 5, skip_version_check=True)

        assert success is False
        # Lock must be released — acquiring it should succeed
        assert lock.acquire(blocking=False), "Upload lock was not released after failure"
        lock.release()


# ---------------------------------------------------------------------------
# 4. sync_user_db_to_r2_with_version acquires its own lock
# ---------------------------------------------------------------------------

class TestSyncUserDbAcquiresLock:
    """Verify that sync_user_db_to_r2_with_version holds the 'user' upload lock."""

    def setup_method(self):
        from app.storage import _USER_UPLOAD_LOCKS
        _USER_UPLOAD_LOCKS.clear()

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.storage.PROFILING_ENABLED", False)
    @patch("app.storage.get_r2_sync_client")
    @patch("app.storage._user_db_r2_key", return_value="dev/users/u1/user.sqlite")
    def test_lock_held_during_upload(self, mock_r2_key, mock_get_client):
        """The 'user' upload lock is held while uploading user.sqlite."""
        from app.storage import sync_user_db_to_r2_with_version, get_upload_lock

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        lock = get_upload_lock("u1", "user")
        lock_was_held = threading.Event()

        def fake_retry_r2_call(func, *args, **kwargs):
            if not lock.acquire(blocking=False):
                lock_was_held.set()
            else:
                lock.release()

        with patch("app.utils.retry.retry_r2_call", fake_retry_r2_call):
            fake_path = MagicMock(spec=Path)
            fake_path.exists.return_value = True
            fake_path.__str__ = lambda self: "/fake/user.sqlite"

            sync_user_db_to_r2_with_version("u1", fake_path, 2, skip_version_check=True)

        assert lock_was_held.is_set(), "Upload lock was not held during user.sqlite PutObject"


# ---------------------------------------------------------------------------
# 5. tryLock optimization in retry_pending_sync
# ---------------------------------------------------------------------------

class TestRetryPendingSyncTryLock:
    """Verify the tryLock optimization skips retry when upload already in progress."""

    def setup_method(self):
        from app.storage import _USER_UPLOAD_LOCKS
        _USER_UPLOAD_LOCKS.clear()

    @patch("app.middleware.db_sync.has_sync_pending", return_value=True)
    def test_skips_retry_when_upload_lock_held(self, mock_has_pending):
        """When the upload lock is already held, retry_pending_sync is skipped."""
        import asyncio
        from app.storage import get_upload_lock

        # Pre-acquire the upload lock (simulating export worker uploading)
        lock = get_upload_lock("u1", "profile")
        lock.acquire()

        retry_called = False

        async def _run():
            nonlocal retry_called

            # Build a minimal mock request
            mock_request = MagicMock()
            mock_request.method = "POST"
            mock_request.url.path = "/api/test"
            mock_request.headers = {"X-Request-ID": "test-123", "X-Profile-Request": ""}

            with patch("app.middleware.db_sync.asyncio.to_thread") as mock_to_thread, \
                 patch("app.middleware.db_sync._begin_sync_attempt"), \
                 patch("app.middleware.db_sync._end_sync_attempt"), \
                 patch("app.middleware.db_sync.clear_sync_pending"), \
                 patch("app.middleware.db_sync._inflight_enter", return_value=1), \
                 patch("app.middleware.db_sync._inflight_exit", return_value=0), \
                 patch("app.middleware.db_sync.init_request_context"), \
                 patch("app.middleware.db_sync.clear_request_context"), \
                 patch("app.middleware.db_sync.get_request_has_writes", return_value=False), \
                 patch("app.middleware.db_sync.get_request_has_user_db_writes", return_value=False), \
                 patch("app.middleware.db_sync.is_sync_failed", return_value=False):

                async def fake_call_next(req):
                    return MagicMock(headers={})

                middleware = MagicMock()
                from app.middleware.db_sync import RequestContextMiddleware
                inst = RequestContextMiddleware.__new__(RequestContextMiddleware)
                meta = {"sync_duration": 0.0, "handler_duration": 0.0,
                        "user_id": "u1", "inflight_entry": 0, "inflight_exit": 0}
                await inst._sync_aware_flow(mock_request, fake_call_next, meta, "u1", "test-123")

                if mock_to_thread.called:
                    # Check if retry_pending_sync was the function passed
                    for call in mock_to_thread.call_args_list:
                        if call[0][0].__name__ == "retry_pending_sync":
                            retry_called = True

            return retry_called

        try:
            result = asyncio.run(_run())
            assert not result, "retry_pending_sync should have been skipped (upload lock held)"
        finally:
            lock.release()

    @patch("app.middleware.db_sync.has_sync_pending", return_value=True)
    def test_runs_retry_when_upload_lock_free(self, mock_has_pending):
        """When the upload lock is free, retry_pending_sync runs normally."""
        import asyncio

        async def _run():
            mock_request = MagicMock()
            mock_request.method = "POST"
            mock_request.url.path = "/api/test"
            mock_request.headers = {"X-Request-ID": "test-123", "X-Profile-Request": ""}

            retry_was_called = False

            async def fake_to_thread(fn, *args):
                nonlocal retry_was_called
                if hasattr(fn, '__name__') and fn.__name__ == "retry_pending_sync":
                    retry_was_called = True
                    return True
                return None

            with patch("app.middleware.db_sync.asyncio.to_thread", side_effect=fake_to_thread), \
                 patch("app.middleware.db_sync._begin_sync_attempt"), \
                 patch("app.middleware.db_sync._end_sync_attempt"), \
                 patch("app.middleware.db_sync.clear_sync_pending"), \
                 patch("app.middleware.db_sync._inflight_enter", return_value=1), \
                 patch("app.middleware.db_sync._inflight_exit", return_value=0), \
                 patch("app.middleware.db_sync.init_request_context"), \
                 patch("app.middleware.db_sync.clear_request_context"), \
                 patch("app.middleware.db_sync.get_request_has_writes", return_value=False), \
                 patch("app.middleware.db_sync.get_request_has_user_db_writes", return_value=False), \
                 patch("app.middleware.db_sync.is_sync_failed", return_value=False):

                async def fake_call_next(req):
                    return MagicMock(headers={})

                from app.middleware.db_sync import RequestContextMiddleware
                inst = RequestContextMiddleware.__new__(RequestContextMiddleware)
                meta = {"sync_duration": 0.0, "handler_duration": 0.0,
                        "user_id": "u1", "inflight_entry": 0, "inflight_exit": 0}
                await inst._sync_aware_flow(mock_request, fake_call_next, meta, "u1", "test-123")

            return retry_was_called

        result = asyncio.run(_run())
        assert result, "retry_pending_sync should have run (upload lock was free)"
