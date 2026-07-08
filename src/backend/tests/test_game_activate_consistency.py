"""bug26p: activate_game must never leave a game ready-without-storage-ref.

Before this fix, insert_game_storage_ref ran AFTER the status->ready commit and
outside the transaction. A crash between the commit and the ref inserts produced
games at status='ready' with no game_storage row (games 8/9/10). The fix writes
storage refs BEFORE flipping status, and the idempotent early-return self-heals
any pre-existing ready-without-ref game.

These tests use a real profile DB (ensure_database) and stub the externalities
(R2 validation, credit deduction). Postgres writes inside insert_game_storage_ref
are no-ops under the conftest get_pg stub.
"""

import sqlite3
import pytest
from unittest.mock import patch

USER_ID = "test-user-bug26p"
PROFILE_ID = "testdefault"
HASH = "a" * 64


@pytest.fixture()
def profile_db(tmp_path):
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

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


def _seed_game(db_path, status, with_video=True, with_ref=False):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (name, status, blake3_hash) VALUES ('G', ?, ?)",
        (status, HASH),
    )
    game_id = cur.lastrowid
    if with_video:
        cur.execute(
            """INSERT INTO game_videos
               (game_id, blake3_hash, sequence, duration, video_width, video_height, video_size, fps)
               VALUES (?, ?, 1, 10.0, 1920, 1080, 12345, 30.0)""",
            (game_id, HASH),
        )
    if with_ref:
        cur.execute(
            "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, ?, '2099-01-01')",
            (HASH, 12345),
        )
    conn.commit()
    conn.close()
    return game_id


def _status(db_path, game_id):
    conn = _connect(db_path)
    st = conn.execute("SELECT status FROM games WHERE id = ?", (game_id,)).fetchone()["status"]
    conn.close()
    return st


def _ref_count(db_path, h=HASH):
    conn = _connect(db_path)
    n = conn.execute("SELECT COUNT(*) c FROM game_storage WHERE blake3_hash = ?", (h,)).fetchone()["c"]
    conn.close()
    return n


@pytest.mark.asyncio
async def test_refs_written_before_status_flip(profile_db):
    """Prove ordering: at the moment a storage ref is written, the game is still
    'pending'. This guarantees a failure mid-write can never yield ready-without-ref."""
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="pending")

    real_insert = games_router.insert_game_storage_ref
    status_when_ref_written = []

    def spy_insert(user_id, profile_id, h, size, expires):
        # Read committed status from an independent connection.
        status_when_ref_written.append(_status(profile_db, game_id))
        return real_insert(user_id, profile_id, h, size, expires)

    with patch.object(games_router, "_validate_video_in_r2", return_value=None), \
         patch.object(games_router, "deduct_credits", return_value={"success": True, "balance": 100}), \
         patch.object(games_router, "insert_game_storage_ref", spy_insert):
        result = await games_router.activate_game(game_id)

    assert result["status"] == "ready"
    # The ref was written while the game was still pending (before the flip).
    assert status_when_ref_written == ["pending"]
    # End state is consistent: ready AND a ref exists.
    assert _status(profile_db, game_id) == "ready"
    assert _ref_count(profile_db) == 1


@pytest.mark.asyncio
async def test_activate_failure_after_refs_leaves_pending_not_ready(profile_db):
    """If credit deduction fails, the game stays pending (never ready-without-ref).
    The storage ref may already exist (harmless / idempotent on retry)."""
    from app.routers import games as games_router
    from fastapi import HTTPException

    game_id = _seed_game(profile_db, status="pending")

    with patch.object(games_router, "_validate_video_in_r2", return_value=None), \
         patch.object(games_router, "deduct_credits",
                      return_value={"success": False, "balance": 0}):
        with pytest.raises(HTTPException) as exc:
            await games_router.activate_game(game_id)

    assert exc.value.status_code == 402
    # Status never flipped -> no ready-without-ref.
    assert _status(profile_db, game_id) == "pending"


@pytest.mark.asyncio
async def test_idempotent_early_return_self_heals_missing_ref(profile_db):
    """A game already ready but missing its storage ref is self-healed on re-activate.

    Part 2b (T4820): the heal path now checks R2 before writing a ref.  Mock R2
    to confirm the source exists so the ref write proceeds as before.
    """
    from app.routers import games as games_router
    from unittest.mock import patch, MagicMock

    game_id = _seed_game(profile_db, status="ready", with_ref=False)
    assert _ref_count(profile_db) == 0  # the bad state (games 8/9/10)

    with patch.object(games_router, "get_r2_client", return_value=MagicMock()), \
         patch.object(games_router, "r2_head_object_global",
                      return_value={"ContentLength": 12345}):
        result = await games_router.activate_game(game_id)

    assert result["status"] == "ready"
    assert _ref_count(profile_db) == 1  # healed


@pytest.mark.asyncio
async def test_idempotent_early_return_no_duplicate_ref(profile_db):
    """Re-activating a ready game that already has its ref is a clean no-op."""
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", with_ref=True)
    assert _ref_count(profile_db) == 1

    result = await games_router.activate_game(game_id)

    assert result["status"] == "ready"
    assert _ref_count(profile_db) == 1  # still exactly one, no duplicate
