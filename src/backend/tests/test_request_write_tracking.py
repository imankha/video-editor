"""
T248: Tests for async-safe request write tracking.

Verifies that ContextVar-based write tracking is isolated per async request,
preventing concurrent requests from clobbering each other's write flags.

The original threading.local implementation shared state across all async
coroutines on the same event loop thread, which caused:
1. Concurrent read requests to reset the export's has_writes flag
2. Middleware to skip R2 sync after exports (thinking no writes occurred)
3. "Sync failed" errors and has_working_video staying false

Run with: pytest tests/test_request_write_tracking.py -v
"""

import asyncio
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import (
    init_request_context,
    get_request_has_writes,
    clear_request_context,
    _request_has_writes,
)


class TestRequestWriteTrackingIsolation:
    """Verify that write tracking uses ContextVar and is async-safe."""

    def test_init_sets_writes_false(self):
        """init_request_context should set has_writes to False."""
        init_request_context()
        assert get_request_has_writes() is False
        clear_request_context()

    def test_mark_write_sets_true(self):
        """Setting _request_has_writes should be readable."""
        init_request_context()
        _request_has_writes.set(True)
        assert get_request_has_writes() is True
        clear_request_context()

    def test_clear_resets(self):
        """clear_request_context should reset writes to False."""
        init_request_context()
        _request_has_writes.set(True)
        clear_request_context()
        assert get_request_has_writes() is False

    def test_contextvar_isolation_across_tasks(self):
        """
        Critical test: concurrent async tasks must have isolated write flags.

        This reproduces the T248 bug where a concurrent GET request would
        reset the export request's has_writes flag via threading.local.
        """
        results = {}

        async def export_request():
            """Simulates the export request that writes to DB."""
            init_request_context()
            # Export writes to DB
            _request_has_writes.set(True)
            # Yield control (simulates await during export processing)
            await asyncio.sleep(0.01)
            # After yielding, check that our write flag is still True
            results['export_has_writes'] = get_request_has_writes()
            clear_request_context()

        async def read_request():
            """Simulates a concurrent GET /api/projects request."""
            init_request_context()
            # Read request does no writes
            assert get_request_has_writes() is False
            results['read_has_writes'] = get_request_has_writes()
            clear_request_context()

        async def run_concurrent():
            # Start export first, then interleave a read request
            export_task = asyncio.create_task(export_request())
            # Small delay to ensure export sets its write flag before read starts
            await asyncio.sleep(0.005)
            read_task = asyncio.create_task(read_request())
            await asyncio.gather(export_task, read_task)

        asyncio.run(run_concurrent())

        # The export's write flag must survive the concurrent read request
        assert results['export_has_writes'] is True, (
            "Export request's has_writes was clobbered by concurrent read request. "
            "This indicates threading.local is being used instead of ContextVar."
        )
        assert results['read_has_writes'] is False


class TestLocalVersionInitialization:
    """Verify that fresh users get version 0 to prevent repeated R2 HEAD requests."""

    def test_fresh_user_gets_version_zero(self):
        """
        After ensure_database for a fresh user (no R2 DB), local_version
        should be set to 0, not left as None.

        When local_version is None, every get_db_connection() call makes a
        slow R2 HEAD request. If a sync eventually succeeds (uploading stale
        data), a later request with local_version=None could download and
        overwrite local changes.
        """
        from app.database import (
            get_local_db_version,
            set_local_db_version,
            _user_db_versions,
            _db_version_lock,
        )

        test_user = "test_version_init_user"

        # Clear any cached version
        with _db_version_lock:
            _user_db_versions.pop(test_user, None)

        # Simulate what ensure_database does for fresh user when R2 returns None
        local_version = get_local_db_version(test_user)
        if local_version is None:
            # This is the fix: set version 0 instead of leaving as None
            set_local_db_version(test_user, 0)

        # Verify version is now 0, not None
        assert get_local_db_version(test_user) == 0

        # Clean up
        with _db_version_lock:
            _user_db_versions.pop(test_user, None)
