"""
Exact playhead resume tests.

POST /api/games/{game_id}/playhead persists games.last_playhead_position — the
*exact* last playhead position used to resume single-video annotation where the
user left off. Unlike viewed_duration (a high-water mark), this value may move
backward. GET /api/games/{game_id}/load returns it so the client can seek to it.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_playhead_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})
unauth_client = TestClient(app)


@pytest.fixture
def game():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size, video_width, video_height)
            VALUES ('Playhead Game', 'phhash', 'ph.mp4', 600.0, 1000, 1920, 1080)
        """)
        game_id = cursor.lastrowid
        conn.commit()

        yield game_id

        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


def _last_playhead(game_id):
    with get_db_connection() as conn:
        row = conn.cursor().execute(
            "SELECT last_playhead_position FROM games WHERE id = ?", (game_id,)
        ).fetchone()
        return row["last_playhead_position"]


class TestSavePlayhead:
    def test_saves_position(self, game):
        r = client.post(f"/api/games/{game}/playhead", json={"position": 123.5})
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True
        assert _last_playhead(game) == pytest.approx(123.5)

    def test_overwrites_and_may_move_backward(self, game):
        """Direct overwrite — not a high-water mark (the key difference from viewed_duration)."""
        client.post(f"/api/games/{game}/playhead", json={"position": 200.0})
        client.post(f"/api/games/{game}/playhead", json={"position": 50.0})
        assert _last_playhead(game) == pytest.approx(50.0)

    def test_rejects_negative(self, game):
        r = client.post(f"/api/games/{game}/playhead", json={"position": -1})
        assert r.status_code == 422

    def test_requires_auth(self):
        r = unauth_client.post("/api/games/1/playhead", json={"position": 1.0}, headers={})
        assert r.status_code == 401


class TestLoadReturnsPlayhead:
    def test_null_when_unset(self, game):
        r = client.get(f"/api/games/{game}/load")
        assert r.status_code == 200, r.text
        assert r.json()["game"]["last_playhead_position"] is None

    def test_returns_saved_position(self, game):
        client.post(f"/api/games/{game}/playhead", json={"position": 77.0})
        r = client.get(f"/api/games/{game}/load")
        assert r.status_code == 200, r.text
        assert r.json()["game"]["last_playhead_position"] == pytest.approx(77.0)

    def test_independent_of_viewed_duration(self, game):
        """Saving the playhead must NOT change viewed_duration (the progress high-water mark)."""
        client.post(f"/api/games/{game}/finish-annotation", json={"viewed_duration": 300.0})
        client.post(f"/api/games/{game}/playhead", json={"position": 42.0})
        body = client.get(f"/api/games/{game}/load").json()["game"]
        assert body["viewed_duration"] == pytest.approx(300.0)
        assert body["last_playhead_position"] == pytest.approx(42.0)
