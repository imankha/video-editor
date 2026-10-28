"""
T13820 -- POST /api/test/seed-published-highlight builds a fully LINKED highlight
(game + raw clip + auto project + final_video with project_id) so the sync QA
matrix can exercise restore/delete/move, which the project_id-NULL
`seed-final-video` cannot.
"""

import asyncio
import sqlite3
from unittest.mock import patch

import pytest
from fastapi import HTTPException

import app.storage as storage

USER_ID = "t13820-user"
PROFILE_ID = "testdefault"


@pytest.fixture()
def env(tmp_path, monkeypatch):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    monkeypatch.setattr(storage, "APP_ENV", "dev")

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _seed(**kw):
    from app.routers import test_seams
    req = test_seams.SeedPublishedHighlightRequest(with_media=False, **kw)
    return asyncio.run(test_seams.seed_published_highlight(req))


def _rows(db_path, sql, args=()):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


def test_published_highlight_is_fully_linked(env):
    out = _seed(published=True)

    fv = _rows(env, "SELECT * FROM final_videos WHERE id = ?", (out["final_video_id"],))[0]
    assert fv["project_id"] == out["project_id"]
    assert fv["published_at"] is not None

    proj = _rows(env, "SELECT * FROM projects WHERE id = ?", (out["project_id"],))[0]
    assert proj["is_auto_created"] == 1
    assert proj["source_raw_clip_id"] == out["raw_clip_id"]
    assert proj["final_video_id"] == out["final_video_id"]
    assert proj["archived_at"] is not None  # publish archives the project

    clip = _rows(env, "SELECT * FROM raw_clips WHERE id = ?", (out["raw_clip_id"],))[0]
    assert clip["auto_project_id"] == out["project_id"]
    assert clip["game_id"] == out["game_id"]


def test_unpublished_leaves_published_at_null(env):
    out = _seed(published=False)
    fv = _rows(env, "SELECT published_at FROM final_videos WHERE id = ?", (out["final_video_id"],))[0]
    assert fv["published_at"] is None
    proj = _rows(env, "SELECT archived_at FROM projects WHERE id = ?", (out["project_id"],))[0]
    assert proj["archived_at"] is None


def test_second_orientation_reuses_game_and_play(env):
    first = _seed(published=True)
    second = _seed(published=True, aspect_ratio="16:9",
                   game_id=first["game_id"], raw_clip_id=first["raw_clip_id"])
    assert second["game_id"] == first["game_id"]
    assert second["raw_clip_id"] == first["raw_clip_id"]
    assert second["project_id"] != first["project_id"]
    assert len(_rows(env, "SELECT id FROM games")) == 1
    assert len(_rows(env, "SELECT id FROM raw_clips")) == 1


def test_shared_in_clip_flags(env):
    out = _seed(shared_by="coach@example.com", my_athlete=0)
    clip = _rows(env, "SELECT shared_by, my_athlete FROM raw_clips WHERE id = ?", (out["raw_clip_id"],))[0]
    assert clip["shared_by"] == "coach@example.com"
    assert clip["my_athlete"] == 0


def test_seam_404_when_disabled(env, monkeypatch):
    monkeypatch.setattr(storage, "APP_ENV", "production")
    with pytest.raises(HTTPException) as exc:
        _seed()
    assert exc.value.status_code == 404


def test_final_video_freezes_game_ids_so_game_reel_count_sees_it(env):
    from app.database import get_db_connection
    from app.routers.games import _compute_reel_counts
    out = _seed(published=True)
    with get_db_connection() as conn:
        cur = conn.cursor()
        assert _compute_reel_counts(cur, [out["game_id"]]) == {out["game_id"]: 1}
