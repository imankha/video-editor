"""
T4270 regression tests.

Item 1: the dormant PUT /api/games/{id}/annotations endpoint (full-state annotation
        writer) is gone.
Item 2: DELETE /api/games/dedupe/{id} now goes through the SAME _delete_game_cascade
        helper the main DELETE route uses, so it decrements game_storage refs and
        prunes orphaned projects instead of leaking them (bare `DELETE FROM games`).
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import app.services.auth_db as auth_db
from app.main import app
from app.database import get_db_connection
from app.routers.games import _delete_game_cascade
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t4270_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def _seed_game_with_video_and_project(hash_value):
    """Game + one video (hash) + a raw_clip + a project whose only clip is this game's."""
    _ctx()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name) VALUES ('T4270 Game')")
        game_id = cur.lastrowid
        cur.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, 0)",
            (game_id, hash_value),
        )
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, game_id) VALUES ('r.mp4', 3, ?)",
            (game_id,),
        )
        raw_clip_id = cur.lastrowid
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T4270 P', '9:16')")
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (?, ?, 1)",
            (project_id, raw_clip_id),
        )
        conn.commit()
    return game_id, project_id


def _game_exists(game_id):
    with get_db_connection() as conn:
        return conn.cursor().execute(
            "SELECT 1 FROM games WHERE id = ?", (game_id,)
        ).fetchone() is not None


def _project_exists(project_id):
    with get_db_connection() as conn:
        return conn.cursor().execute(
            "SELECT 1 FROM projects WHERE id = ?", (project_id,)
        ).fetchone() is not None


# --- Item 1 -----------------------------------------------------------------

def test_annotations_put_endpoint_is_gone():
    """The dormant full-state annotations writer endpoint no longer exists."""
    _ctx()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name) VALUES ('T4270 Ann')")
        game_id = cur.lastrowid
        conn.commit()
    try:
        resp = client.put(f"/api/games/{game_id}/annotations", json=[])
        assert resp.status_code in (404, 405), resp.text
    finally:
        with get_db_connection() as conn:
            conn.cursor().execute("DELETE FROM games WHERE id = ?", (game_id,))
            conn.commit()


# --- Item 2 -----------------------------------------------------------------

def test_delete_game_cascade_returns_hashes_and_prunes_orphans():
    """The shared helper collects video hashes (for ref cleanup) and prunes the now
    orphaned project."""
    hash_value = f"hash_{uuid.uuid4().hex[:8]}"
    game_id, project_id = _seed_game_with_video_and_project(hash_value)
    try:
        with get_db_connection() as conn:
            cur = conn.cursor()
            hashes, orphaned = _delete_game_cascade(cur, game_id)
            conn.commit()
        assert hashes == [hash_value]
        assert orphaned == 1
        assert not _game_exists(game_id)
        assert not _project_exists(project_id)
    finally:
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
            cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            cur.execute("DELETE FROM games WHERE id = ?", (game_id,))
            conn.commit()


def test_dedupe_delete_route_cleans_up_storage_refs(monkeypatch):
    """DELETE /dedupe/{id} must decrement game_storage refs (call delete_ref) for the
    game's video hashes -- the bug was a bare DELETE that leaked refs forever."""
    hash_value = f"hash_{uuid.uuid4().hex[:8]}"
    game_id, project_id = _seed_game_with_video_and_project(hash_value)

    calls = []
    monkeypatch.setattr(auth_db, "delete_ref", lambda user_id, profile_id, h: calls.append(h))

    try:
        resp = client.delete(f"/api/games/dedupe/{game_id}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "deleted"

        # Storage ref cleanup happened for the game's video hash.
        assert calls == [hash_value]
        # Game and its now-orphaned project are gone.
        assert not _game_exists(game_id)
        assert not _project_exists(project_id)
    finally:
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
            cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            cur.execute("DELETE FROM games WHERE id = ?", (game_id,))
            conn.commit()
