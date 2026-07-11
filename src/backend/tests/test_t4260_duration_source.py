"""
T4260 backend regression: the game duration is made correct at the SOURCE.

The frontend's reactive PATCH /games/{id}/duration (the last banned effect->API write)
is removed. Its premise -- "DB duration can be truncated if ffprobe ran on an
incomplete upload" -- is fixed here: activate_game re-probes the COMPLETE R2 file and
now stores that authoritative duration (overwrite, not fill-if-missing), so a truncated
client-provided duration is corrected without any browser write-back.

Also asserts the dead PATCH endpoint is gone.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import app.routers.games as games
from app.main import app
from app.constants import GameStatus
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t4260_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def test_activation_makes_probed_duration_authoritative(monkeypatch):
    """A pending game whose stored duration is a truncated CLIENT value (10s) must end
    up with the COMPLETE-file probe value (100s) after activation."""
    _ctx()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, status, video_duration) VALUES ('T4260', ?, 10.0)",
            (GameStatus.PENDING,),
        )
        game_id = cur.lastrowid
        cur.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, video_width, "
            "video_height, video_size, fps) VALUES (?, 'h1t4260', 1, 10.0, 1920, 1080, 1000, NULL)",
            (game_id,),
        )
        conn.commit()

    # The activation probe runs on the COMPLETE R2 object and reports the true 100s.
    monkeypatch.setattr(games, "_validate_video_in_r2", lambda *a, **k: None)
    monkeypatch.setattr(
        games, "_probe_video_metadata",
        lambda *a, **k: {"duration": 100.0, "fps": 30.0, "width": 1920, "height": 1080},
    )
    monkeypatch.setattr(games, "insert_game_storage_ref", lambda *a, **k: None)
    monkeypatch.setattr(games, "calculate_upload_cost", lambda *a, **k: 1)
    monkeypatch.setattr(games, "deduct_credits", lambda *a, **k: {"success": True, "balance": 100})

    try:
        resp = client.post(f"/api/games/{game_id}/activate")
        assert resp.status_code == 200, resp.text

        with get_db_connection() as conn:
            cur = conn.cursor()
            gv_dur = cur.execute(
                "SELECT duration FROM game_videos WHERE game_id = ?", (game_id,)
            ).fetchone()["duration"]
            game_dur = cur.execute(
                "SELECT video_duration FROM games WHERE id = ?", (game_id,)
            ).fetchone()["video_duration"]
        # Authoritative complete-file probe value, not the truncated client 10s.
        assert gv_dur == pytest.approx(100.0)
        assert game_dur == pytest.approx(100.0)
    finally:
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM game_videos WHERE game_id = ?", (game_id,))
            cur.execute("DELETE FROM games WHERE id = ?", (game_id,))
            conn.commit()


def test_duration_patch_endpoint_is_gone():
    """The reactive-only PATCH /games/{id}/duration write path is removed."""
    _ctx()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name, status) VALUES ('T4260 gone', 'ready')")
        game_id = cur.lastrowid
        conn.commit()
    try:
        resp = client.patch(f"/api/games/{game_id}/duration", json={"duration": 123.0})
        assert resp.status_code in (404, 405), resp.text
    finally:
        with get_db_connection() as conn:
            conn.cursor().execute("DELETE FROM games WHERE id = ?", (game_id,))
            conn.commit()
