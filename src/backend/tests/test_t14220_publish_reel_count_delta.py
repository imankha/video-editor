"""
T14220: the game card's reel_count follows the publish change event.

POST /api/downloads/publish/{id} returns the reel's frozen `game_ids` and
`newly_published` (the latest version was NOT published before this call), so
the frontend applies +1 to the game card exactly when GET /api/games's
_compute_reel_counts moves (latest version per source, published only).
"""

import sqlite3

import pytest

from app.utils.encoding import encode_data
from tests.test_t4050_publish_restore_roundtrip import env  # noqa: F401  (fixture)

GAME_ID = 7


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_unpublished_reel(db_path, game_ids):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('QA sweep', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw.mp4', 5, 1.0, 9.0, ?, 0)", (GAME_ID,))
    raw_clip_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, crop_data, segments_data) "
        "VALUES (?, ?, 1, 0, ?, ?)", (project_id, raw_clip_id, b"\x91\x80", b"\x80"))
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration, effect_type, overlay_version) "
        "VALUES (?, 'wv.mp4', 1, 8.0, 'brightness_boost', 1)", (project_id,))
    working_video_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, duration, "
        " aspect_ratio, clip_count, game_ids, source_clip_id) "
        "VALUES (?, 'final.mp4', 1, 'custom_project', 'QA sweep', 8.0, '9:16', 1, ?, ?)",
        (project_id, encode_data(game_ids), raw_clip_id))
    final_video_id = cur.lastrowid
    cur.execute("UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                (working_video_id, final_video_id, project_id))
    conn.commit()
    conn.close()
    return project_id, final_video_id


def _backend_reel_count(db_path, game_id):
    from app.routers.games import _compute_reel_counts
    conn = _connect(db_path)
    try:
        return _compute_reel_counts(conn.cursor(), [game_id]).get(game_id, 0)
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_t14220_c1_first_publish_reports_newly_published_with_frozen_game_ids(env):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import publish_to_my_reels

    project_id, _ = _seed_unpublished_reel(db_path, [GAME_ID])
    before = _backend_reel_count(db_path, GAME_ID)

    result = await publish_to_my_reels(project_id)

    assert result["newly_published"] is True
    assert result["game_ids"] == [GAME_ID]
    assert _backend_reel_count(db_path, GAME_ID) == before + 1


@pytest.mark.asyncio
async def test_t14220_c3_republish_of_published_latest_is_not_newly_published(env):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import publish_to_my_reels

    project_id, _ = _seed_unpublished_reel(db_path, [GAME_ID])
    await publish_to_my_reels(project_id)
    before = _backend_reel_count(db_path, GAME_ID)

    result = await publish_to_my_reels(project_id)

    assert result["newly_published"] is False
    assert _backend_reel_count(db_path, GAME_ID) == before


@pytest.mark.asyncio
async def test_t14220_c3_restore_then_publish_counts_once_again(env):  # noqa: F811
    """The 'dfsadf' re-export case: Edit (restore: unpublish, frontend -1) then
    finish again (publish: +1) nets the backend count back to where it was."""
    db_path, _ = env
    from app.routers.downloads import publish_to_my_reels, restore_project_from_archive

    project_id, final_video_id = _seed_unpublished_reel(db_path, [GAME_ID])
    await publish_to_my_reels(project_id)
    published_count = _backend_reel_count(db_path, GAME_ID)

    await restore_project_from_archive(final_video_id)
    assert _backend_reel_count(db_path, GAME_ID) == published_count - 1

    result = await publish_to_my_reels(project_id)

    assert result["newly_published"] is True
    assert result["game_ids"] == [GAME_ID]
    assert _backend_reel_count(db_path, GAME_ID) == published_count
