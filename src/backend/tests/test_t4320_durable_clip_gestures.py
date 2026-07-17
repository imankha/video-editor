"""T4320 — durable sync for clip-creating gestures + user.sqlite shutdown sync,
and the folded-in T5310 profile-create durability fix.

Before this task, annotate saves (POST /clips/raw/save, PUT/DELETE /clips/raw/{id})
and game finalize rode the fire-and-forget middleware sync (0.5s lock-timeout defer
-> `.sync_pending`). A clip the user saw a success toast for could revert wholesale
if the machine was replaced before the background sync ran. Separately, `user.sqlite`
was not in the SIGTERM shutdown sync, and `POST /api/profiles` create relied on
fire-and-forget to push the NEW profile.sqlite — the create-without-durable-sync race
that lost 2 of arshia's profiles on prod (T5310: registry row present, no R2 object).

The fix: mark the clip gestures + profile-create durable (`Depends(durable_sync)`) so
RequestContextMiddleware AWAITS the R2 sync inside the write lock and returns 503
instead of a lying 200; add user.sqlite to the shutdown loop; and in profile-create,
durably sync the NEW profile.sqlite to R2 BEFORE writing its registry row.

Reuses the T4050 in-memory boto3-shaped fake R2 so all of storage.py's real durable
logic (per-user upload lock, version metadata, parallel profile+user sync) runs. The
machine swap = wipe every machine-local surface (version caches + on-disk sqlite),
leaving only R2 — exactly the prod cold-machine path.
"""
import sqlite3
import uuid
from unittest.mock import patch

import httpx
import pytest

from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER_ID = "t4320dur"
PROFILE_ID = "abcd1234"  # 8 lowercase hex — passes the middleware X-Profile-ID regex
HEADERS = {"X-User-ID": USER_ID, "X-Profile-ID": PROFILE_ID}


def _ctx():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)


@pytest.fixture()
def dur_env(tmp_path, monkeypatch):
    """Real per-user user.sqlite + profile.sqlite under tmp_path + in-memory R2.

    Yields (app, fake, tmp_path). record_milestone is stubbed (no Postgres here).
    """
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        import app.routers.clips as clips_mod
        monkeypatch.setattr(clips_mod, "record_milestone", lambda *a, **k: None)

        from app.main import app
        from app.database import ensure_database, set_local_db_version, get_db_connection
        from app.services.user_db import ensure_user_database

        _ctx()
        ensure_user_database(USER_ID)  # create local user.sqlite (fresh, R2 empty)
        ensure_database()              # create local profile.sqlite (fresh, R2 empty)
        set_local_db_version(USER_ID, PROFILE_ID, 0)
        # Seed a game row so raw_clips.game_id FK is satisfied.
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("INSERT INTO games (name, status) VALUES ('T4320', 'ready')")
            game_id = cur.lastrowid
            conn.commit()

        yield app, fake, tmp_path, game_id


def _client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=HEADERS,
    )


def _profile_db_path(base, user_id=USER_ID, profile_id=PROFILE_ID):
    return base / user_id / "profiles" / profile_id / "profile.sqlite"


def _simulate_machine_replacement(base):
    """Wipe every machine-local surface: profile + user version caches and the
    on-disk sqlite files (+ WAL sidecars). Only the fake R2 store survives."""
    from app.database import set_local_db_version, set_local_user_db_version, reset_initialized_flag
    from app.services.user_db import _init_lock, _initialized_user_dbs
    set_local_db_version(USER_ID, PROFILE_ID, None)
    set_local_user_db_version(USER_ID, None)
    reset_initialized_flag()
    with _init_lock:
        _initialized_user_dbs.discard(USER_ID)
    for rel in (
        _profile_db_path(base),
        base / USER_ID / "user.sqlite",
    ):
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


def _raw_clip_rows(base):
    conn = sqlite3.connect(str(_profile_db_path(base)))
    try:
        return conn.execute("SELECT id, name, start_time, end_time FROM raw_clips").fetchall()
    finally:
        conn.close()


# ===========================================================================
# 1. HEADLINE — a clip save that returned 200 survives a machine replacement
# ===========================================================================

@pytest.mark.asyncio
async def test_clip_save_survives_machine_replacement(dur_env):
    app, fake, base, game_id = dur_env

    async with _client(app) as c:
        resp = await c.post("/api/clips/raw/save", json={
            "game_id": game_id, "start_time": 1.0, "end_time": 4.0,
            "name": "Durable Clip", "rating": 5, "video_sequence": 1,
        })
    assert resp.status_code == 200, resp.text
    clip_id = resp.json()["raw_clip_id"]

    _simulate_machine_replacement(base)
    _reload_from_r2()

    rows = _raw_clip_rows(base)
    assert any(r[0] == clip_id and r[1] == "Durable Clip" for r in rows), \
        f"saved clip reverted after machine replacement — durable sync did not reach R2 (rows={rows})"


@pytest.mark.asyncio
async def test_clip_update_and_delete_survive_machine_replacement(dur_env):
    app, fake, base, game_id = dur_env

    async with _client(app) as c:
        r_save = await c.post("/api/clips/raw/save", json={
            "game_id": game_id, "start_time": 2.0, "end_time": 6.0,
            "name": "Orig", "rating": 3, "video_sequence": 1,
        })
        clip_id = r_save.json()["raw_clip_id"]

        r_upd = await c.put(f"/api/clips/raw/{clip_id}", json={"name": "Renamed", "rating": 4})
        assert r_upd.status_code == 200, r_upd.text

    _simulate_machine_replacement(base)
    _reload_from_r2()
    rows = _raw_clip_rows(base)
    assert any(r[0] == clip_id and r[1] == "Renamed" for r in rows), \
        f"clip update reverted after machine replacement (rows={rows})"

    async with _client(app) as c:
        r_del = await c.delete(f"/api/clips/raw/{clip_id}")
        assert r_del.status_code == 200, r_del.text

    _simulate_machine_replacement(base)
    _reload_from_r2()
    rows = _raw_clip_rows(base)
    assert not any(r[0] == clip_id for r in rows), \
        f"deleted clip reappeared after machine replacement (rows={rows})"


# ===========================================================================
# 2. Forced sync failure -> 503 keeps the save non-durable (a 200 would lie)
# ===========================================================================

@pytest.mark.asyncio
async def test_clip_save_forced_sync_failure_returns_503_not_durable(dur_env):
    app, fake, base, game_id = dur_env
    fake.fail_profile_upload = True

    async with _client(app) as c:
        resp = await c.post("/api/clips/raw/save", json={
            "game_id": game_id, "start_time": 3.0, "end_time": 7.0,
            "name": "WillFail", "rating": 5, "video_sequence": 1,
        })

    assert resp.status_code == 503, resp.text
    body = resp.json()
    assert body["code"] == "sync_failed"
    assert body["retryable"] is True

    _simulate_machine_replacement(base)
    _reload_from_r2()
    rows = _raw_clip_rows(base)
    assert not any(r[1] == "WillFail" for r in rows), \
        "503 path must NOT be durable — a 200 here would have silently reverted the clip"


# ===========================================================================
# 3. user.sqlite is covered by the SIGTERM graceful-shutdown sync
# ===========================================================================

@pytest.mark.asyncio
async def test_user_sqlite_included_in_shutdown_sync(dur_env):
    app, fake, base, game_id = dur_env
    from app.services.user_db import set_credits  # any user.sqlite write
    from app.storage import r2_key

    # Mutate user.sqlite locally WITHOUT syncing it to R2 (no request cycle).
    _ctx()
    set_credits(USER_ID, 7)

    user_key = f"{fake_env()}/users/{USER_ID}/user.sqlite"
    assert not fake.has(user_key), "precondition: user.sqlite not yet in R2"

    # Run the SIGTERM handler; it sys.exit(0)s at the end.
    from app.main import _graceful_shutdown
    with patch("app.storage.R2_ENABLED", True), \
         patch("app.database.R2_ENABLED", True), \
         patch("app.main.sys") as fake_sys:
        fake_sys.exit.side_effect = SystemExit
        with pytest.raises(SystemExit):
            _graceful_shutdown(15, None)

    assert fake.has(user_key), \
        "user.sqlite was NOT synced to R2 on graceful shutdown (T4320 shutdown-sync gap)"
    # And the profile.sqlite is still covered (regression guard on the existing loop).
    _ctx()
    assert fake.has(r2_key(USER_ID, "profile.sqlite")), "profile.sqlite missing from shutdown sync"


def fake_env():
    from app.storage import APP_ENV
    return APP_ENV


# ===========================================================================
# 4. T5310 — profile-create durably syncs the new profile.sqlite before returning
# ===========================================================================

@pytest.mark.asyncio
async def test_profile_create_survives_machine_replacement(dur_env):
    """The exact prod bug: a created profile must be registered AND have its R2
    profile.sqlite object, surviving a machine swap that leaves only R2."""
    app, fake, base, game_id = dur_env

    async with _client(app) as c:
        resp = await c.post("/api/profiles", json={"name": "Ella U13", "color": "#abc"})
    assert resp.status_code == 200, resp.text
    new_id = resp.json()["id"]

    # New profile.sqlite object present in R2 under the NEW profile's prefix.
    from app.storage import APP_ENV
    new_obj_key = f"{APP_ENV}/users/{USER_ID}/profiles/{new_id}/profile.sqlite"
    assert fake.has(new_obj_key), "new profile.sqlite never reached R2 despite a 200"

    _simulate_machine_replacement(base)
    _reload_from_r2()

    # Registry (user.sqlite from R2) still lists the new profile...
    from app.services.user_db import get_profiles
    ids = [p["id"] for p in get_profiles(USER_ID)]
    assert new_id in ids, f"created profile missing from registry after machine swap (ids={ids})"
    # ...and its R2 object is still there (a registered profile with a backing object).
    assert fake.has(new_obj_key), "registered profile has no R2 object after machine swap (Direction-A regression)"


@pytest.mark.asyncio
async def test_profile_create_forced_sync_failure_does_not_register(dur_env):
    """If the new profile.sqlite fails to sync, the create returns 503 and the
    registry row is NEVER written — never a 'missing' registered profile."""
    app, fake, base, game_id = dur_env
    fake.fail_profile_upload = True

    from app.services.user_db import get_profiles
    before = {p["id"] for p in (get_profiles(USER_ID))}

    async with _client(app) as c:
        resp = await c.post("/api/profiles", json={"name": "Ghost", "color": "#000"})

    assert resp.status_code == 503, resp.text
    body = resp.json()
    assert body["code"] == "sync_failed"
    assert body["retryable"] is True

    _ctx()
    after = {p["id"] for p in get_profiles(USER_ID)}
    assert after == before, \
        "a profile whose object failed to sync must NOT be registered (would recreate the T5310 missing-object bug)"
    assert not any(p["name"] == "Ghost" for p in get_profiles(USER_ID))
