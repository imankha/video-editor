"""bug26p: v017 migration backfills game_storage refs for ready games missing them.

Repairs rows already in the bad state (status='ready' with no game_storage row,
e.g. games 8/9/10), via the production insert_game_storage_ref path so Postgres
game_ref_counts is incremented too. Idempotent + safe to re-run.
"""

import sqlite3
import pytest
from unittest.mock import patch

from app.migrations.profile_db.v017_backfill_missing_storage_refs import (
    V017BackfillMissingStorageRefs,
)

USER_ID = "test-user-v017"
PROFILE_ID = "testdefault"


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


def _seed(db_path, *, status, h, with_video=True, legacy_only=False, size=1000):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (name, status, blake3_hash, video_size) VALUES ('G', ?, ?, ?)",
        (status, h, size),
    )
    gid = cur.lastrowid
    if with_video and not legacy_only:
        cur.execute(
            """INSERT INTO game_videos (game_id, blake3_hash, sequence, video_size)
               VALUES (?, ?, 1, ?)""",
            (gid, h, size),
        )
    conn.commit()
    conn.close()
    return gid


def _refs(db_path):
    conn = _connect(db_path)
    rows = {r["blake3_hash"] for r in conn.execute("SELECT blake3_hash FROM game_storage").fetchall()}
    conn.close()
    return rows


def _run_migration(db_path):
    conn = _connect(db_path)
    try:
        V017BackfillMissingStorageRefs().up(conn)
    finally:
        conn.close()


def test_backfills_ready_game_missing_ref(profile_db):
    h = "a" * 64
    _seed(profile_db, status="ready", h=h)
    assert _refs(profile_db) == set()

    _run_migration(profile_db)

    assert h in _refs(profile_db)


def test_ignores_pending_games(profile_db):
    h = "b" * 64
    _seed(profile_db, status="pending", h=h)

    _run_migration(profile_db)

    # Pending games are not yet activated; they must NOT get a ref.
    assert h not in _refs(profile_db)


def test_skips_games_that_already_have_ref(profile_db):
    h = "c" * 64
    _seed(profile_db, status="ready", h=h)
    # Pre-existing ref.
    conn = _connect(profile_db)
    conn.execute(
        "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, 1000, '2099-01-01')",
        (h,),
    )
    conn.commit()
    conn.close()

    real_insert = __import__(
        "app.services.auth_db", fromlist=["insert_game_storage_ref"]
    ).insert_game_storage_ref
    calls = []

    def spy(*a, **k):
        calls.append(a)
        return real_insert(*a, **k)

    with patch("app.services.auth_db.insert_game_storage_ref", spy):
        _run_migration(profile_db)

    # Nothing to backfill -> insert path not invoked.
    assert calls == []


def test_backfills_legacy_single_video_game(profile_db):
    """Old games with games.blake3_hash but no game_videos row are covered too."""
    h = "d" * 64
    _seed(profile_db, status="ready", h=h, legacy_only=True)

    _run_migration(profile_db)

    assert h in _refs(profile_db)


def test_idempotent_rerun(profile_db):
    h = "e" * 64
    _seed(profile_db, status="ready", h=h)

    _run_migration(profile_db)
    _run_migration(profile_db)  # second run must be a clean no-op

    conn = _connect(profile_db)
    count = conn.execute(
        "SELECT COUNT(*) c FROM game_storage WHERE blake3_hash = ?", (h,)
    ).fetchone()["c"]
    conn.close()
    assert count == 1  # exactly one ref, no duplicate


def test_guard_missing_tables_is_noop():
    """A bare DB without the game tables must not raise."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    # No games/game_videos/game_storage tables.
    V017BackfillMissingStorageRefs().up(conn)  # must simply return
    conn.close()
