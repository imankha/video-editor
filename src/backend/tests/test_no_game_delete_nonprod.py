"""
Guard: non-production environments must NEVER delete a game video from R2.

Game videos live in a SHARED, env-prefix-free R2 namespace (games/{hash}.mp4)
used by dev, staging, AND prod. A non-prod environment cannot see prod's refs,
so deleting a game object there 404s the video for prod users. The hard
guarantee lives at the single choke point r2_delete_object_global(); this test
pins it independently of any caller (the sweep, admin, future code).
"""

from unittest.mock import MagicMock, patch

import app.storage as storage


def _mock_client():
    """A client whose delete_object we can assert on; retry_r2_call invokes it."""
    return MagicMock()


class TestGameDeleteEnvGuard:
    @patch.object(storage, "APP_ENV", "staging")
    def test_staging_blocks_game_object_delete(self):
        client = _mock_client()
        with patch.object(storage, "get_r2_client", return_value=client):
            result = storage.r2_delete_object_global("games/abc123.mp4")
        assert result is False
        client.delete_object.assert_not_called()

    @patch.object(storage, "APP_ENV", "dev")
    def test_dev_blocks_game_object_delete(self):
        client = _mock_client()
        with patch.object(storage, "get_r2_client", return_value=client):
            result = storage.r2_delete_object_global("games/abc123.mp4")
        assert result is False
        client.delete_object.assert_not_called()

    @patch.object(storage, "APP_ENV", "production")
    def test_production_allows_game_object_delete(self):
        client = _mock_client()
        with patch.object(storage, "get_r2_client", return_value=client):
            result = storage.r2_delete_object_global("games/abc123.mp4")
        assert result is True
        client.delete_object.assert_called_once()

    @patch.object(storage, "APP_ENV", "staging")
    def test_non_game_key_still_deletable_in_non_prod(self):
        """Env-prefixed / non-game global keys (e.g. bug assets) are env-local
        and must stay deletable on staging/dev — the guard is games/ only."""
        client = _mock_client()
        with patch.object(storage, "get_r2_client", return_value=client):
            result = storage.r2_delete_object_global("staging/bug_reports/x.png")
        assert result is True
        client.delete_object.assert_called_once()
