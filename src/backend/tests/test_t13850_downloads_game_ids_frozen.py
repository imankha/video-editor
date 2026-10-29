"""
T13850 (follow-up, sync matrix 2026-10-28): GET /api/downloads must report a
custom-project reel's `game_ids` from the FROZEN final_videos.game_ids blob.

The game card's reel_count (games.py _compute_reel_counts) and the Published-tab
routing (route_collection) both read the frozen blob. list_downloads built the
item-level `game_ids` for custom_project reels from a live working_clips join
instead, so a reel whose project has no working_clips rows (the sync seam's seed,
or any project whose clips were later removed) came back with game_ids: [] while
the backend still counted it for its game. The frontend's reel_count change event
(gamesDataStore.applyReelCountDelta) keys on item.game_ids, so every restore /
delete / move of such a reel left the game card stale -- the exact S2/S4/S5/S6
mismatches the Playwright sync matrix reported after T13850 landed.

Fix: prefer the frozen blob for custom_project reels too (T4190 already did this
for brilliant_clip); fall back to the working_clips join only for pre-v008 rows
whose blob is empty.
"""

import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "t13850-user"
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
        yield get_database_path()


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_custom_reel(db_path, *, frozen_game_ids, with_working_clip_game=None):
    """A published custom_project reel shaped like the T13820 seam seed: project +
    raw clip + final_videos row with a FROZEN game_ids blob, and NO working_clips
    (unless `with_working_clip_game` names a game to join through the legacy path)."""
    from app.utils.encoding import encode_data

    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO games (name) VALUES ('Frozen game')")
    game_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, name, start_time, end_time, game_id, source) "
        "VALUES ('', 5, 'play', 10.0, 20.0, ?, 'game')", (game_id,))
    raw_clip_id = cur.lastrowid
    cur.execute(
        "INSERT INTO projects (name, aspect_ratio, is_auto_created, current_mode, source_raw_clip_id) "
        "VALUES ('HL', '9:16', 1, 'framing', ?)", (raw_clip_id,))
    project_id = cur.lastrowid
    if with_working_clip_game is not None:
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, sort_order) VALUES (?, ?, 0)",
            (project_id, raw_clip_id))
    blob = encode_data([game_id if g == "self" else g for g in frozen_game_ids]) if frozen_game_ids is not None else None
    cur.execute(
        """INSERT INTO final_videos
             (project_id, filename, version, duration, source_type, game_id, name,
              published_at, aspect_ratio, clip_count, source_clip_id, game_ids)
           VALUES (?, 'seed.mp4', 1, 1.0, 'custom_project', ?, 'HL',
                   CURRENT_TIMESTAMP, '9:16', 1, ?, ?)""",
        (project_id, game_id, raw_clip_id, blob))
    final_video_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (final_video_id, project_id))
    conn.commit()
    conn.close()
    return game_id, final_video_id


async def _item(final_video_id):
    from app.routers.downloads import list_downloads
    response = await list_downloads()
    return next(d for d in response.downloads if d.id == final_video_id)


@pytest.mark.asyncio
async def test_custom_project_reel_game_ids_come_from_the_frozen_blob(env):
    """No working_clips at all (the seam seed / a project whose clips were removed):
    the item must still name the game the backend counts it for."""
    game_id, fv_id = _seed_custom_reel(env, frozen_game_ids=["self"])
    item = await _item(fv_id)
    assert item.game_ids == [game_id], (
        f"list_downloads game_ids={item.game_ids}: must mirror the frozen blob the "
        f"game card's reel_count uses, not the (empty) working_clips join")
    assert item.game_names and item.game_names[0], "game name resolved for the frozen id"


@pytest.mark.asyncio
async def test_pre_v008_custom_reel_falls_back_to_working_clips(env):
    """Empty frozen blob + a working_clips row (pre-v008 shape): the legacy join
    still attributes the game, so old reels keep their grouping."""
    game_id, fv_id = _seed_custom_reel(env, frozen_game_ids=None, with_working_clip_game="self")
    item = await _item(fv_id)
    assert item.game_ids == [game_id]
