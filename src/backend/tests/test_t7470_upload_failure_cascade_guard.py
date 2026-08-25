"""
T7470: A failed-upload cleanup must never cascade-delete a game the user annotated
against while it was still uploading (T1540 annotate-during-upload).

The cleanup path calls DELETE /api/games/{id}?only_if_empty=true. This guard must:
  - REFUSE (200 no-op, deleted=False) when the game has raw_clips or viewed_duration > 0
  - SUCCEED (full cascade) when the game is genuinely empty
  - catch the race: a clip committed right before the DELETE still blocks it
  - leave the user-gestured DELETE (no flag) with full cascade semantics, unchanged

Run with: pytest src/backend/tests/test_t7470_upload_failure_cascade_guard.py -v
"""

import pytest
import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t7470_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "ab12cd34"  # Valid 8-char hex for middleware regex


def setup_module():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.user_context import set_current_user_id, reset_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from app.database import get_db_connection


def _make_pending_game(name: str) -> int:
    """Insert a pending game and return its id."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash, status) VALUES (?, ?, 'pending')",
            (name, f"test_hash_{uuid.uuid4().hex[:32]}"),
        )
        conn.commit()
        return cursor.lastrowid


def _add_clip(game_id: int) -> int:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO raw_clips (filename, rating, game_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)",
            (f"clip_{uuid.uuid4().hex[:8]}.mp4", 5, game_id, 0.0, 10.0),
        )
        conn.commit()
        return cursor.lastrowid


def _game_exists(game_id: int) -> bool:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM games WHERE id = ?", (game_id,))
        return cursor.fetchone() is not None


def _client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID})


def test_only_if_empty_refuses_when_clips_exist():
    """A game with annotated clips must NOT be deleted by the cleanup path."""
    game_id = _make_pending_game("Annotated During Upload")
    clip_id = _add_clip(game_id)

    with _client() as client:
        resp = client.delete(f"/api/games/{game_id}?only_if_empty=true")

    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted"] is False, "cleanup must refuse to delete a game with content"
    assert body.get("reason") == "has_content"

    # Game AND its clip survive.
    assert _game_exists(game_id), "game with clips was destroyed by only-if-empty cleanup"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM raw_clips WHERE id = ?", (clip_id,))
        assert cursor.fetchone()[0] == 1, "clip was cascade-deleted despite only_if_empty guard"


def test_only_if_empty_refuses_when_viewed_duration_set():
    """viewed_duration > 0 (watch progress) also counts as content."""
    game_id = _make_pending_game("Watched No Clips")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE games SET viewed_duration = ? WHERE id = ?", (42.0, game_id))
        conn.commit()

    with _client() as client:
        resp = client.delete(f"/api/games/{game_id}?only_if_empty=true")

    assert resp.status_code == 200
    assert resp.json()["deleted"] is False
    assert _game_exists(game_id), "game with viewed_duration was destroyed by cleanup"


def test_only_if_empty_deletes_when_truly_empty():
    """A genuinely empty failed attempt still gets cleaned up (no regression)."""
    game_id = _make_pending_game("Empty Failed Attempt")

    with _client() as client:
        resp = client.delete(f"/api/games/{game_id}?only_if_empty=true")

    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert not _game_exists(game_id), "empty pending game should have been cleaned up"


def test_only_if_empty_404_when_game_missing():
    """Missing game is still a 404 (guard doesn't swallow it)."""
    with _client() as client:
        resp = client.delete("/api/games/99999999?only_if_empty=true")
    assert resp.status_code == 404


def test_race_clip_committed_before_delete_is_caught():
    """The race: the client saw an empty game, a clip lands, THEN the cleanup DELETE
    fires. The backend guard re-checks and refuses — work survives."""
    game_id = _make_pending_game("Race Game")

    # Simulate the client's pre-check seeing an empty game (no clips yet).
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM raw_clips WHERE game_id = ?", (game_id,))
        assert cursor.fetchone()[0] == 0

    # A clip commits AFTER the pre-check but BEFORE the DELETE arrives.
    clip_id = _add_clip(game_id)

    with _client() as client:
        resp = client.delete(f"/api/games/{game_id}?only_if_empty=true")

    assert resp.json()["deleted"] is False, "backend guard failed to catch the race"
    assert _game_exists(game_id)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM raw_clips WHERE id = ?", (clip_id,))
        assert cursor.fetchone()[0] == 1


def test_user_gestured_delete_still_cascades():
    """DELETE with no flag keeps full cascade semantics — a user delete of a game
    with clips removes game + clips exactly as before."""
    game_id = _make_pending_game("User Deletes This")
    clip_id = _add_clip(game_id)

    with _client() as client:
        resp = client.delete(f"/api/games/{game_id}")

    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert not _game_exists(game_id), "user-gestured delete should remove the game"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM raw_clips WHERE id = ?", (clip_id,))
        assert cursor.fetchone()[0] == 0, "user-gestured delete should cascade to clips"
