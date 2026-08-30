"""
T87 / T1152: Tests for sync connection loss handling.

Verifies:
  - is_sync_failed / set_sync_failed are backed by the .sync_pending marker
  - POST /api/retry-sync endpoint triggers sync and returns result
  - X-Sync-Status header is set when sync has failed
  - Sync-failed state survives backend restart (T1152)

Run with: pytest src/backend/tests/test_sync_status.py -v
"""

import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app import database as db_module
from app.database import (
    has_sync_conflict,
    has_sync_pending,
    mark_sync_conflict,
    mark_sync_failed,
)
from app.middleware.db_sync import is_sync_failed, set_sync_failed

# Test user ID used for all client-based tests (sent via X-User-ID header)
TEST_USER_ID = "test-sync-user"


@pytest.fixture(autouse=True)
def _isolate_sync_markers(tmp_path, monkeypatch):
    """Redirect USER_DATA_BASE so marker files don't leak into the real user_data dir."""
    monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
    yield


class TestSyncFailedTracking:
    """Unit tests for marker-backed sync failure tracking."""

    def test_is_sync_failed_default_false(self):
        """Unknown users should not be marked as failed."""
        assert is_sync_failed("unknown_user") is False

    def test_set_sync_failed_true(self):
        """Setting sync failed should be retrievable."""
        set_sync_failed("user1", True)
        assert is_sync_failed("user1") is True

    def test_set_sync_failed_false_clears(self):
        """Clearing sync failure should remove the marker."""
        set_sync_failed("user1", True)
        assert is_sync_failed("user1") is True

        set_sync_failed("user1", False)
        assert is_sync_failed("user1") is False
        assert has_sync_pending("user1") is False

    def test_independent_per_user(self):
        """Sync failure state is independent per user."""
        set_sync_failed("user1", True)
        set_sync_failed("user2", False)

        assert is_sync_failed("user1") is True
        assert is_sync_failed("user2") is False

    def test_set_false_on_nonexistent_user_noop(self):
        """Clearing a user that was never set should not error."""
        set_sync_failed("ghost_user", False)
        assert is_sync_failed("ghost_user") is False

    def test_sync_failed_persists_across_restart(self):
        """T1152: marker-backed sync-failed survives a backend restart.

        Simulates restart by reloading the middleware module; any in-memory
        per-user state would be lost, but the .sync_failed marker on disk
        still reflects the degraded state. (T5870: is_sync_failed is now the
        GENUINE-failure marker, not the pending marker.)
        """
        mark_sync_failed("restart_user")

        from app.middleware import db_sync
        importlib.reload(db_sync)

        assert db_sync.is_sync_failed("restart_user") is True


class TestRetrySyncEndpoint:
    """Tests for the POST /api/retry-sync endpoint."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient

        from app.main import app
        return TestClient(app, headers={"X-User-ID": TEST_USER_ID})

    @patch("app.routers.health.R2_ENABLED", False)
    def test_retry_sync_r2_disabled(self, client):
        """When R2 is disabled, retry-sync should return success."""
        response = client.post("/api/retry-sync")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @patch("app.routers.health.R2_ENABLED", True)
    def test_retry_sync_success(self, client):
        """Successful sync should clear the failure marker.

        T5081 (review round 3): retry_sync() now routes through
        drain_pending_scopes (database.py's real sync primitives), not the
        retired sync_db_to_cloud -- patch THAT to report a verified OK for
        both scopes it drains.
        """
        from app.database import SyncResult
        from app.middleware.db_sync import PendingDrainReport

        set_sync_failed(TEST_USER_ID, True)
        ok_report = PendingDrainReport(
            attempted={"prof1": SyncResult.OK, "user": SyncResult.OK},
            orphaned=set(), not_pending=set())

        with patch("app.routers.health.drain_pending_scopes", return_value=ok_report) as mock_drain:
            response = client.post("/api/retry-sync")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert is_sync_failed(TEST_USER_ID) is False
        mock_drain.assert_called_once()

    @patch("app.routers.health.R2_ENABLED", True)
    def test_retry_sync_failure(self, client):
        """A transient failure should return success=False."""
        from app.database import SyncResult
        from app.middleware.db_sync import PendingDrainReport

        failed_report = PendingDrainReport(
            attempted={"prof1": SyncResult.FAILED}, orphaned=set(), not_pending=set())

        with patch("app.routers.health.drain_pending_scopes", return_value=failed_report) as mock_drain:
            response = client.post("/api/retry-sync")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        mock_drain.assert_called_once()

    @patch("app.routers.health.R2_ENABLED", True)
    def test_retry_sync_conflict_that_cannot_restore_reports_failure_not_success(
        self, client, monkeypatch
    ):
        """T4310 BLOCKING-2 intent, preserved under T5870's redesign: a CAS
        conflict must NEVER be reported as a durable success while it is
        unresolved. T5870 routes a conflict to restore-if-newer instead of a
        blind re-push; when that restore CANNOT complete (R2 unreachable here),
        the endpoint must still report success=False and keep the conflict
        marker — no lie, no silent clear, no loop. (confirm_current_before_write
        raises RefreshFailed, so the honest-failure branch fires.)"""
        from app.services.db_refresh import RefreshFailed

        def _boom(user_id, profile_id=None):
            raise RefreshFailed("R2 unreachable")

        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write", _boom
        )
        set_sync_failed(TEST_USER_ID, True)
        mark_sync_conflict(TEST_USER_ID)

        response = client.post("/api/retry-sync")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert has_sync_conflict(TEST_USER_ID) is True, \
            "an unresolved conflict must not clear its marker"


class TestSyncStatusHeader:
    """Tests for X-Sync-Status header on responses."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient

        from app.main import app
        return TestClient(app, headers={"X-User-ID": TEST_USER_ID})

    def test_no_header_when_sync_ok(self, client):
        """No X-Sync-Status header when sync is healthy."""
        response = client.get("/api/status")
        assert response.status_code == 200
        assert "X-Sync-Status" not in response.headers

    @patch("app.middleware.db_sync.retry_pending_sync", return_value=False)
    @patch("app.middleware.db_sync.R2_ENABLED", True)
    def test_header_present_when_sync_failed(self, _mock_retry, client):
        """X-Sync-Status: failed header should be present when marker exists.

        retry_pending_sync is mocked to fail so the marker stays put; otherwise
        T1150's auto-retry would clear it on a request against an empty test env.
        """
        set_sync_failed(TEST_USER_ID, True)

        response = client.get("/api/status")
        assert response.status_code == 200
        assert response.headers.get("X-Sync-Status") == "failed"

    @patch("app.middleware.db_sync.retry_pending_sync", return_value=False)
    @patch("app.middleware.db_sync.R2_ENABLED", True)
    def test_header_conflict_when_conflict_marker_set(self, _mock_retry, client):
        """T4310 MAJOR-1: has_sync_conflict was write-only (zero call sites), so a
        real CAS conflict was indistinguishable from a transient failure on the
        wire. Now the conflict marker must surface as its own distinct value."""
        set_sync_failed(TEST_USER_ID, True)
        mark_sync_conflict(TEST_USER_ID)

        response = client.get("/api/status")
        assert response.status_code == 200
        assert response.headers.get("X-Sync-Status") == "conflict"
