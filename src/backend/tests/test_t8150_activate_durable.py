"""T8150 — game activation must be durable (sync-before-respond).

The bug (dev repro 2026-08-31, same shape as the ojedalucas19 prod incident T7870):
a freshly uploaded game shows the "Game ready!" success toast and credits are
debited, but the game then VANISHES from the games list. `list_games` applies NO
status filter, so a vanished game means its `games` row is gone-or-reverted, not
filtered.

Root cause: `POST /api/games/{id}/activate` (activate_game) flips the game
`pending -> ready` in the local profile.sqlite and returns 200 — but, unlike
`finalize_upload`, it was NOT a `durable_sync` route. The ready-flip therefore rode
the middleware's fire-and-forget R2 sync (0.5s upload-lock defer -> `.sync_pending`).
If that background sync loses the lock race or the machine is replaced, the flip
never reaches R2; the next cold restore / CAS re-heal pulls R2's pre-flip snapshot
back down and the game re-materializes as `status='pending'` (filtered out of
`readyGames`, so invisible) or absent entirely. Meanwhile the credit debit is durable
in Postgres (T5840) and independent — hence "credits debited + game gone."

The fix mirrors T4320/T5310: mark activate_game `Depends(durable_sync)` so
RequestContextMiddleware AWAITS the R2 sync inside the still-held write lock and
returns a retryable 503 instead of a lying 200 when the sync fails. The durable sync
uploads the whole profile.sqlite, so it carries both the pending INSERT and the
ready-flip to R2 before the 200 that triggers the success toast.

Reuses the T4320 durable-sync harness (in-memory boto3-shaped R2 + machine-swap =
wipe every machine-local surface, leaving only R2 — the prod cold-machine path).
"""
import sqlite3
from unittest.mock import patch

import httpx
import pytest

from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER_ID = "t8150dur"
PROFILE_ID = "abcd1234"  # 8 lowercase hex — passes the middleware X-Profile-ID regex
HEADERS = {"X-User-ID": USER_ID, "X-Profile-ID": PROFILE_ID}
HASH = "a" * 64


def _ctx():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)


@pytest.fixture()
def dur_env(tmp_path, monkeypatch):
    """Real per-user user.sqlite + profile.sqlite under tmp_path + in-memory R2.

    Seeds a PENDING game (+ a fully-probed game_videos row so activate skips the R2
    probe) and pre-syncs that pending state to R2 — simulating create_game's
    fire-and-forget sync having landed the pending row. Yields (app, fake, base,
    game_id).
    """
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        import app.routers.games as games_mod
        monkeypatch.setattr(games_mod, "record_milestone", lambda *a, **k: None)

        from app.database import (
            ensure_database,
            get_db_connection,
            set_local_db_version,
            sync_db_to_r2_explicit,
        )
        from app.main import app
        from app.services.user_db import ensure_user_database

        _ctx()
        ensure_user_database(USER_ID)
        ensure_database()
        set_local_db_version(USER_ID, PROFILE_ID, 0)

        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO games (name, status, blake3_hash) VALUES ('T8150', 'pending', ?)",
                (HASH,),
            )
            game_id = cur.lastrowid
            cur.execute(
                """INSERT INTO game_videos
                   (game_id, blake3_hash, sequence, duration, video_width, video_height, video_size, fps)
                   VALUES (?, ?, 1, 10.0, 1920, 1080, 12345, 30.0)""",
                (game_id, HASH),
            )
            conn.commit()

        # Simulate create_game's fire-and-forget sync having landed the pending row
        # in R2. The activate flip is the write whose durability is under test.
        _ctx()
        sync_db_to_r2_explicit(USER_ID, PROFILE_ID)

        yield app, fake, tmp_path, game_id


def _client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=HEADERS,
    )


def _profile_db_path(base):
    return base / USER_ID / "profiles" / PROFILE_ID / "profile.sqlite"


def _simulate_machine_replacement(base):
    """Wipe every machine-local surface: profile + user version caches and the
    on-disk sqlite files (+ WAL sidecars). Only the fake R2 store survives."""
    from app.database import reset_initialized_flag, set_local_db_version, set_local_user_db_version
    from app.services.user_db import _init_lock, _initialized_user_dbs
    set_local_db_version(USER_ID, PROFILE_ID, None)
    set_local_user_db_version(USER_ID, None)
    reset_initialized_flag()
    with _init_lock:
        _initialized_user_dbs.discard(USER_ID)
    for rel in (_profile_db_path(base), base / USER_ID / "user.sqlite"):
        for suffix in ("", "-wal", "-shm"):
            p = rel.parent / (rel.name + suffix)
            if p.exists():
                p.unlink()


def _reload_from_r2():
    from app.database import ensure_database
    from app.services.user_db import ensure_user_database
    _ctx()
    ensure_user_database(USER_ID)
    ensure_database()


def _game_status(base, game_id):
    conn = sqlite3.connect(str(_profile_db_path(base)))
    try:
        row = conn.execute("SELECT status FROM games WHERE id = ?", (game_id,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def _activate_stubs():
    """Patch activate_game's externalities (R2 validation, credits, storage refs,
    poster warm, ready-email) so the ONLY behavior under test is the durable sync of
    the ready-flip. Postgres is stubbed by conftest get_pg."""
    import app.routers.games as games_mod
    return [
        patch.object(games_mod, "_validate_video_in_r2", return_value=None),
        patch.object(games_mod, "deduct_credits", return_value={"success": True, "balance": 100}),
        patch.object(games_mod, "insert_game_storage_ref", lambda *a, **k: None),
        patch.object(games_mod, "_maybe_send_game_ready_email", lambda *a, **k: None),
        patch("app.services.poster_warmer.fire_and_forget", lambda *a, **k: None),
        patch("app.services.poster_warmer.warm_game_source_poster_background", lambda *a, **k: None),
    ]


# ===========================================================================
# HEADLINE — an activated game that returned "ready" survives a machine swap
# ===========================================================================

@pytest.mark.asyncio
async def test_activated_game_survives_machine_replacement(dur_env):
    app, _fake, base, game_id = dur_env

    stubs = _activate_stubs()
    for s in stubs:
        s.start()
    try:
        async with _client(app) as c:
            resp = await c.post(f"/api/games/{game_id}/activate")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "ready"
    finally:
        for s in stubs:
            s.stop()

    _simulate_machine_replacement(base)
    _reload_from_r2()

    status = _game_status(base, game_id)
    assert status == "ready", (
        f"activated game reverted to status={status!r} after machine replacement — the "
        f"pending->ready flip never reached R2 (a 'ready' game vanished from the list "
        f"while its credits stayed debited)"
    )


# ===========================================================================
# Forced sync failure -> 503 keeps activate honest (a 200 would lie)
# ===========================================================================

@pytest.mark.asyncio
async def test_activate_forced_sync_failure_returns_503(dur_env):
    app, fake, _base, game_id = dur_env
    fake.fail_profile_upload = True

    stubs = _activate_stubs()
    for s in stubs:
        s.start()
    try:
        async with _client(app) as c:
            resp = await c.post(f"/api/games/{game_id}/activate")
    finally:
        for s in stubs:
            s.stop()

    assert resp.status_code == 503, resp.text
    body = resp.json()
    assert body["code"] == "sync_failed"
    assert body["retryable"] is True
