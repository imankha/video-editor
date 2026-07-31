"""
T5800: game-reference primitive (`ensure_game_reference`) + `list_games` exposure.

The primitive materializes a metadata-only game REFERENCE (games row with
source_profile_id NOT NULL) in a target profile so a moved reel keeps its by-game
grouping WITHOUT the target owning the game media. Covers the 4-step resolution
order (dedup / chain-collapse / hash-dedup / insert) and that `GET /api/games`
marks references and never emits expiry state for them.
"""

import sqlite3
import uuid
from unittest.mock import patch

import pytest

from app.services.materialization import ensure_game_reference

USER_ID = "test-user-t5800"
VIEWER = "viewerprof1"   # profile that receives references
OWNER = "ownerprof01"    # profile that owns the real game


@pytest.fixture()
def env(tmp_path):
    """A schema-current (head, incl. v030) profile DB for the VIEWER profile under a
    temp USER_DATA_BASE, with both profiles registered in user.sqlite."""
    from app.profile_context import set_current_profile_id
    from app.services import user_db as user_db_mod
    from app.user_context import set_current_req_id, set_current_user_id

    set_current_user_id(USER_ID)
    set_current_req_id("req-t5800")

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        from app.database import ensure_database

        user_db_mod.create_profile(USER_ID, OWNER, "Owner Athlete", "#f00", is_default=True)
        user_db_mod.create_profile(USER_ID, VIEWER, "Viewer Athlete", "#00f")

        set_current_profile_id(VIEWER)
        ensure_database()

        yield tmp_path


def _viewer_conn(base):
    path = base / USER_ID / "profiles" / VIEWER / "profile.sqlite"
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    return c


def _src_game(**overrides):
    """A source `games` row (dict) as loaded from the owning profile DB. Indexable by
    column name exactly like a sqlite3.Row, which is all the primitive needs."""
    row = {
        "id": 501,
        "name": "Championship Final",
        "opponent_name": "Rivals",
        "game_date": "2026-05-01",
        "game_type": "match",
        "tournament_name": "Spring Cup",
        "blake3_hash": "hash_owner_501",
        "video_duration": 3600.0,
        "video_width": 1920,
        "video_height": 1080,
        "video_size": 123456,
        "video_fps": 30.0,
        "created_at": "2026-05-01 10:00:00",
        "source_profile_id": None,   # a REAL source game by default
        "source_game_id": None,
    }
    row.update(overrides)
    return row


def _ref_rows(conn):
    return conn.execute(
        "SELECT id, source_profile_id, source_game_id, name, blake3_hash, "
        "video_filename, status, viewed_duration, recap_video_url "
        "FROM games WHERE source_profile_id IS NOT NULL"
    ).fetchall()


# --------------------------------------------------------------------------- #
# Step 4: insert a fresh reference
# --------------------------------------------------------------------------- #

def test_inserts_reference_with_frozen_metadata(env):
    conn = _viewer_conn(env)
    videos = [{"blake3_hash": "hash_owner_501", "sequence": 0, "duration": 3600.0,
               "video_width": 1920, "video_height": 1080, "video_size": 123456, "fps": 30.0}]
    src = _src_game()

    gid = ensure_game_reference(conn, VIEWER, OWNER, src, videos)
    conn.commit()

    ref = conn.execute("SELECT * FROM games WHERE id = ?", (gid,)).fetchone()
    assert ref["source_profile_id"] == OWNER
    assert ref["source_game_id"] == 501
    assert ref["name"] == "Championship Final"
    assert ref["blake3_hash"] == "hash_owner_501"
    assert ref["created_at"] == "2026-05-01 10:00:00"   # frozen from source
    # Set explicitly per the column mapping.
    assert ref["video_filename"] is None
    assert ref["status"] == "ready"
    assert ref["viewed_duration"] == 0
    assert ref["recap_video_url"] is None
    assert ref["auto_export_attempts"] == 0
    # game_videos copied (needed for hash dedup + effective-duration display).
    gv = conn.execute("SELECT * FROM game_videos WHERE game_id = ?", (gid,)).fetchall()
    assert len(gv) == 1
    assert gv[0]["blake3_hash"] == "hash_owner_501"
    conn.close()


def test_never_touches_game_storage(env):
    conn = _viewer_conn(env)
    src = _src_game()
    ensure_game_reference(conn, VIEWER, OWNER, src, [])
    conn.commit()
    # A reference has NO game_storage row (EPIC decision 4).
    n = conn.execute("SELECT COUNT(*) FROM game_storage").fetchone()[0]
    assert n == 0
    conn.close()


# --------------------------------------------------------------------------- #
# Step 1: idempotent dedup on (source_profile_id, source_game_id)
# --------------------------------------------------------------------------- #

def test_idempotent_on_repeat(env):
    conn = _viewer_conn(env)
    videos = [{"blake3_hash": "hash_owner_501", "sequence": 0, "duration": 3600.0,
               "video_width": 1920, "video_height": 1080, "video_size": 1, "fps": 30.0}]
    src = _src_game()

    gid1 = ensure_game_reference(conn, VIEWER, OWNER, src, videos)
    conn.commit()
    gid2 = ensure_game_reference(conn, VIEWER, OWNER, src, videos)
    conn.commit()

    assert gid1 == gid2
    assert len(_ref_rows(conn)) == 1  # exactly one reference row
    conn.close()


# --------------------------------------------------------------------------- #
# Step 2: chain collapse -- a reference source resolves to the ORIGINAL owner
# --------------------------------------------------------------------------- #

def test_chain_collapse_points_at_original_owner(env):
    conn = _viewer_conn(env)
    # The source row is ITSELF a reference living in some intermediate profile B,
    # pointing back at the original owner A (OWNER / game 501).
    src_is_ref = _src_game(
        id=999,                       # the reference's own id in profile B
        source_profile_id=OWNER,
        source_game_id=501,
        blake3_hash="hash_owner_501",
    )
    gid = ensure_game_reference(conn, VIEWER, "profileB", src_is_ref, [])
    conn.commit()

    ref = conn.execute("SELECT * FROM games WHERE id = ?", (gid,)).fetchone()
    # Points at the ORIGINAL owner, NOT the intermediate profile B / its id 999.
    assert ref["source_profile_id"] == OWNER
    assert ref["source_game_id"] == 501

    # And a DIRECT reference to (OWNER, 501) now dedups onto the same row
    # (references never chain -> both collapse to one).
    direct = _src_game(id=501, blake3_hash="hash_owner_501")
    gid2 = ensure_game_reference(conn, VIEWER, OWNER, direct, [])
    conn.commit()
    assert gid2 == gid
    assert len(_ref_rows(conn)) == 1
    conn.close()


# --------------------------------------------------------------------------- #
# Step 3: hash-dedup reuses a REAL local game, inserts NO reference
# --------------------------------------------------------------------------- #

def test_hash_dedup_reuses_real_local_game(env):
    conn = _viewer_conn(env)
    # A REAL game (share-materialized earlier) already in the viewer profile,
    # same blake3_hash as the source.
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (name, blake3_hash, status) VALUES ('Shared Copy', 'hash_owner_501', 'ready')"
    )
    real_id = cur.lastrowid
    conn.commit()

    src = _src_game(blake3_hash="hash_owner_501")
    gid = ensure_game_reference(conn, VIEWER, OWNER, src, [])
    conn.commit()

    assert gid == real_id            # reuses the real game
    assert _ref_rows(conn) == []     # NO reference inserted
    conn.close()


# --------------------------------------------------------------------------- #
# list_games marks references and never emits expiry state for them
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_list_games_marks_references_and_skips_expiry(env):
    from app.profile_context import set_current_profile_id
    from app.routers.games import list_games
    set_current_profile_id(VIEWER)

    conn = _viewer_conn(env)
    cur = conn.cursor()
    # A REAL game with an active storage row (would carry expiry).
    cur.execute(
        "INSERT INTO games (name, blake3_hash, status, opponent_name, game_date, game_type) "
        "VALUES ('Real', 'hash_real', 'ready', 'Foe', '2026-04-01', 'match')"
    )
    real_id = cur.lastrowid
    cur.execute(
        "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) "
        "VALUES ('hash_real', 123, ?)",
        ("2999-01-01T00:00:00+00:00",),
    )
    conn.commit()
    conn.close()

    # A reference to OWNER's game 501.
    conn = _viewer_conn(env)
    ensure_game_reference(conn, VIEWER, OWNER, _src_game(), [])
    conn.commit()
    conn.close()

    with patch("app.routers.games.get_grace_deletion_hashes", return_value=set()):
        resp = await list_games()

    games = {g["id"]: g for g in resp["games"] if g["id"] == real_id or g["is_reference"]}
    real = games[real_id]
    assert real["is_reference"] is False
    assert real["storage_expires_at"] == "2999-01-01T00:00:00+00:00"

    refs = [g for g in resp["games"] if g["is_reference"]]
    assert len(refs) == 1
    ref = refs[0]
    assert ref["source_profile_id"] == OWNER
    assert ref["source_profile_name"] == "Owner Athlete"   # resolved from user.sqlite
    # NEVER any expiry state on a reference (EPIC decision 4).
    assert ref["storage_expires_at"] is None
    assert ref["storage_status"] is None
    assert ref["can_extend"] is False
