"""
T3430: Game load endpoint tests.

GET /api/games/{game_id}/load returns game data, playback URL, teammate tags,
and teammate shares in a single response -- eliminating the 4-request waterfall.
"""

import json
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t3430_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})
unauth_client = TestClient(app)


@pytest.fixture
def game_with_data():
    """Create a game with a clip, teammate tag, and teammate share record."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size, video_width, video_height)
            VALUES ('Test Game', 'abc123hash', 'test_game.mp4', 600.0, 1000000000, 1920, 1080)
        """)
        game_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO raw_clips (game_id, start_time, end_time, filename, rating)
            VALUES (?, 10.0, 20.0, 'test_raw.mp4', 3)
        """, (game_id,))
        raw_clip_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO clip_teammates (clip_id, tag_name)
            VALUES (?, 'Player A')
        """, (raw_clip_id,))

        cursor.execute("""
            INSERT INTO teammate_shares (game_id, tag_name, shared_clip_ids, created_at)
            VALUES (?, 'Player A', ?, CURRENT_TIMESTAMP)
        """, (game_id, json.dumps([raw_clip_id])))

        conn.commit()

        yield game_id, raw_clip_id

        cursor.execute("DELETE FROM teammate_shares WHERE game_id = ?", (game_id,))
        cursor.execute("DELETE FROM clip_teammates WHERE clip_id = ?", (raw_clip_id,))
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


@pytest.fixture
def game_minimal():
    """Game with blake3_hash but no clips, tags, or shares."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size, video_width, video_height)
            VALUES ('Minimal Game', 'min123hash', 'minimal.mp4', 300.0, 500000, 1280, 720)
        """)
        game_id = cursor.lastrowid
        conn.commit()

        yield game_id

        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


class TestGameLoad:
    """GET /api/games/{game_id}/load"""

    def test_load_returns_all_sections(self, game_with_data):
        """Response contains game, playback_url, teammate_tags, and teammate_shares."""
        game_id, raw_clip_id = game_with_data

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/abc123hash.mp4?sig=test",
        ):
            r = client.get(f"/api/games/{game_id}/load")

        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        body = r.json()

        assert "game" in body
        assert "playback_url" in body
        assert "teammate_tags" in body
        assert "teammate_shares" in body

    def test_load_game_data_matches_get_game(self, game_with_data):
        """Game section matches the individual GET /api/games/{id} response."""
        game_id, _ = game_with_data

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/abc123hash.mp4?sig=test",
        ):
            load_r = client.get(f"/api/games/{game_id}/load")

        assert load_r.status_code == 200
        game = load_r.json()["game"]

        assert game["id"] == game_id
        assert game["video_duration"] == 600.0
        assert game["video_width"] == 1920
        assert game["video_height"] == 1080
        assert isinstance(game["annotations"], list)
        assert len(game["annotations"]) == 1

    def test_load_playback_url_present(self, game_with_data):
        """Playback URL section has url, expires_in, and file_size."""
        game_id, _ = game_with_data

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/abc123hash.mp4?sig=test",
        ):
            r = client.get(f"/api/games/{game_id}/load")

        pb = r.json()["playback_url"]
        assert pb is not None
        assert pb["url"].startswith("https://")
        assert pb["expires_in"] == 14400
        assert pb["file_size"] == 1000000000

    def test_load_teammate_tags(self, game_with_data):
        """Teammate tags section returns tag names."""
        game_id, _ = game_with_data

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/abc123hash.mp4?sig=test",
        ):
            r = client.get(f"/api/games/{game_id}/load")

        tags = r.json()["teammate_tags"]
        assert isinstance(tags, list)
        assert "Player A" in tags

    def test_load_teammate_shares(self, game_with_data):
        """Teammate shares section returns share records for this game."""
        game_id, raw_clip_id = game_with_data

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/abc123hash.mp4?sig=test",
        ):
            r = client.get(f"/api/games/{game_id}/load")

        shares = r.json()["teammate_shares"]
        assert isinstance(shares, list)
        assert len(shares) == 1
        assert shares[0]["tag_name"] == "Player A"
        assert raw_clip_id in shares[0]["shared_clip_ids"]
        assert "shared_at" in shares[0]

    def test_load_empty_shares_and_annotations(self, game_minimal):
        """Game with no clips/shares returns empty arrays for per-game data."""
        game_id = game_minimal

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/min123hash.mp4?sig=test",
        ):
            r = client.get(f"/api/games/{game_id}/load")

        assert r.status_code == 200
        body = r.json()
        assert isinstance(body["teammate_tags"], list)
        assert body["teammate_shares"] == []
        assert body["game"]["annotations"] == []

    def test_load_storage_status_active_when_no_ref(self, game_minimal):
        """bug 27p: a game with a live source (no game_storage ref, no
        auto-export) reports storage_status 'active' so Annotate plays normally."""
        game_id = game_minimal

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/min123hash.mp4?sig=test",
        ):
            r = client.get(f"/api/games/{game_id}/load")

        assert r.status_code == 200
        assert r.json()["game"]["storage_status"] == "active"

    def test_load_storage_status_expired(self, game_minimal):
        """bug 27p: when the game's game_storage ref has a past expiry, /load
        reports storage_status 'expired' so Annotate can show the expired state
        instead of a broken player."""
        from datetime import datetime, timedelta

        game_id = game_minimal
        past = (datetime.utcnow() - timedelta(days=1)).isoformat()

        set_current_user_id(TEST_USER_ID)
        set_current_profile_id(TEST_PROFILE_ID)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) "
                "VALUES ('min123hash', 500000, ?)",
                (past,),
            )
            conn.commit()

        try:
            with patch(
                "app.routers.games.get_game_video_url",
                return_value="https://r2.example.com/games/min123hash.mp4?sig=test",
            ):
                r = client.get(f"/api/games/{game_id}/load")

            assert r.status_code == 200
            assert r.json()["game"]["storage_status"] == "expired"
        finally:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM game_storage WHERE blake3_hash = 'min123hash'")
                conn.commit()

    def test_load_not_found(self):
        """Non-existent game_id returns 404."""
        r = client.get("/api/games/999999/load")
        assert r.status_code == 404

    def test_load_requires_auth(self):
        """Request without auth headers returns 401."""
        r = unauth_client.get("/api/games/1/load", headers={})
        assert r.status_code == 401
