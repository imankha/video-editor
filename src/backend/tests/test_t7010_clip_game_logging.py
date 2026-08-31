"""T7010 — clip-save game-attribution diagnostics.

Investigation verdict: HYPOTHESIS A (no attribution bug). `raw_clips.game_id` is
written exactly once, by `POST /clips/raw/save`, from the frontend-supplied
`RawClipCreate.game_id`; the natural key is game-scoped (`WHERE game_id = ?`) so a
save can never update a different game's row, and `update_raw_clip` reads the stored
`game_id` and never mutates it — the 503/retry/DB-heal cycle is causally incapable
of changing attribution. So there is nothing to fix; these tests instead pin the
DIAGNOSTIC logging the task asked for so a future misattribution is visible in one
log line instead of req_id DB archaeology:

1. `X-Client-Game-Id` (the frontend's active game) is logged alongside the game the
   clip row is stored under, at both save and update time, with a loud WARNING when
   the two diverge (the exact fingerprint of a stale active-game context).
2. A mid-request DB heal (`ensure_database` re-pulls a fresh profile.sqlite after a
   CAS conflict) that fires DURING a write request logs CRITICAL naming the in-flight
   endpoint whose local work is discarded/re-run — a plain cold first-access restore
   is NOT flagged.

Run with: pytest src/backend/tests/test_t7010_clip_game_logging.py -v
"""

import logging
import shutil
import sqlite3
import sys
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t7010_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

from app.session_init import _init_cache

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID}) as c:
        yield c


@pytest.fixture
def two_games(client):
    """Two distinct games so a mismatch is expressible."""
    from app.database import get_db_connection
    ids = []
    with get_db_connection() as conn:
        cursor = conn.cursor()
        for label in ("A", "B"):
            cursor.execute(
                "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
                (f"T7010 Game {label}", "hash_" + uuid.uuid4().hex[:32]),
            )
            ids.append(cursor.lastrowid)
        conn.commit()
    return ids


# ---------------------------------------------------------------------------
# 1. Save logs both game ids; matching header stays quiet, diverging header WARNs.
# ---------------------------------------------------------------------------

def test_save_logs_client_game_and_no_warning_when_matching(client, two_games, caplog):
    game_a, _ = two_games
    with caplog.at_level(logging.INFO, logger="app.routers.clips"):
        resp = client.post(
            "/api/clips/raw/save",
            headers={"X-Client-Game-Id": str(game_a)},
            json={"game_id": game_a, "start_time": 1.0, "end_time": 2.0, "rating": 3},
        )
    assert resp.status_code == 200
    save_lines = [r.message for r in caplog.records if "[ClipSave] POST" in r.message]
    assert save_lines, "save must log a [ClipSave] POST line"
    assert f"game_id(body)={game_a}" in save_lines[0]
    assert f"client_active_game={game_a}" in save_lines[0]
    # Matching header -> no mismatch warning.
    assert not [r for r in caplog.records if "GAME MISMATCH" in r.message]


def test_save_warns_on_client_game_divergence(client, two_games, caplog):
    game_a, game_b = two_games
    with caplog.at_level(logging.WARNING, logger="app.routers.clips"):
        resp = client.post(
            "/api/clips/raw/save",
            headers={"X-Client-Game-Id": str(game_b)},  # UI on B, saving under A
            json={"game_id": game_a, "start_time": 3.0, "end_time": 4.0, "rating": 3},
        )
    assert resp.status_code == 200
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and "GAME MISMATCH on save" in r.message]
    assert warnings, "a divergent active game must WARN on save"
    assert f"under game {game_a}" in warnings[0].message
    assert f"active game is {game_b}" in warnings[0].message


def test_save_without_header_omits_client_game(client, two_games, caplog):
    """No header (e.g. a non-annotate caller) -> logged as None, never a false warning."""
    game_a, _ = two_games
    with caplog.at_level(logging.INFO, logger="app.routers.clips"):
        resp = client.post(
            "/api/clips/raw/save",
            json={"game_id": game_a, "start_time": 5.0, "end_time": 6.0, "rating": 3},
        )
    assert resp.status_code == 200
    save_lines = [r.message for r in caplog.records if "[ClipSave] POST" in r.message]
    assert save_lines and "client_active_game=None" in save_lines[0]
    assert not [r for r in caplog.records if "GAME MISMATCH" in r.message]


# ---------------------------------------------------------------------------
# 2. Update logs the STORED game id vs the frontend active game; diverge -> WARN.
# ---------------------------------------------------------------------------

def test_update_logs_stored_vs_client_game_and_warns(client, two_games, caplog):
    game_a, game_b = two_games
    resp = client.post(
        "/api/clips/raw/save",
        headers={"X-Client-Game-Id": str(game_a)},
        json={"game_id": game_a, "start_time": 7.0, "end_time": 8.0, "rating": 3},
    )
    clip_id = resp.json()["raw_clip_id"]

    with caplog.at_level(logging.INFO, logger="app.routers.clips"):
        # UI has moved to game B, but this clip is stored under game A.
        resp2 = client.put(
            f"/api/clips/raw/{clip_id}",
            headers={"X-Client-Game-Id": str(game_b)},
            json={"rating": 5},
        )
    assert resp2.status_code == 200
    put_lines = [r.message for r in caplog.records if "[ClipSave] PUT" in r.message]
    assert put_lines, "update must log a [ClipSave] PUT line"
    assert f"stored game_id={game_a}" in put_lines[0]
    assert f"client_active_game={game_b}" in put_lines[0]
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and "GAME MISMATCH on update" in r.message]
    assert warnings, "editing a clip while the UI shows a different game must WARN"
    assert f"clip {clip_id}" in warnings[0].message


def test_update_no_warning_when_client_game_matches(client, two_games, caplog):
    game_a, _ = two_games
    resp = client.post(
        "/api/clips/raw/save",
        headers={"X-Client-Game-Id": str(game_a)},
        json={"game_id": game_a, "start_time": 9.0, "end_time": 10.0, "rating": 3},
    )
    clip_id = resp.json()["raw_clip_id"]
    with caplog.at_level(logging.INFO, logger="app.routers.clips"):
        resp2 = client.put(
            f"/api/clips/raw/{clip_id}",
            headers={"X-Client-Game-Id": str(game_a)},
            json={"rating": 4},
        )
    assert resp2.status_code == 200
    assert not [r for r in caplog.records if "GAME MISMATCH" in r.message]


# ---------------------------------------------------------------------------
# 3. Mid-write DB heal (post-conflict re-pull during a write) logs CRITICAL.
# ---------------------------------------------------------------------------

USER_H = "u_t7010_heal"
PROFILE_H = "beef7010"


def _write_marker_db(path, marker):
    from tests.conftest import stamp_schema_head
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE IF NOT EXISTS marker (who TEXT)")
    conn.execute("DELETE FROM marker")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    # T5083: stamp head so the JIT load-seam (now firing on every
    # ensure_database first access) treats this marker-only fixture (this
    # helper always builds profile.sqlite here) as already-migrated.
    stamp_schema_head(conn, "profile_db")
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    for suffix in ("-wal", "-shm"):
        p = path.parent / (path.name + suffix)
        if p.exists():
            p.unlink()


def _newer_r2_bytes(tmp_path, marker="newer_r2"):
    src = tmp_path / "_r2_seed" / "profile.sqlite"
    _write_marker_db(src, marker)
    return src.read_bytes()


@pytest.fixture()
def heal_ctx():
    from app.profile_context import set_current_profile_id
    from app.user_context import (
        set_current_method,
        set_current_path,
        set_current_req_id,
        set_current_user_id,
    )
    set_current_user_id(USER_H)
    set_current_profile_id(PROFILE_H)
    yield set_current_method, set_current_path, set_current_req_id
    # Clear the request context so it doesn't leak into sibling tests.
    set_current_method("")
    set_current_path("")
    set_current_req_id("")


def _drive_conflict_then_heal(tmp_path):
    """Reproduce a CAS conflict (which sets the conflict marker + invalidates the
    version) so the next ensure_database() performs the post-conflict re-pull —
    the exact 'mid-request DB heal' the CRITICAL log guards. Returns (fake, key)."""
    from app.database import SyncResult, set_local_db_version, sync_db_to_r2_explicit
    from app.storage import profile_r2_key
    from tests.test_t4050_durable_sync import FakeR2, _r2_patched

    fake = FakeR2()
    db_path = tmp_path / USER_H / "profiles" / PROFILE_H / "profile.sqlite"
    _write_marker_db(db_path, "stale_local")
    set_local_db_version(USER_H, PROFILE_H, 3)
    key = profile_r2_key(USER_H, PROFILE_H, "profile.sqlite")
    fake._objects[key] = {"data": _newer_r2_bytes(tmp_path), "metadata": {"db-version": "9"}}
    with _r2_patched(fake):
        assert sync_db_to_r2_explicit(USER_H, PROFILE_H) is SyncResult.CONFLICT
    return fake


def test_mid_write_heal_logs_critical(tmp_path, heal_ctx, caplog):
    from app.database import ensure_database, has_sync_conflict
    from tests.test_t4050_durable_sync import _r2_patched
    set_method, set_path, set_req = heal_ctx

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()):
        fake = _drive_conflict_then_heal(tmp_path)
        assert has_sync_conflict(USER_H), "conflict marker must survive the reheal scheduling"

        # A write is in flight while the heal fires.
        set_method("PUT")
        set_path("/api/clips/raw/131")
        set_req("req-t7010")
        with caplog.at_level(logging.CRITICAL, logger="app.database"), _r2_patched(fake):
            ensure_database()

    critical = [r for r in caplog.records if r.levelno == logging.CRITICAL and "MID-WRITE HEAL" in r.message]
    assert critical, "a post-conflict re-pull during a write must log CRITICAL"
    msg = critical[0].message
    assert "PUT /api/clips/raw/131" in msg
    assert "req_id=req-t7010" in msg


def test_cold_first_access_restore_is_not_flagged(tmp_path, heal_ctx, caplog):
    """A GET (read) first-access restore with no prior conflict is normal load-time
    work — it must NOT emit the CRITICAL mid-write-heal line."""
    from app.database import ensure_database
    from app.storage import profile_r2_key
    from tests.test_t4050_durable_sync import FakeR2, _r2_patched
    set_method, set_path, set_req = heal_ctx

    fake = FakeR2()
    key = profile_r2_key(USER_H, PROFILE_H, "profile.sqlite")
    fake._objects[key] = {"data": _newer_r2_bytes(tmp_path), "metadata": {"db-version": "9"}}

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()):
        set_method("GET")  # read request, no conflict marker set
        set_path("/api/games/1/load")
        set_req("req-cold")
        with caplog.at_level(logging.CRITICAL, logger="app.database"), _r2_patched(fake):
            ensure_database()

    assert not [r for r in caplog.records if "MID-WRITE HEAL" in r.message], \
        "a plain cold first-access restore must not be flagged"
