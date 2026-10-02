"""
T11580 — publish response must AGREE with the real Published-tab routing.

Two bugs found live, both fixed here:

Bug A (live-verified against the dev fixture account): the frontend's
Published-tab "just published" spotlight sourced a published highlight's
game_id from `useProjectsStore.getState().projects` -- a CLIENT CACHE that
can be stale relative to the server's own truth at the exact moment of
publish. A real single-game highlight (game_ids: [11] per the live
GET /api/downloads record) resolved to gameId: null client-side, so the
spotlight auto-expanded "Mixes & compilations" instead of the real game
group.

Bug B (independent proof-verifier pass, same day): the FIRST fix for Bug A
had `publish_to_my_reels` re-derive game_ids via a fresh
working_clips/raw_clips JOIN that ignored `clip_count` entirely. But the
Published tab's ACTUAL routing rule -- `route_collection(fv.game_ids,
fv.clip_count)` (collection_metadata.py), read by `list_downloads` from the
FROZEN `final_videos` row -- sends ANY reel with clip_count != 1 to Mixes
regardless of how many games it touches. So a 2-clip highlight made from ONE
game got a wrong `game_ids=[that_game]` in the publish response while
`list_downloads` correctly routed it to Mixes -- the spotlight targeted a
group the highlight was never actually a member of (AC1/AC3 broken for any
multi-clip single-game highlight, not an edge case).

Fix: `publish_to_my_reels` now reads the ALREADY-FROZEN
`final_videos.game_ids`/`clip_count` columns (frozen at export-finalize by
`publish_final_video` -> `compute_project_game_ids` /
`compute_project_ranking_freeze` -- the SAME values `list_downloads` reads)
and computes `route_collection(game_ids, clip_count)` -- the EXACT SAME
routing decision `list_downloads` makes -- returning it as
`collection_game_id` (a single game id, or None for Mixes) instead of a raw
game_ids list the frontend would have to re-gate (and could re-gate wrong).

The tests below seed through the REAL freeze path (`publish_final_video`,
not a hand-rolled `final_videos.game_ids` value) and assert the publish
response's routing target AGREES with a real `list_downloads()` call for
all 4 shapes: 1-clip single-game, multi-clip single-game (Bug B's exact
case), multi-game, and no-game.
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


async def _member_ids(**filters):
    from app.routers.downloads import list_downloads
    response = await list_downloads(**filters)
    return {d.id for d in response.downloads}


@pytest.mark.asyncio
async def test_single_clip_single_game_routes_to_that_game(env):
    """1-clip reel from ONE game -> publish response targets that game, AND
    list_downloads(game_id=that_game) actually contains it while
    list_downloads(mixes=True) does not (routing agreement)."""
    db_path = env
    game_id = _seed_game(db_path, "Game uploaded Sep 20")
    project_id, final_video_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[game_id], project_name="Play 1")

    result = await _publish(project_id)
    assert result["collection_game_id"] == game_id
    assert result["aspect_ratio"] == "9:16"

    assert final_video_id in await _member_ids(game_id=game_id)
    assert final_video_id not in await _member_ids(mixes=True)


@pytest.mark.asyncio
async def test_multi_clip_single_game_routes_to_mixes_not_the_game(env):
    """Bug B's EXACT case: a 2-clip reel from ONE game must route to Mixes
    (clip_count != 1), never to that game's group -- even though every clip
    shares the same game_id. This is the case the first fix got wrong."""
    db_path = env
    game_id = _seed_game(db_path, "Game uploaded Sep 20")
    project_id, final_video_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[game_id, game_id], project_name="Multi-clip Highlight")

    result = await _publish(project_id)
    assert result["collection_game_id"] is None, (
        "a multi-clip reel must route to Mixes (collection_game_id: None) "
        "even when every clip is from the SAME game"
    )
    assert result["aspect_ratio"] == "9:16"

    assert final_video_id in await _member_ids(mixes=True)
    assert final_video_id not in await _member_ids(game_id=game_id)


@pytest.mark.asyncio
async def test_single_clip_multi_game_routes_to_mixes(env):
    """A single-clip reel can't actually span multiple games in practice,
    but route_collection's len(game_ids) > 1 branch is exercised here via two
    1-clip-each distinct-game projects merged conceptually -- instead we
    cover the real multi-game shape directly: a project whose (single,
    per compute_project_game_ids) clip set resolves >1 distinct game id is
    not constructible with one clip, so this test seeds 2 clips across 2
    games (clip_count=2, game_ids len=2) -- still routes to Mixes, for BOTH
    reasons (clip_count != 1 AND multi-game), proving neither alone needs to
    be the deciding factor for this shape."""
    db_path = env
    game_a = _seed_game(db_path, "Game A")
    game_b = _seed_game(db_path, "Game B")
    project_id, final_video_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="16:9", clip_game_ids=[game_a, game_b], project_name="Mix Reel")

    result = await _publish(project_id)
    assert result["collection_game_id"] is None
    assert result["aspect_ratio"] == "16:9"

    assert final_video_id in await _member_ids(mixes=True)
    assert final_video_id not in await _member_ids(game_id=game_a)
    assert final_video_id not in await _member_ids(game_id=game_b)


@pytest.mark.asyncio
async def test_no_source_game_routes_to_mixes(env):
    """A directly-uploaded clip with no game attribution routes to Mixes
    (route_game_ids: NULL/[] -> None), same as list_downloads."""
    db_path = env
    project_id, final_video_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[None], project_name="Uploaded Clip")

    result = await _publish(project_id)
    assert result["collection_game_id"] is None
    assert result["aspect_ratio"] == "9:16"

    assert final_video_id in await _member_ids(mixes=True)


@pytest.mark.asyncio
async def test_publish_reads_frozen_final_video_aspect_ratio_not_project_aspect_ratio(env):
    """aspect_ratio must come from the FROZEN final_videos row (the actual
    exported reel), not projects.aspect_ratio -- they can diverge (e.g. a
    project-level setting changed after export); the frozen value is what
    will actually display in the Published tab's member list (DownloadItem.
    aspect_ratio, fv.aspect_ratio) and so is the only correct source here."""
    db_path = env
    game_id = _seed_game(db_path, "Game X")
    project_id, _final_video_id = _seed_project_via_real_freeze(
        db_path, aspect_ratio="9:16", clip_game_ids=[game_id], project_name="Play X")

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
