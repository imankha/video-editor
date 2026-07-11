"""
T4850: Transfer (MOVE) published reels between sibling profiles of the same user.

Covers the backend endpoint POST /api/downloads/move-to-profile:
- single move round-trip (row leaves source, appears in target, media filename kept)
- batch move: EVERY moved reel stays independently visible in the target
  (latest_final_videos_subquery lineage-less partition fix)
- rank reset (single-clip re-seed, multi-clip stays unranked, match_count -> 0,
  watched_at -> NULL)
- collection auto-remove: game_id/game_ids cleared -> source summary drops it,
  target routes to Mixes (no phantom "Game N")
- target-profile validation (unknown -> 404, same profile -> 400)
- all-or-nothing: an unpublished/draft or unknown id rejects the whole batch (400)
- durable-sync failure (FORCE_R2_SYNC_FAILURE) -> 503, nothing moved either side
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.queries import latest_final_videos_subquery
from app.services.glicko import RD_MAX, seed_rating
from app.utils.encoding import encode_data

USER_ID = "test-user-t4850"
SRC = "srcprof01"
DST = "dstprof02"


@pytest.fixture()
def env(tmp_path):
    """Two schema-current profile DBs for one user under a temp USER_DATA_BASE."""
    from app.user_context import set_current_user_id, set_current_req_id
    from app.profile_context import set_current_profile_id
    from app.services import user_db as user_db_mod

    set_current_user_id(USER_ID)
    set_current_req_id("req-t4850")

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        from app.database import ensure_database

        # Register both profiles in user.sqlite.
        user_db_mod.create_profile(USER_ID, SRC, "Athlete A", "#f00", is_default=True)
        user_db_mod.create_profile(USER_ID, DST, "Athlete B", "#00f")

        # Materialize both profile DBs (schema).
        for pid in (SRC, DST):
            set_current_profile_id(pid)
            ensure_database()

        set_current_profile_id(SRC)
        yield tmp_path


def _profile_db_path(base, pid):
    return base / USER_ID / "profiles" / pid / "profile.sqlite"


def _conn(base, pid):
    c = sqlite3.connect(str(_profile_db_path(base, pid)))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


_fid = [7000]


def _insert_reel(base, pid, *, project_id=None, game_id=None, game_ids=None,
                 clip_count=1, quality_score=5.0, rating=None, rd=None,
                 match_count=3, source_clip_id=None, published=True,
                 watched=True, name="Great Goal", aspect_ratio="9:16",
                 source_type="brilliant_clip"):
    """Insert a final_videos row into a profile DB; returns its id."""
    _fid[0] += 1
    fid = _fid[0]
    if rating is None and clip_count == 1:
        rating = seed_rating(quality_score) + 50  # a "played" rating, not the seed
        rd = 120.0
    c = _conn(base, pid)
    if project_id is not None:
        c.execute(
            "INSERT OR IGNORE INTO projects (id, name, aspect_ratio) VALUES (?, ?, ?)",
            (project_id, f"P{project_id}", aspect_ratio),
        )
    if game_id is not None:
        c.execute(
            "INSERT OR IGNORE INTO games (id, name) VALUES (?, ?)",
            (game_id, f"Game {game_id}"),
        )
    c.execute(
        """
        INSERT INTO final_videos
          (id, project_id, filename, version, duration, source_type, game_id,
           name, rating_counts, watched_at, published_at, aspect_ratio, tags,
           game_ids, clip_count, quality_score, rating, rd, match_count,
           source_clip_id, clip_start_time, clip_game_start_time)
        VALUES (?, ?, ?, 1, 5.0, ?, ?, ?, NULL,
                ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 12.0, 30.0)
        """,
        (
            fid, project_id, f"reel_{fid}.mp4", source_type, game_id, name,
            "2026-01-01 00:00:00" if watched else None,
            "2026-01-01 00:00:00" if published else None,
            aspect_ratio,
            encode_data(game_ids) if game_ids is not None else None,
            clip_count, quality_score, rating, rd, match_count,
            source_clip_id,
        ),
    )
    c.commit()
    c.close()
    return fid


async def _move(video_ids, target_profile_id=DST):
    from app.routers.downloads import move_reels_to_profile, MoveToProfileRequest
    return await move_reels_to_profile(
        MoveToProfileRequest(video_ids=video_ids, target_profile_id=target_profile_id),
        _durable=None,
    )


def _rows(base, pid):
    c = _conn(base, pid)
    rows = c.execute(
        f"SELECT * FROM final_videos WHERE id IN ({latest_final_videos_subquery()}) "
        f"AND published_at IS NOT NULL"
    ).fetchall()
    c.close()
    return rows


# --------------------------------------------------------------------------- #
# Happy path
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_single_move_round_trip(env):
    fid = _insert_reel(env, SRC, project_id=101, game_id=5,
                       game_ids=[5], source_clip_id=55)

    res = await _move([fid])
    assert res["success"] is True
    assert res["moved_ids"] == [fid]

    # Gone from source.
    assert _rows(env, SRC) == []
    # Present in target, same media filename (per-user R2 object, not copied).
    dst = _rows(env, DST)
    assert len(dst) == 1
    assert dst[0]["filename"] == f"reel_{fid}.mp4"
    assert dst[0]["name"] == "Great Goal"


@pytest.mark.asyncio
async def test_batch_move_all_visible_in_target(env):
    # Three lineage-less-once-moved reels must each stay visible in the target,
    # proving the (project_id NULL AND game_id NULL) partition tiebreaker.
    ids = [
        _insert_reel(env, SRC, project_id=201, game_ids=[9]),
        _insert_reel(env, SRC, project_id=202, game_ids=[9]),
        _insert_reel(env, SRC, project_id=203, game_ids=[9]),
    ]
    await _move(ids)

    assert _rows(env, SRC) == []
    dst = _rows(env, DST)
    assert len(dst) == 3  # NOT collapsed to 1 by MAX(version) on the (0,0) bucket
    for r in dst:
        assert r["project_id"] is None
        assert r["game_id"] is None
        assert r["game_ids"] is None
        assert r["source_clip_id"] is None


# --------------------------------------------------------------------------- #
# Decision 4: rank reset + collection auto-remove
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_single_clip_reel_reseeds_and_resets(env):
    fid = _insert_reel(env, SRC, project_id=301, quality_score=5.0,
                       game_ids=[3], match_count=7, watched=True)
    await _move([fid])

    dst = _rows(env, DST)[0]
    assert dst["rating"] == pytest.approx(seed_rating(5.0))  # re-seeded, history dropped
    assert dst["rd"] == pytest.approx(RD_MAX)
    assert dst["match_count"] == 0
    assert dst["watched_at"] is None  # shows as NEW in target


@pytest.mark.asyncio
async def test_multi_clip_reel_stays_unranked(env):
    # Multi-clip reels never rank: rating/rd NULL must be preserved (not seeded).
    fid = _insert_reel(env, SRC, project_id=401, clip_count=3,
                       quality_score=None, rating=None, rd=None, match_count=0)
    await _move([fid])

    dst = _rows(env, DST)[0]
    assert dst["rating"] is None
    assert dst["rd"] is None
    assert dst["match_count"] == 0


@pytest.mark.asyncio
async def test_collection_attribution_cleared(env):
    from app.services.collection_metadata import route_collection
    fid = _insert_reel(env, SRC, project_id=501, game_id=42, game_ids=[42])
    await _move([fid])

    dst = _rows(env, DST)[0]
    # No dangling source game ref -> routes to Mixes (None), not a phantom "Game 42".
    assert route_collection(dst["game_ids"], dst["clip_count"]) is None


# --------------------------------------------------------------------------- #
# Validation / all-or-nothing
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_unknown_target_profile_404(env):
    from fastapi import HTTPException
    fid = _insert_reel(env, SRC, project_id=601)
    with pytest.raises(HTTPException) as ei:
        await _move([fid], target_profile_id="nope")
    assert ei.value.status_code == 404
    assert len(_rows(env, SRC)) == 1  # untouched


@pytest.mark.asyncio
async def test_same_profile_rejected_400(env):
    from fastapi import HTTPException
    fid = _insert_reel(env, SRC, project_id=602)
    with pytest.raises(HTTPException) as ei:
        await _move([fid], target_profile_id=SRC)
    assert ei.value.status_code == 400
    assert len(_rows(env, SRC)) == 1


@pytest.mark.asyncio
async def test_draft_in_batch_rejects_whole_batch(env):
    from fastapi import HTTPException
    ok = _insert_reel(env, SRC, project_id=701)
    draft = _insert_reel(env, SRC, project_id=702, published=False)
    with pytest.raises(HTTPException) as ei:
        await _move([ok, draft])
    assert ei.value.status_code == 400
    assert ei.value.detail["not_published"] == [draft]
    # Nothing moved: published reel still in source, nothing in target.
    assert len(_rows(env, SRC)) == 1
    assert _rows(env, DST) == []


@pytest.mark.asyncio
async def test_unknown_id_in_batch_rejects_whole_batch(env):
    from fastapi import HTTPException
    ok = _insert_reel(env, SRC, project_id=801)
    with pytest.raises(HTTPException) as ei:
        await _move([ok, 999999])
    assert ei.value.status_code == 400
    assert ei.value.detail["not_found"] == [999999]
    assert len(_rows(env, SRC)) == 1
    assert _rows(env, DST) == []


# --------------------------------------------------------------------------- #
# Durability failure
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_target_sync_failure_503_nothing_moved(env):
    from fastapi import HTTPException
    fid = _insert_reel(env, SRC, project_id=901, game_ids=[1])

    # Force the target-profile R2 sync to fail -> the whole move must abort with a
    # retryable 503, leaving the source intact and the target rollback complete.
    with patch("app.storage._force_r2_sync_failure", return_value=True):
        with pytest.raises(HTTPException) as ei:
            await _move([fid])
    assert ei.value.status_code == 503
    assert ei.value.detail["code"] == "sync_failed"

    assert len(_rows(env, SRC)) == 1          # source untouched
    assert _rows(env, DST) == []              # target rolled back
