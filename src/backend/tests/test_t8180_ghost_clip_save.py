"""T8180: a clip save against a deleted game must fail LOUDLY (404), never write an
orphan raw_clip.

Bug 47p: the failed-upload cleanup deleted the game the user was annotating, then the
user kept annotating the ghost. `POST /clips/raw/save` had NO game-existence check, so
every clip saved during that ghost session landed as an orphan raw_clip row against a
dead game_id and returned 200 — a silent success into the void. T8180 adds a
`SELECT 1 FROM games WHERE id = ?` guard so the save 404s and the client can surface the
ghost + preserve the user's work in memory.
"""

import sqlite3
from unittest.mock import patch

import httpx
import pytest

from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER_ID = "t8180-user"
PROFILE_ID = "a1b2c3d4"
HEADERS = {"X-User-ID": USER_ID, "X-Profile-ID": PROFILE_ID, "X-Test-Mode": "true"}


def _ctx():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)


@pytest.fixture()
def ghost_env(tmp_path, monkeypatch):
    """Real per-user user.sqlite + profile.sqlite under tmp_path + in-memory R2.

    Yields (app, base, game_id) with one seeded game row.
    """
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        import app.routers.clips as clips_mod
        monkeypatch.setattr(clips_mod, "record_milestone", lambda *a, **k: None)

        from app.main import app
        from app.database import ensure_database, set_local_db_version, get_db_connection
        from app.services.user_db import ensure_user_database

        _ctx()
        ensure_user_database(USER_ID)
        ensure_database()
        set_local_db_version(USER_ID, PROFILE_ID, 0)
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("INSERT INTO games (name, status) VALUES ('T8180', 'ready')")
            game_id = cur.lastrowid
            conn.commit()

        yield app, tmp_path, game_id


def _client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=HEADERS,
    )


def _profile_db_path(base):
    return base / USER_ID / "profiles" / PROFILE_ID / "profile.sqlite"


def _raw_clip_count(base):
    conn = sqlite3.connect(str(_profile_db_path(base)))
    try:
        return conn.execute("SELECT COUNT(*) FROM raw_clips").fetchone()[0]
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_clip_save_against_live_game_succeeds(ghost_env):
    """Baseline: a save against an existing game still returns 200 and writes a row."""
    app, base, game_id = ghost_env
    async with _client(app) as c:
        resp = await c.post("/api/clips/raw/save", json={
            "game_id": game_id, "start_time": 1.0, "end_time": 4.0,
            "name": "Live", "rating": 4, "video_sequence": 1,
        })
    assert resp.status_code == 200, resp.text
    assert _raw_clip_count(base) == 1


@pytest.mark.asyncio
async def test_clip_save_against_deleted_game_404s_and_writes_no_orphan(ghost_env):
    """The headline fix: after the game row is gone, a save 404s and NO row is written."""
    app, base, game_id = ghost_env

    # Simulate the ghost: the game the user was annotating gets deleted.
    from app.database import get_db_connection
    _ctx()
    with get_db_connection() as conn:
        conn.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()

    async with _client(app) as c:
        resp = await c.post("/api/clips/raw/save", json={
            "game_id": game_id, "start_time": 2.0, "end_time": 5.0,
            "name": "Ghost", "rating": 5, "video_sequence": 1,
        })

    assert resp.status_code == 404, resp.text
    assert "not found" in resp.text.lower()
    # The critical assertion: no orphan raw_clip was written.
    assert _raw_clip_count(base) == 0
