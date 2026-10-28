"""
T13810 -- one `[STATE]` line after each mutating gesture, READ BACK from the DB
(never from intent), plus `profile=` on the `[REQ]` middleware line.
"""

import logging
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


def _state_lines(caplog):
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("[STATE]")]


@pytest.mark.asyncio
async def test_publish_logs_state_read_back_from_db(env, caplog):
    db_path = env
    game_id = _seed_game(db_path, "G")
    project_id, fv_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[game_id], project_name="P")
    with caplog.at_level(logging.INFO):
        await _publish(project_id)
    lines = _state_lines(caplog)
    assert len(lines) == 1, lines
    line = lines[0]
    assert "gesture=publish" in line
    assert f"user={USER_ID}" in line and f"profile={PROFILE_ID}" in line
    assert f"project={project_id}" in line
    assert f"final_video_id={fv_id}" in line
    assert "downloads_count=1" in line
    assert f"({fv_id}, 1, '" in line  # (id, version, published_at) read from final_videos
    assert f"game_reel_count={game_id}:1" in line


@pytest.mark.asyncio
async def test_restore_logs_state_with_user_and_req_id_and_nulled_published_at(env, caplog):
    from app.routers.downloads import restore_project_from_archive
    from app.user_context import set_current_req_id
    db_path = env
    game_id = _seed_game(db_path, "G")
    project_id, fv_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[game_id], project_name="P")
    await _publish(project_id)
    set_current_req_id("abcd1234")
    caplog.clear()
    with caplog.at_level(logging.INFO):
        await restore_project_from_archive(fv_id)
    lines = _state_lines(caplog)
    assert len(lines) == 1, lines
    assert "gesture=restore" in lines[0]
    assert "req_id=abcd1234" in lines[0]
    assert "downloads_count=0" in lines[0]
    assert f"({fv_id}, 1, None)" in lines[0]
    start = [r.getMessage() for r in caplog.records if r.getMessage().startswith("[Restore] start")]
    assert start and "user=" in start[0] and "req_id=abcd1234" in start[0]


@pytest.mark.asyncio
async def test_restore_404_logs_user_and_req_id_on_early_return(env, caplog):
    from fastapi import HTTPException

    from app.routers.downloads import restore_project_from_archive
    from app.user_context import set_current_req_id
    set_current_req_id("dead0001")
    with caplog.at_level(logging.INFO), pytest.raises(HTTPException):
        await restore_project_from_archive(99999)
    exits = [r.getMessage() for r in caplog.records if r.getMessage().startswith("[Restore] exit")]
    assert exits and "404" in exits[0] and "req_id=dead0001" in exits[0] and "user=" in exits[0]


@pytest.mark.asyncio
async def test_delete_download_logs_state(env, caplog):
    from app.routers.downloads import delete_download
    db_path = env
    project_id, fv_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[None], project_name="P")
    await _publish(project_id)
    caplog.clear()
    with caplog.at_level(logging.INFO), patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True):
        await delete_download(fv_id, remove_file=False)
    lines = _state_lines(caplog)
    assert len(lines) == 1 and "gesture=delete-download" in lines[0] and "downloads_count=0" in lines[0]
