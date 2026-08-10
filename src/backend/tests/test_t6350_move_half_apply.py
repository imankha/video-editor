"""
T6350 — move-to-profile half-applies, but the user is told "not moved".

`POST /api/downloads/move-to-profile` writes+syncs the TARGET profile (phase 1),
locally deletes the SOURCE rows (phase 2, committed), and deletes the SOURCE media
(phase 3) BEFORE the middleware runs the source-profile durable sync. When THAT
source sync fails/conflicts, the middleware historically discarded the handler's
200 and returned the generic DURABLE_SYNC_FAILED_RESPONSE — "Your reel was not
moved." — which is a LIE: the target copy is already durable in R2.

The fix: the handler registers a truthful per-route 503 body
(`move_source_cleanup_failed`, target_committed=True) via
`set_durable_sync_failure_response`, set ONLY after the phase-2 commit, plus a
phase-1 idempotency guard and an idempotent `/move-to-profile/finish` completion
endpoint.

These tests drive the REAL ASGI app end-to-end (httpx.ASGITransport) so the
middleware actually runs — the direct-call `_move()` helper in
test_t4850_move_reels.py bypasses it and cannot reach phase 2. The seam is
`app.middleware.db_sync.sync_db_to_r2_explicit` (the PHASE-2 source sync) patched
to FAILED/CONFLICT; phase 1 uses a SEPARATE import
(`app.routers.downloads.sync_db_to_r2_explicit`), left real, so the target write
is genuinely durable against the FakeR2. Process-global FORCE_R2_SYNC_FAILURE
faults phase 1 first and cannot isolate phase 2 — that is what
test_t4850_move_reels.py already covers.
"""

import sqlite3
from unittest.mock import patch

import httpx
import pytest

from app.database import SyncResult
from app.services.glicko import seed_rating
from app.storage import profile_r2_key
from app.utils.encoding import encode_data

# Reuse the T4050 in-memory boto3-shaped R2 + its enable-everywhere context.
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER_ID = "t6350user"
SRC = "abcd1234"  # 8 lowercase hex — passes the middleware X-Profile-ID regex
DST = "beef5678"
SRC_HEADERS = {"X-User-ID": USER_ID, "X-Profile-ID": SRC}

MOVE_URL = "/api/downloads/move-to-profile"
FINISH_URL = "/api/downloads/move-to-profile/finish"


class MoveFakeR2(FakeR2):
    """FakeR2 + server-side copy_object (phase-0 media relocation) so the move's
    real R2 media path runs against the fake."""

    def copy_object(self, Bucket=None, CopySource=None, Key=None, **kw):
        src = CopySource["Key"]
        with self._lock:
            obj = self._objects.get(src)
            if obj is None:
                raise self.exceptions.ClientError(
                    {"Error": {"Code": "404", "Message": "Not Found"}}, "CopyObject"
                )
            self._objects[Key] = {"data": obj["data"], "metadata": dict(obj["metadata"])}
        return {}


_fid = [6350]


def _profile_db_path(base, pid):
    return base / USER_ID / "profiles" / pid / "profile.sqlite"


def _insert_reel(base, pid, *, name="Great Goal", game_ids=None):
    """Insert a published, single-clip reel into a profile DB; returns (id, filename)."""
    _fid[0] += 1
    fid = _fid[0]
    filename = f"reel_{fid}.mp4"
    conn = sqlite3.connect(str(_profile_db_path(base, pid)))
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute(
        """
        INSERT INTO final_videos
          (id, project_id, filename, version, duration, source_type, game_id,
           name, rating_counts, watched_at, published_at, aspect_ratio, tags,
           game_ids, clip_count, quality_score, rating, rd, match_count,
           source_clip_id, clip_start_time, clip_game_start_time)
        VALUES (?, NULL, ?, 1, 5.0, 'brilliant_clip', NULL,
                ?, NULL, NULL, '2026-01-01 00:00:00', '9:16', NULL,
                ?, 1, 5.0, ?, 120.0, 3, NULL, 12.0, 30.0)
        """,
        (
            fid, filename, name,
            encode_data(game_ids) if game_ids is not None else None,
            seed_rating(5.0) + 50,
        ),
    )
    conn.commit()
    conn.close()
    return fid, filename


def _seed_source_media(fake, filename):
    """Place the source-profile media object so phase-0 copy_object finds it."""
    key = profile_r2_key(USER_ID, SRC, f"final_videos/{filename}")
    fake._objects[key] = {"data": b"MP4DATA", "metadata": {}}


def _target_final_videos(fake):
    """Read the TARGET profile.sqlite bytes out of R2 (not the API) and return its
    published final_videos filenames — proves phase 1 was durable, like the staging
    repro (which read R2 directly, not the API)."""
    import os
    import tempfile
    key = profile_r2_key(USER_ID, DST, "profile.sqlite")
    obj = fake._objects.get(key)
    if obj is None:
        return None
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tf:
        tf.write(obj["data"])
        path = tf.name
    try:
        c = sqlite3.connect(path)
        rows = c.execute(
            "SELECT filename FROM final_videos WHERE published_at IS NOT NULL"
        ).fetchall()
        c.close()
        return [r[0] for r in rows]
    finally:
        os.unlink(path)


def _source_final_videos(base, pid=SRC):
    c = sqlite3.connect(str(_profile_db_path(base, pid)))
    rows = c.execute("SELECT filename FROM final_videos").fetchall()
    c.close()
    return [r[0] for r in rows]


@pytest.fixture()
def env(tmp_path):
    """Two schema-current profile DBs for one user, R2 enabled (FakeR2). Yields
    (app, fake, base)."""
    fake = MoveFakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         _r2_patched(fake):
        from app.database import ensure_database, set_local_db_version, set_local_user_db_version
        from app.main import app
        from app.profile_context import set_current_profile_id
        from app.services import user_db as user_db_mod
        from app.user_context import set_current_req_id, set_current_user_id

        set_current_user_id(USER_ID)
        set_current_req_id("req-t6350")

        # Register both profiles in user.sqlite, then lock its sync version so a
        # first-access restore (R2 empty) never wipes them mid-request.
        user_db_mod.create_profile(USER_ID, SRC, "Athlete A", "#f00", is_default=True)
        user_db_mod.create_profile(USER_ID, DST, "Athlete B", "#00f")
        set_local_user_db_version(USER_ID, 0)

        # Materialize both profile DBs (schema) and lock their versions to 0 so
        # in-request ensure_database() calls don't re-download mid-test.
        for pid in (SRC, DST):
            set_current_profile_id(pid)
            ensure_database()
            set_local_db_version(USER_ID, pid, 0)
        set_current_profile_id(SRC)

        yield app, fake, tmp_path


def _client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=SRC_HEADERS,
    )


# --------------------------------------------------------------------------- #
# The headline anti-lie: phase-2 source-sync failure -> honest 503
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
@pytest.mark.parametrize("result,expected_state", [
    (SyncResult.FAILED, "failed"),
    (SyncResult.CONFLICT, "conflict"),
])
async def test_source_sync_failure_reports_honestly(env, result, expected_state):
    app, fake, base = env
    fid, filename = _insert_reel(base, SRC, game_ids=[5])
    _seed_source_media(fake, filename)

    # Patch ONLY the phase-2 (source) sync — phase 1 (target) uses a different
    # import and stays real, so the target copy is genuinely durable.
    with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=result):
        async with _client(app) as client:
            res = await client.post(
                MOVE_URL, json={"video_ids": [fid], "target_profile_id": DST}
            )

    assert res.status_code == 503
    body = res.json()
    # (1) honest code + target_committed, and the anti-lie assertion.
    assert body["code"] == "move_source_cleanup_failed"
    assert body["target_committed"] is True
    assert body["moved_ids"] == [fid]
    assert body["target_profile_id"] == DST
    assert "not moved" not in body["detail"].lower()
    # (3) FAILED vs CONFLICT differ only in sync_state.
    assert body["sync_state"] == expected_state

    # (2) the TARGET profile's R2 bytes actually contain the moved reel.
    assert _target_final_videos(fake) == [filename]


# --------------------------------------------------------------------------- #
# (4) The override must not leak — an unrelated durable route stays generic.
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_unrelated_durable_route_keeps_generic_message(env):
    app, _fake, base = env
    fid, _filename = _insert_reel(base, SRC)

    # DELETE /api/downloads/{id} is durable and writes the SOURCE profile DB. With
    # the profile sync patched to fail it returns the GENERIC body — it never set
    # the T6350 override, proving request.state does not leak across requests.
    with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=SyncResult.FAILED):
        async with _client(app) as client:
            res = await client.delete(f"/api/downloads/{fid}")

    assert res.status_code == 503
    body = res.json()
    assert body["code"] == "sync_failed"
    assert "not moved" in body["detail"].lower()  # the generic (correct here) text
    assert "target_committed" not in body


# --------------------------------------------------------------------------- #
# (5) A PHASE-1 failure still returns the original "nothing moved" 503 + rollback.
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_phase1_failure_still_generic_and_rolls_back(env):
    app, fake, base = env
    fid, filename = _insert_reel(base, SRC, game_ids=[7])
    _seed_source_media(fake, filename)

    # Fault the PHASE-1 target sync (the downloads-module import). The handler
    # rolls the target back and raises the generic 503 BEFORE reaching phase 2, so
    # the override is never set.
    with patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=SyncResult.FAILED):
        async with _client(app) as client:
            res = await client.post(
                MOVE_URL, json={"video_ids": [fid], "target_profile_id": DST}
            )

    assert res.status_code == 503
    body = res.json()
    # Phase-1 aborts via HTTPException(detail=DURABLE_SYNC_FAILED_RESPONSE), so the
    # generic body is nested under "detail" (FastAPI's HTTPException envelope) —
    # useMoveReels reads flat-or-nested. Either way it is the generic "not moved".
    detail = body["detail"]
    assert detail["code"] == "sync_failed"
    assert "not moved" in detail["detail"].lower()
    assert detail.get("code") != "move_source_cleanup_failed"
    # Source intact, target rolled back (no durable target copy).
    assert _source_final_videos(base) == [filename]
    assert _target_final_videos(fake) in (None, [])


# --------------------------------------------------------------------------- #
# (6) Idempotency: a re-issued move never double-inserts in the target.
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_move_is_idempotent_after_source_reheal(env):
    app, fake, base = env
    fid, filename = _insert_reel(base, SRC, game_ids=[9])
    _seed_source_media(fake, filename)

    # First move: source sync fails -> half-applied (target durable, source rows
    # locally gone). Honest 503.
    with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=SyncResult.FAILED):
        async with _client(app) as client:
            res1 = await client.post(
                MOVE_URL, json={"video_ids": [fid], "target_profile_id": DST}
            )
    assert res1.status_code == 503
    assert _target_final_videos(fake) == [filename]

    # Simulate the re-heal restoring the source row back (R2 still had it): re-insert
    # the exact source row (same id + filename) and re-seed its media, then re-issue
    # the SAME move. The phase-1 filename guard must skip the re-insert so the target
    # holds exactly ONE row for that filename.
    conn = sqlite3.connect(str(_profile_db_path(base, SRC)))
    conn.execute(
        """
        INSERT INTO final_videos
          (id, filename, version, duration, source_type, name, published_at,
           aspect_ratio, clip_count, quality_score, rating, rd, match_count,
           game_ids, clip_start_time, clip_game_start_time)
        VALUES (?, ?, 1, 5.0, 'brilliant_clip', 'Great Goal', '2026-01-01 00:00:00',
                '9:16', 1, 5.0, ?, 120.0, 3, ?, 12.0, 30.0)
        """,
        (fid, filename, seed_rating(5.0) + 50, encode_data([9])),
    )
    conn.commit()
    conn.close()
    _seed_source_media(fake, filename)  # phase-0 needs the source object present again

    with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=SyncResult.OK):
        async with _client(app) as client:
            res2 = await client.post(
                MOVE_URL, json={"video_ids": [fid], "target_profile_id": DST}
            )
    assert res2.status_code == 200

    # Target holds EXACTLY one row for that filename (no double-insert).
    assert _target_final_videos(fake).count(filename) == 1


# --------------------------------------------------------------------------- #
# (7) /finish: happy path, 409 on missing target, idempotent no-op on repeat.
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_finish_happy_path_deletes_source(env):
    app, fake, base = env
    fid, filename = _insert_reel(base, SRC, game_ids=[11])
    _seed_source_media(fake, filename)

    # Half-apply: target durable, source rows locally deleted, honest 503.
    with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=SyncResult.FAILED):
        async with _client(app) as client:
            await client.post(MOVE_URL, json={"video_ids": [fid], "target_profile_id": DST})

    # /finish with the source sync now OK: source rows are (already) gone locally,
    # the DELETE no-ops but the write is tracked so durable_sync re-attempts -> 200.
    with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=SyncResult.OK):
        async with _client(app) as client:
            res = await client.post(
                FINISH_URL, json={"video_ids": [fid], "target_profile_id": DST}
            )
    assert res.status_code == 200
    assert res.json()["finished_ids"] == [fid]
    assert _source_final_videos(base) == []

    # Called AGAIN -> still a 200 no-op (idempotent).
    with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=SyncResult.OK):
        async with _client(app) as client:
            res2 = await client.post(
                FINISH_URL, json={"video_ids": [fid], "target_profile_id": DST}
            )
    assert res2.status_code == 200


@pytest.mark.asyncio
async def test_finish_409_when_target_missing_deletes_nothing(env):
    app, _fake, base = env
    # A reel that still lives in SOURCE and was NEVER copied to the target.
    fid, filename = _insert_reel(base, SRC)

    with patch("app.middleware.db_sync.sync_db_to_r2_explicit", return_value=SyncResult.OK):
        async with _client(app) as client:
            res = await client.post(
                FINISH_URL, json={"video_ids": [fid], "target_profile_id": DST}
            )
    assert res.status_code == 409
    body = res.json()
    detail = body.get("detail", body)
    assert detail["code"] == "move_target_missing"
    assert fid in detail["unconfirmed_ids"]
    # Nothing deleted from the source — its target copy could not be proven.
    assert _source_final_videos(base) == [filename]


@pytest.mark.asyncio
async def test_finish_refuses_when_target_cannot_be_confirmed(env):
    """The target-presence proof is a DESTRUCTIVE gate: if R2 can't confirm the
    target is current, /finish must refuse (503) and delete NOTHING, rather than
    trusting a possibly-stale local cache and losing the reel from both profiles."""
    app, _fake, base = env
    fid, filename = _insert_reel(base, SRC)

    # Fault the target's freshness confirmation (require_fresh -> ProfileDBRefreshFailed).
    with patch("app.storage.sync_database_from_r2_if_newer", return_value=(False, None, True)):
        async with _client(app) as client:
            res = await client.post(
                FINISH_URL, json={"video_ids": [fid], "target_profile_id": DST}
            )
    assert res.status_code == 503
    body = res.json()
    detail = body.get("detail", body)
    # Refused BEFORE any delete -> generic retryable body, source row intact.
    assert (detail.get("code") == "sync_failed") or (body.get("code") == "sync_failed")
    assert _source_final_videos(base) == [filename]
