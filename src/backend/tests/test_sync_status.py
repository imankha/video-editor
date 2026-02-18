"""
T87: Tests for sync connection loss handling.
Verifies:
  - _sync_failed dict tracks failure state per user
  - set_sync_failed / is_sync_failed work correctly
  - POST /api/retry-sync endpoint triggers sync and returns result
  - X-Sync-Status header is set when sync has failed

Run with: pytest src/backend/tests/test_sync_status.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.middleware.db_sync import _sync_failed, is_sync_failed, set_sync_failed


class TestSyncFailedTracking:
    """Unit tests for the in-memory sync failure tracking."""

    def setup_method(self):
        """Clear sync state before each test."""
        _sync_failed.clear()

    def test_is_sync_failed_default_false(self):
        """Unknown users should not be marked as failed."""
        assert is_sync_failed("unknown_user") is False

    def test_set_sync_failed_true(self):
        """Setting sync failed should be retrievable."""
        set_sync_failed("user1", True)
        assert is_sync_failed("user1") is True

    def test_set_sync_failed_false_clears(self):
        """Clearing sync failure should remove the entry."""
        set_sync_failed("user1", True)
        assert is_sync_failed("user1") is True

        set_sync_failed("user1", False)
        assert is_sync_failed("user1") is False
        assert "user1" not in _sync_failed

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


class TestRetrySyncEndpoint:
    """Tests for the POST /api/retry-sync endpoint."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from app.main import app
        return TestClient(app)

    def setup_method(self):
        _sync_failed.clear()

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
        """Successful sync should clear the failure flag."""
        # Pre-set failure
        set_sync_failed("a", True)

        response = client.post("/api/retry-sync")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert is_sync_failed("a") is False
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
        return TestClient(app)

    def setup_method(self):
        _sync_failed.clear()

    def test_no_header_when_sync_ok(self, client):
        """No X-Sync-Status header when sync is healthy."""
        response = client.get("/api/status")
        assert response.status_code == 200
        assert "X-Sync-Status" not in response.headers

    @patch("app.middleware.db_sync.R2_ENABLED", True)
    def test_header_present_when_sync_failed(self, client):
        """X-Sync-Status: failed header should be present when sync has failed."""
        # Pre-set failure for default user
        set_sync_failed("a", True)

        response = client.get("/api/status")
        assert response.status_code == 200
        assert response.headers.get("X-Sync-Status") == "failed"
