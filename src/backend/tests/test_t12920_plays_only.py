"""T12920: plays-only game state ("Keep only marked plays") -- keep/restore endpoints,
list/load fields, clip-write guard, sweep pin.

Runs the real handlers against a real head-schema profile DB (ensure_database), with
only R2 / the heavy preservation job patched.
"""
import asyncio
import shutil
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.database import USER_DATA_BASE, ensure_database, get_db_connection
from app.profile_context import set_current_profile_id
from app.routers import games as games_router
from app.routers.clips import RawClipCreate, RawClipUpdate, save_raw_clip, update_raw_clip
from app.user_context import set_current_user_id

PROFILE_ID = "testdefault"


@pytest.fixture
def db():
    user_id = f"test_t12920_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id(PROFILE_ID)
    ensure_database()
    yield user_id
    shutil.rmtree(USER_DATA_BASE / user_id, ignore_errors=True)


def _add_game(*, status="ready", expires_in_days=10, clips=2, source_profile_id=None,
              auto_export_status=None, blake3="hash1"):
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, blake3_hash, status, auto_export_status, source_profile_id) "
            "VALUES ('G', ?, ?, ?, ?)",
            (blake3, status, auto_export_status, source_profile_id),
        )
        gid = cur.lastrowid
        if expires_in_days is not None:
            exp = (datetime.utcnow() + timedelta(days=expires_in_days)).isoformat()
            cur.execute(
                "INSERT OR REPLACE INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, 1, ?)",
                (blake3, exp),
            )
        for i in range(clips):
            cur.execute(
                "INSERT INTO raw_clips (filename, rating, game_id, video_sequence, start_time, end_time) "
                "VALUES (?, ?, ?, 1, ?, ?)",
                (f"c{i}.mp4", None if i else 5, gid, float(i), float(i) + 5),
            )
        conn.commit()
    return gid


def _row(gid):
    with get_db_connection() as conn:
        return conn.execute("SELECT * FROM games WHERE id = ?", (gid,)).fetchone()


def _keep(gid):
    bt = BackgroundTasks()
    out = asyncio.run(games_router.keep_only_plays(gid, bt))
    return out, bt


def _code(exc: HTTPException):
    return exc.detail["code"]


def test_keep_sets_flag_and_schedules_preservation(db):
    gid = _add_game()
    out, bt = _keep(gid)
    assert out == {"plays_only": True, "preservation": "pending"}
    assert _row(gid)["plays_only_at"] is not None
    assert [t.func for t in bt.tasks] == [games_router.auto_export_game]
    assert bt.tasks[0].args[-1] == gid


def test_keep_on_already_complete_game_schedules_nothing(db):
    gid = _add_game(auto_export_status="complete")
    out, bt = _keep(gid)
    assert out == {"plays_only": True, "preservation": "complete"}
    assert bt.tasks == []


@pytest.mark.parametrize("kwargs,code", [
    ({"clips": 0}, "no_plays"),
    ({"status": "pending"}, "not_ready"),
    ({"source_profile_id": "other"}, "reference_game"),
    ({"expires_in_days": -1}, "source_expired"),
])
def test_keep_preconditions_409(db, kwargs, code):
    gid = _add_game(**kwargs)
    with pytest.raises(HTTPException) as e:
        _keep(gid)
    assert e.value.status_code == 409 and _code(e.value) == code
    assert _row(gid)["plays_only_at"] is None


def test_restore_clears_flag_deletes_recaps_resets_status_keeps_extracts(db):
    gid = _add_game(auto_export_status="complete")
    with get_db_connection() as conn:
        conn.execute("UPDATE games SET plays_only_at = CURRENT_TIMESTAMP, auto_export_attempts = 2, "
                     "recap_video_url = 'recaps/1.mp4' WHERE id = ?", (gid,))
        conn.commit()
    deleted = []
    with patch.object(games_router, "delete_from_r2", side_effect=lambda u, k: deleted.append(k) or True):
        out = asyncio.run(games_router.restore_full_video(gid))
    assert out == {"plays_only": False}
    row = _row(gid)
    assert row["plays_only_at"] is None
    assert row["auto_export_status"] is None and row["auto_export_attempts"] == 0
    assert row["recap_video_url"] is None
    assert sorted(deleted) == sorted([
        f"recaps/{gid}.mp4", f"recaps/{gid}_clips.json",
        f"recaps/{gid}_team.mp4", f"recaps/{gid}_team_clips.json",
    ])
    with get_db_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM raw_clips WHERE game_id = ?", (gid,)).fetchone()[0] == 2


def test_restore_refused_after_expiry(db):
    gid = _add_game(expires_in_days=-1, auto_export_status="complete")
    with get_db_connection() as conn:
        conn.execute("UPDATE games SET plays_only_at = CURRENT_TIMESTAMP WHERE id = ?", (gid,))
        conn.commit()
    with pytest.raises(HTTPException) as e:
        asyncio.run(games_router.restore_full_video(gid))
    assert e.value.status_code == 409 and _code(e.value) == "source_expired"
    assert _row(gid)["plays_only_at"] is not None


def test_restore_delete_failure_is_loud_and_keeps_state(db):
    gid = _add_game(auto_export_status="complete")
    with get_db_connection() as conn:
        conn.execute("UPDATE games SET plays_only_at = CURRENT_TIMESTAMP WHERE id = ?", (gid,))
        conn.commit()
    with patch.object(games_router, "delete_from_r2", return_value=False), pytest.raises(HTTPException) as e:
        asyncio.run(games_router.restore_full_video(gid))
    assert e.value.status_code == 503
    row = _row(gid)
    assert row["plays_only_at"] is not None and row["auto_export_status"] == "complete"


def test_load_game_exposes_plays_only_and_preservation(db):
    gid = _add_game(auto_export_status="complete")
    with get_db_connection() as conn:
        conn.execute("UPDATE games SET plays_only_at = CURRENT_TIMESTAMP WHERE id = ?", (gid,))
        conn.commit()
    game = asyncio.run(games_router.load_game(gid))["game"]
    assert game["plays_only"] is True
    assert game["preservation_status"] == "complete"


def test_list_games_exposes_plays_only_and_preservation(db):
    gid = _add_game(auto_export_status="pending")
    with get_db_connection() as conn:
        conn.execute("UPDATE games SET plays_only_at = CURRENT_TIMESTAMP WHERE id = ?", (gid,))
        conn.commit()
    other = _add_game(blake3="hash2")
    with patch.object(games_router, "get_grace_deletion_hashes", return_value=set()):
        games = asyncio.run(games_router._list_games_impl(skip_presigned_urls=True))["games"]
    by_id = {g["id"]: g for g in games}
    assert by_id[gid]["plays_only"] is True and by_id[gid]["preservation_status"] == "pending"
    assert by_id[other]["plays_only"] is False and by_id[other]["preservation_status"] is None


def _flag(gid):
    with get_db_connection() as conn:
        conn.execute("UPDATE games SET plays_only_at = CURRENT_TIMESTAMP WHERE id = ?", (gid,))
        conn.commit()


def test_clip_create_refused_on_plays_only_game(db):
    gid = _add_game()
    _flag(gid)
    with pytest.raises(HTTPException) as e:
        asyncio.run(save_raw_clip(
            RawClipCreate(game_id=gid, start_time=30, end_time=35, video_sequence=1),
            BackgroundTasks(), None, None))
    assert e.value.status_code == 409 and _code(e.value) == "plays_only"


def test_clip_edit_refused_but_highlight_creation_allowed(db):
    gid = _add_game()
    _flag(gid)
    with get_db_connection() as conn:
        cid = conn.execute("SELECT id FROM raw_clips WHERE game_id = ? LIMIT 1", (gid,)).fetchone()[0]
    with pytest.raises(HTTPException) as e:
        asyncio.run(update_raw_clip(cid, RawClipUpdate(rating=3), BackgroundTasks(), None, None))
    assert e.value.status_code == 409 and _code(e.value) == "plays_only"
    # Watch plays "Create clip" is PUT {create_project:true}: must NOT be refused.
    try:
        asyncio.run(update_raw_clip(cid, RawClipUpdate(create_project=True), BackgroundTasks(), None, None))
    except HTTPException as ex:
        assert ex.detail != {"code": "plays_only"} and not (isinstance(ex.detail, dict) and ex.detail.get("code") == "plays_only")


def test_sweep_settles_a_complete_plays_only_game_like_any_other(db):
    """Sweep pin: a plays-only game kept via T12920 is 'complete', so at expiry the
    sweep's export step is a no-op and the reclaim verdict is RECLAIM -- the flag is
    invisible to the sweep."""
    from app.services import sweep_scheduler
    from app.services.auto_export import ArtifactVerdict, auto_export_game

    gid = _add_game(auto_export_status="complete", expires_in_days=-1)
    _flag(gid)
    user_id = db
    assert auto_export_game(user_id, PROFILE_ID, gid) == "complete"
    with patch.object(sweep_scheduler, "recap_artifacts_present", return_value=ArtifactVerdict.PRESENT), \
         patch.object(sweep_scheduler, "_has_live_sibling_hash", return_value=False):
        verdict = sweep_scheduler._reclaim_verdict(user_id, PROFILE_ID, "hash1", {"hash1"}, ["complete"])
    assert verdict == sweep_scheduler.ReclaimVerdict.RECLAIM
