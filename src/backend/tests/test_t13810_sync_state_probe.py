"""
T13810 -- GET /api/qa/sync-state answers from the SAME helpers as the list
endpoints, so the probe cannot disagree with what the UI is fed.
"""

import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "t13810-user"
PROFILE_ID = "testdefault"


@pytest.fixture()
def env(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        db_path = get_database_path()
        yield db_path


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_game(db_path, name):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO games (name) VALUES (?)", (name,))
    game_id = cur.lastrowid
    conn.commit()
    conn.close()
    return game_id


def _seed_project_via_real_freeze(db_path, *, aspect_ratio, clip_game_ids, project_name):
    """Seed a project with one raw_clip + working_clip PER entry in
    `clip_game_ids` (so len(clip_game_ids) controls clip_count), then freeze
    its final_videos row through the REAL export-finalize writer
    (`publish_final_video` -> `compute_project_game_ids` /
    `compute_project_ranking_freeze`) -- NOT a hand-rolled
    final_videos.game_ids value. This is what makes the routing-agreement
    assertion meaningful: both the publish response and list_downloads read
    the SAME frozen columns this function actually computed.

    `clip_game_ids`: a list, one entry per clip, each an int game_id or None
    (no game attribution). E.g. [7] = 1 clip, 1 game. [7, 7] = 2 clips, same
    game (Bug B's exact case: multi-clip, single source game). [7, 8] =
    multi-game. [None] = one clip, no game.
    """
    from app.services.publish_final_video import publish_final_video

    conn = _connect(db_path)
    cur = conn.cursor()

    cur.execute(
        "INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)",
        (project_name, aspect_ratio))
    project_id = cur.lastrowid

    for i, game_id in enumerate(clip_game_ids):
        # Distinct end_time per clip so latest_working_clips_subquery's
        # per-(project_id, end_time) identity partition counts each as its
        # own latest clip (same end_time would collide/dedupe to one).
        end_time = 20.0 + i * 100
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
            "VALUES (?, 5, 10.0, ?, ?, 0)",
            (f"raw{i}.mp4", end_time, game_id))
        raw_clip_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, sort_order) VALUES (?, ?, ?)",
            (project_id, raw_clip_id, i))

    result = publish_final_video(
        cur, project_id=project_id, output_filename=f"{project_name}.mp4",
        aspect_ratio=aspect_ratio,
    )
    conn.commit()
    conn.close()
    return project_id, result["final_video_id"]


async def _publish(project_id):
    from app.routers.downloads import publish_to_my_reels
    with patch("app.routers.downloads.archive_project", return_value=False), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True):
        return await publish_to_my_reels(project_id)



async def _publish(project_id):
    from app.routers.downloads import publish_to_my_reels
    with patch("app.routers.downloads.archive_project", return_value=False), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True):
        return await publish_to_my_reels(project_id)


@pytest.mark.asyncio
async def test_probe_counts_equal_list_endpoints_after_publish(env):
    from app.routers.downloads import get_download_count
    from app.routers.games import _compute_reel_counts
    from app.routers.qa import sync_state
    db_path = env
    game_id = _seed_game(db_path, "G")
    project_id, fv_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[game_id], project_name="P")
    await _publish(project_id)

    probe = await sync_state(project_id=project_id, raw_clip_id=None, game_id=game_id)
    listed = await get_download_count()

    assert probe["counts"]["downloads_count"] == listed["count"] == 1
    assert probe["counts"]["downloads_unwatched"] == listed["unwatched_count"] == 1
    conn = _connect(db_path)
    expected = _compute_reel_counts(conn.cursor(), [game_id])
    conn.close()
    assert probe["counts"]["game_reel_count"] == expected.get(game_id, 0) == 1
    assert probe["project"]["id"] == project_id
    assert [v["id"] for v in probe["final_videos"]] == [fv_id]
    assert probe["final_videos"][0]["published_at"] is not None


@pytest.mark.asyncio
async def test_probe_highlight_instances_equal_clips_helper(env):
    from app.routers.clips import _get_highlight_instances_by_clip
    from app.routers.qa import sync_state
    db_path = env
    project_id, _fv_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[None], project_name="P")
    conn = _connect(db_path)
    raw_clip_id = conn.execute("SELECT raw_clip_id FROM working_clips WHERE project_id=?", (project_id,)).fetchone()[0]
    conn.execute("UPDATE projects SET source_raw_clip_id=?, is_auto_created=1 WHERE id=?", (raw_clip_id, project_id))
    conn.commit()
    await _publish(project_id)
    expected = _get_highlight_instances_by_clip(conn.cursor(), [raw_clip_id]).get(raw_clip_id, [])
    conn.close()

    probe = await sync_state(project_id=None, raw_clip_id=raw_clip_id, game_id=None)
    assert probe["raw_clip"]["id"] == raw_clip_id
    assert probe["highlight_instances"] == expected
    assert expected and expected[0]["is_published"]
