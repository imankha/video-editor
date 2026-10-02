"""
T11580 — publish response must carry SERVER-COMPUTED game_ids/aspect_ratio.

Bug (live-verified against the dev fixture account by the supervisor): the
frontend's Published-tab "just published" spotlight sourced a published
highlight's game_id from `useProjectsStore.getState().projects` -- a CLIENT
CACHE that can be stale relative to the server's own truth at the exact
moment of publish (e.g. last fetched before a clip's game_id was attached, or
any other timing gap). A real single-game highlight (game_ids: [11] per the
live GET /api/downloads record) resolved to gameId: null client-side, so the
spotlight auto-expanded "Mixes & compilations" instead of the real game group.

Fix: `publish_to_my_reels` now computes game_ids (same working_clips ->
raw_clips join shape as GET /api/projects' list computation) and reads
aspect_ratio from the FROZEN final_videos row -- both from THIS request's own
DB connection, at the exact moment of publish -- and returns them in the
response. The frontend no longer needs (or reads) any client-side project
cache for this data; see usePublishProject.test.jsx for the frontend half.
"""

import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "t11580-user"
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


def _seed_published_project(db_path, *, aspect_ratio, game_ids, project_name="Play 1"):
    """A project with ONE raw_clip per game_id (each linked via a
    working_clip, mirroring the real annotate->export shape) and a rendered
    final_video. final_videos.aspect_ratio is the FROZEN value this test
    asserts the publish response reads (not projects.aspect_ratio)."""
    conn = _connect(db_path)
    cur = conn.cursor()

    cur.execute(
        "INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)",
        (project_name, aspect_ratio))
    project_id = cur.lastrowid

    for i, game_id in enumerate(game_ids):
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
            "VALUES (?, 5, 10.0, 20.0, ?, 0)",
            (f"raw{i}.mp4", game_id))
        raw_clip_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, sort_order) VALUES (?, ?, ?)",
            (project_id, raw_clip_id, i))

    first_raw_clip_id = None
    if game_ids:
        cur.execute("SELECT id FROM raw_clips WHERE game_id = ? LIMIT 1", (game_ids[0],))
        first_raw_clip_id = cur.fetchone()['id']

    cur.execute(
        "INSERT INTO final_videos "
        "(project_id, filename, version, source_type, name, duration, aspect_ratio, "
        " clip_count, source_clip_id, published_at) "
        "VALUES (?, 'final.mp4', 1, 'custom_project', ?, 59.4, ?, ?, ?, NULL)",
        (project_id, project_name, aspect_ratio, max(len(game_ids), 1), first_raw_clip_id))
    final_video_id = cur.lastrowid

    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (final_video_id, project_id))
    conn.commit()
    conn.close()
    return project_id, final_video_id


async def _publish(project_id):
    from app.routers.downloads import publish_to_my_reels
    with patch("app.routers.downloads.archive_project", return_value=False), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True):
        return await publish_to_my_reels(project_id)


@pytest.mark.asyncio
async def test_publish_response_carries_single_source_game_id(env):
    """The exact live-verified scenario: ONE source game -> publish response
    game_ids is a single-element list with that game's id."""
    db_path = env
    game_id = _seed_game(db_path, "Game uploaded Sep 20")
    project_id, _final_video_id = _seed_published_project(
        db_path, aspect_ratio="9:16", game_ids=[game_id], project_name="Play 1")

    result = await _publish(project_id)

    assert result["success"] is True
    assert result["game_ids"] == [game_id]
    assert result["aspect_ratio"] == "9:16"


@pytest.mark.asyncio
async def test_publish_response_multi_game_mix(env):
    """Two distinct source games -> game_ids carries both (frontend's
    singleSourceGameId() then gates this to null -- Mixes target -- but the
    backend's job is only to report the TRUE set, not decide the gating)."""
    db_path = env
    game_a = _seed_game(db_path, "Game A")
    game_b = _seed_game(db_path, "Game B")
    project_id, _ = _seed_published_project(
        db_path, aspect_ratio="16:9", game_ids=[game_a, game_b], project_name="Mix Reel")

    result = await _publish(project_id)

    assert sorted(result["game_ids"]) == sorted([game_a, game_b])
    assert result["aspect_ratio"] == "16:9"


@pytest.mark.asyncio
async def test_publish_response_no_source_game(env):
    """A directly-uploaded clip with no game attribution -> empty game_ids,
    not an error, not a missing key."""
    db_path = env
    project_id, _ = _seed_published_project(
        db_path, aspect_ratio="9:16", game_ids=[], project_name="Uploaded Clip")

    result = await _publish(project_id)

    assert result["game_ids"] == []
    assert result["aspect_ratio"] == "9:16"


@pytest.mark.asyncio
async def test_publish_reads_frozen_final_video_aspect_ratio_not_project_aspect_ratio(env):
    """aspect_ratio must come from the FROZEN final_videos row (the actual
    exported reel), not projects.aspect_ratio -- they can diverge (e.g. a
    project-level setting changed after export); the frozen value is what
    will actually display in the Published tab's member list (DownloadItem.
    aspect_ratio, fv.aspect_ratio) and so is the only correct source here."""
    db_path = env
    game_id = _seed_game(db_path, "Game X")
    project_id, _final_video_id = _seed_published_project(
        db_path, aspect_ratio="9:16", game_ids=[game_id])

    # Diverge the two values directly: project says 16:9, frozen final stays 9:16.
    conn = _connect(db_path)
    conn.execute("UPDATE projects SET aspect_ratio = '16:9' WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()

    result = await _publish(project_id)

    assert result["aspect_ratio"] == "9:16", (
        "must read the FROZEN final_videos.aspect_ratio, not the (possibly "
        "stale/divergent) projects.aspect_ratio"
    )
