"""
T5810: moving a published reel CARRIES its game attribution into the target profile
via a metadata-only reference (T5800's ensure_game_reference), and gesture-driven
orphan cleanup removes references no reel attributes to anymore.

Covers the acceptance criteria across 3 sibling profiles (A owns the real game;
B/C receive references):
- A->B single reel groups under the correct game (reference created)
- second reel from the SAME game A->B -> still exactly ONE reference in B
- same game into TWO profiles -> one reference EACH
- move back B->A -> points at A's REAL game, NO reference in A, B's orphan deleted
- B->C chain collapse -> C's reference points at the ORIGINAL owner A
- deleting the last moved reel in B deletes B's orphan reference; real games kept
- missing source game -> id dropped + warning, no crash
"""

from unittest.mock import patch

import pytest

from app.services.collection_metadata import route_collection
from app.utils.encoding import encode_data

UID = "test-user-t5810"
A = "profa0001"   # owner of the real game
B = "profb0002"
C = "profc0003"


@pytest.fixture()
def env(tmp_path):
    """Three schema-current (head, incl. v030) sibling profile DBs for one user."""
    from app.profile_context import set_current_profile_id
    from app.services import user_db as user_db_mod
    from app.user_context import set_current_req_id, set_current_user_id

    set_current_user_id(UID)
    set_current_req_id("req-t5810")

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        from app.database import ensure_database

        user_db_mod.create_profile(UID, A, "Athlete A", "#f00", is_default=True)
        user_db_mod.create_profile(UID, B, "Athlete B", "#00f")
        user_db_mod.create_profile(UID, C, "Athlete C", "#0f0")

        for pid in (A, B, C):
            set_current_profile_id(pid)
            ensure_database()

        set_current_profile_id(A)
        yield tmp_path


import sqlite3


def _conn(base, pid):
    path = base / UID / "profiles" / pid / "profile.sqlite"
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def _insert_real_game(base, pid, gid, *, name="Championship", blake3="hashG"):
    c = _conn(base, pid)
    c.execute(
        "INSERT INTO games (id, name, blake3_hash, status, opponent_name, game_date, "
        "game_type, video_duration, video_width, video_height, video_size, video_fps) "
        "VALUES (?, ?, ?, 'ready', 'Rivals', '2026-05-01', 'match', 3600, 1920, 1080, 99, 30)",
        (gid, name, blake3),
    )
    c.execute(
        "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, video_width, "
        "video_height, video_size, fps) VALUES (?, ?, 0, 3600, 1920, 1080, 99, 30)",
        (gid, blake3),
    )
    c.commit()
    c.close()


_fid = [8000]


def _insert_reel(base, pid, *, game_ids=None, game_id=None, clip_count=1,
                 quality_score=5.0, published=True):
    from app.services.glicko import seed_rating
    _fid[0] += 1
    fid = _fid[0]
    rating = seed_rating(quality_score) + 50 if clip_count == 1 else None
    rd = 120.0 if clip_count == 1 else None
    c = _conn(base, pid)
    c.execute(
        """
        INSERT INTO final_videos
          (id, project_id, filename, version, duration, source_type, game_id,
           name, rating_counts, watched_at, published_at, aspect_ratio, tags,
           game_ids, clip_count, quality_score, rating, rd, match_count,
           source_clip_id, clip_start_time, clip_game_start_time)
        VALUES (?, NULL, ?, 1, 5.0, 'brilliant_clip', ?, 'Reel', NULL,
                NULL, ?, '9:16', NULL, ?, ?, ?, ?, ?, 0, NULL, 12.0, 30.0)
        """,
        (
            fid, f"reel_{fid}.mp4", game_id,
            "2026-01-01 00:00:00" if published else None,
            encode_data(game_ids) if game_ids is not None else None,
            clip_count, quality_score, rating, rd,
        ),
    )
    c.commit()
    c.close()
    return fid


def _refs(base, pid):
    c = _conn(base, pid)
    rows = c.execute(
        "SELECT id, source_profile_id, source_game_id FROM games "
        "WHERE source_profile_id IS NOT NULL ORDER BY id"
    ).fetchall()
    c.close()
    return rows


def _real_game_ids(base, pid):
    c = _conn(base, pid)
    ids = [r[0] for r in c.execute(
        "SELECT id FROM games WHERE source_profile_id IS NULL ORDER BY id"
    ).fetchall()]
    c.close()
    return ids


def _reel(base, pid, fid):
    """Look up a reel by its CARRIED filename (`reel_{fid}.mp4`) -- a move gives the
    target row a NEW autoincrement id, but filename is a stable per-user hash."""
    c = _conn(base, pid)
    row = c.execute(
        "SELECT * FROM final_videos WHERE filename = ?", (f"reel_{fid}.mp4",)
    ).fetchone()
    c.close()
    return row


async def _move(video_ids, source, target):
    from app.profile_context import set_current_profile_id
    from app.routers.downloads import MoveToProfileRequest, move_reels_to_profile
    set_current_profile_id(source)
    return await move_reels_to_profile(
        MoveToProfileRequest(video_ids=video_ids, target_profile_id=target),
        _durable=None,
    )


async def _delete(download_id, profile):
    from app.profile_context import set_current_profile_id
    from app.routers.downloads import delete_download
    set_current_profile_id(profile)
    return await delete_download(download_id, remove_file=False, _durable=None)


# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_single_move_groups_under_reference(env):
    _insert_real_game(env, A, 10)
    fid = _insert_reel(env, A, game_ids=[10], game_id=10)

    await _move([fid], A, B)

    refs = _refs(env, B)
    assert len(refs) == 1
    assert refs[0]["source_profile_id"] == A
    assert refs[0]["source_game_id"] == 10

    moved = _reel(env, B, fid)
    # game_ids remaps to the reference -> single-clip reel routes to a game group.
    routed = route_collection(moved["game_ids"], moved["clip_count"])
    assert routed == refs[0]["id"]
    assert moved["game_id"] == refs[0]["id"]


@pytest.mark.asyncio
async def test_second_reel_same_game_reuses_one_reference(env):
    _insert_real_game(env, A, 10)
    r1 = _insert_reel(env, A, game_ids=[10], game_id=10)
    r2 = _insert_reel(env, A, game_ids=[10], game_id=10)

    await _move([r1], A, B)
    await _move([r2], A, B)

    refs = _refs(env, B)
    assert len(refs) == 1  # both reels share the ONE reference


@pytest.mark.asyncio
async def test_same_game_into_two_profiles_one_reference_each(env):
    _insert_real_game(env, A, 10)
    r1 = _insert_reel(env, A, game_ids=[10], game_id=10)
    r2 = _insert_reel(env, A, game_ids=[10], game_id=10)

    await _move([r1], A, B)
    await _move([r2], A, C)

    assert len(_refs(env, B)) == 1
    assert len(_refs(env, C)) == 1


@pytest.mark.asyncio
async def test_move_back_to_owner_points_at_real_game_no_reference(env):
    _insert_real_game(env, A, 10)
    fid = _insert_reel(env, A, game_ids=[10], game_id=10)

    await _move([fid], A, B)
    assert len(_refs(env, B)) == 1

    # Move it BACK to the owning profile A (target row has a new id -> resolve it).
    b_id = _reel(env, B, fid)["id"]
    await _move([b_id], B, A)

    # A gets NO reference; the reel points at A's REAL game 10.
    assert _refs(env, A) == []
    moved_back = _reel(env, A, fid)
    assert route_collection(moved_back["game_ids"], moved_back["clip_count"]) == 10
    assert moved_back["game_id"] == 10
    # B's now-unreferenced reference was cleaned up.
    assert _refs(env, B) == []


@pytest.mark.asyncio
async def test_chain_collapse_bc_points_at_original_owner(env):
    _insert_real_game(env, A, 10)
    fid = _insert_reel(env, A, game_ids=[10], game_id=10)

    await _move([fid], A, B)      # B gets a reference to (A, 10)
    b_id = _reel(env, B, fid)["id"]
    await _move([b_id], B, C)     # B's reference is the source now

    refs_c = _refs(env, C)
    assert len(refs_c) == 1
    # Points at the ORIGINAL owner A / game 10, NOT the intermediate profile B.
    assert refs_c[0]["source_profile_id"] == A
    assert refs_c[0]["source_game_id"] == 10
    # B's reference was orphaned by the move-away and cleaned up.
    assert _refs(env, B) == []


@pytest.mark.asyncio
async def test_delete_last_reel_cleans_reference_keeps_real_games(env):
    _insert_real_game(env, A, 10)
    fid = _insert_reel(env, A, game_ids=[10], game_id=10)
    await _move([fid], A, B)

    # B also has a locally-real game + reel that must NEVER be touched by cleanup.
    _insert_real_game(env, B, 77, blake3="hashLocal")
    local_reel = _insert_reel(env, B, game_ids=[77], game_id=77)

    assert len(_refs(env, B)) == 1

    # Delete the moved reel -> its reference is orphaned and cleaned up.
    b_id = _reel(env, B, fid)["id"]
    await _delete(b_id, B)

    assert _refs(env, B) == []          # reference gone
    assert 77 in _real_game_ids(env, B)  # real game untouched
    assert _reel(env, B, local_reel) is not None


@pytest.mark.asyncio
async def test_missing_source_game_dropped_with_warning(env, caplog):
    import logging
    # A reel attributing to a game id that does NOT exist in the source (deleted
    # after publish). No real game 999 row is inserted.
    fid = _insert_reel(env, A, game_ids=[999], game_id=999)

    with caplog.at_level(logging.WARNING):
        await _move([fid], A, B)

    # No crash, no reference built, attribution dropped -> routes to Mixes.
    assert _refs(env, B) == []
    moved = _reel(env, B, fid)
    assert moved["game_ids"] is None
    assert moved["game_id"] is None
    assert any("source game 999 missing" in r.message for r in caplog.records)
