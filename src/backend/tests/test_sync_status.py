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
import pytest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from app import database as db_module
from app.database import mark_sync_pending, clear_sync_pending, has_sync_pending
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
        per-user state would be lost, but the .sync_pending marker on disk
        still reflects the degraded state.
        """
        mark_sync_pending("restart_user")

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

    @patch("app.routers.health.sync_db_to_cloud", return_value=True)
    @patch("app.routers.health.R2_ENABLED", True)
    def test_retry_sync_success(self, mock_sync, client):
        """Successful sync should clear the failure marker."""
        set_sync_failed(TEST_USER_ID, True)

        response = client.post("/api/retry-sync")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert is_sync_failed(TEST_USER_ID) is False
        mock_sync.assert_called_once()

    @patch("app.routers.health.sync_db_to_cloud", return_value=False)
    @patch("app.routers.health.R2_ENABLED", True)
    def test_retry_sync_failure(self, mock_sync, client):
        """Failed sync should return success=False."""
        response = client.post("/api/retry-sync")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        mock_sync.assert_called_once()


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
