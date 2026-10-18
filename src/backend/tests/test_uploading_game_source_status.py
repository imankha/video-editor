"""
An UPLOADING game (status='pending') is not an expired game.

Staging 2026-10-17: making a highlight from a play on a game whose video was
still uploading showed "Source video expired". A pending game already carries
its blake3_hash, but its game_storage row is only written at activation
(games.py activate), so T8320's "hash + no storage row = reclaimed" rule read
it as 'expired' and the clip playback-url seam answered 410 source_expired.

The source isn't gone, it isn't there YET: storage_status is 'uploading' and
the clip seams refuse with a distinct 409 source_uploading.
"""

import sqlite3
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_uploading_src_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


def _seam_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE game_storage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blake3_hash TEXT NOT NULL UNIQUE,
            storage_expires_at TEXT
        );
    """)
    return conn


class TestComputeStorageStatusUploading:
    def test_pending_hash_no_row_is_uploading(self):
        from app.routers.games import _compute_storage_status
        assert _compute_storage_status(None, None, True, game_status="pending") == "uploading"

    def test_ready_hash_no_row_is_still_expired(self):
        """T8320 stands for a READY game: no row + hash = reclaimed."""
        from app.routers.games import _compute_storage_status
        assert _compute_storage_status(None, None, True, game_status="ready") == "expired"


class TestClipSeamUploading:
    def test_resolve_pending_is_uploading(self):
        from app.routers import games
        with patch.object(games, "get_grace_deletion_hashes", return_value=set()):
            status, can_extend = games.resolve_game_source_status(
                _seam_conn().cursor(), "h_up", None, game_status="pending"
            )
        assert (status, can_extend) == ("uploading", False)

    def test_assert_pending_raises_source_uploading_409(self):
        from app.routers import games
        with patch.object(games, "get_grace_deletion_hashes", return_value=set()), \
                pytest.raises(games.GameSourceUploading) as exc:
            games.assert_clip_source_available(
                _seam_conn().cursor(), game_id=5, blake3_hash="h_up",
                auto_export_status=None, game_status="pending",
            )
        assert exc.value.status_code == 409
        assert exc.value.detail == {"code": "source_uploading", "game_id": 5}

    def test_assert_ready_reclaimed_still_raises_expired(self):
        from app.routers import games
        with patch.object(games, "get_grace_deletion_hashes", return_value=set()), \
                pytest.raises(games.GameSourceExpired):
            games.assert_clip_source_available(
                _seam_conn().cursor(), game_id=5, blake3_hash="h_gone",
                auto_export_status=None, game_status="ready",
            )


@pytest.fixture
def pending_game():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size,
                               video_width, video_height, status)
            VALUES ('Uploading Game', 'uploading123hash', NULL, 600.0, 2715000000, 1920, 1080, 'pending')
        """)
        game_id = cursor.lastrowid
        conn.commit()

        yield game_id

        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


class TestGameEndpointsUploading:
    def test_load_reports_uploading_not_expired(self, pending_game):
        with patch("app.routers.games.get_game_video_url", return_value="https://r2.example.com/x.mp4"):
            r = client.get(f"/api/games/{pending_game}/load")
        assert r.status_code == 200, r.text
        assert r.json()["game"]["storage_status"] == "uploading"

    def test_list_reports_uploading_not_expired(self, pending_game):
        with patch("app.routers.games.get_game_video_url", return_value="https://r2.example.com/x.mp4"):
            r = client.get("/api/games")
        assert r.status_code == 200, r.text
        games = r.json()["games"] if isinstance(r.json(), dict) else r.json()
        row = next(g for g in games if g["id"] == pending_game)
        assert row["storage_status"] == "uploading"
