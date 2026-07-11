"""
T4120 — durability TEST SEAMS (gated; inert on production AND staging).

These endpoints exist ONLY so a /dotask container worker can self-verify the
durable-export boundary (T4110) end-to-end, in ONE process, with no supervisor:

  POST /api/test/sync-fault            {enabled: bool}
      Flip a process-global that forces every R2 DB sync to fail (return False,
      never raise) so the spec can drive: enable -> export -> assert retryable
      `sync_failed` (COMPLETE withheld) -> disable -> export -> assert COMPLETE.

  POST /api/test/simulate-machine-cycle
      Reproduce a Fly machine cycle WITHOUT killing the process: clear the local
      SQLite version caches, delete the current user's local profile.sqlite /
      user.sqlite, and re-pull the last durable R2 snapshot — exactly what a cold
      machine does on session_init. An edit that was made under a forced sync
      fault (delta only on local disk, never in R2) is therefore reverted.

Prod-impossibility — THREE independent layers (security):
  1. Compute-time gate: `_force_r2_sync_failure()` ANDs `_test_seams_enabled()`
     first, so even a leaked FORCE_R2_SYNC_FAILURE=1 is inert on prod/staging.
  2. Router not mounted: main.py include_router's this ONLY when
     `_test_seams_enabled()` — on prod/staging the routes don't exist (404).
  3. Per-handler re-check: every handler re-asserts the gate and 404s otherwise.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..profile_context import get_current_profile_id
from ..storage import R2_ENABLED, _test_seams_enabled, set_force_r2_sync_failure
from ..user_context import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/test", tags=["test-seams"])


def _require_seams_enabled() -> None:
    """Layer 3: per-handler re-check — 404 if the seams are disabled."""
    if not _test_seams_enabled():
        raise HTTPException(status_code=404, detail="Not found")


class SyncFaultRequest(BaseModel):
    enabled: bool


@router.post("/sync-fault")
async def set_sync_fault(req: SyncFaultRequest):
    """Force (or clear) R2 DB-sync failure for the whole process (test seam)."""
    _require_seams_enabled()
    set_force_r2_sync_failure(req.enabled)
    logger.warning(f"[TEST] sync-fault set to enabled={req.enabled}")
    return {"status": "ok", "force_r2_sync_failure": req.enabled}


def _unlink_db_files(base: Path, name: str) -> bool:
    """Delete <base>/<name> plus its -wal/-shm sidecars. Returns True if the
    main file existed."""
    main = base / name
    existed = main.exists()
    for suffix in ("", "-wal", "-shm"):
        p = base / f"{name}{suffix}"
        try:
            p.unlink(missing_ok=True)
        except OSError as e:
            logger.warning(f"[TEST] could not unlink {p}: {e}")
    return existed


class SeedReelRequest(BaseModel):
    name: str = "Seeded Reel"
    aspect_ratio: str = "9:16"
    clip_count: int = 1
    quality_score: float | None = 5.0
    with_media: bool = True  # generate + upload a real tiny MP4 to R2


def _generate_tiny_mp4() -> bytes | None:
    """Render a ~1s faststart MP4 via ffmpeg so a seeded reel is genuinely playable
    (metadata + seekable). Returns None if ffmpeg is unavailable."""
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "seed.mp4"
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi",
                    "-i", "color=c=blue:s=180x320:d=1:r=15",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", str(out),
                ],
                check=True, capture_output=True, timeout=30,
            )
            return out.read_bytes()
        except (OSError, subprocess.SubprocessError) as e:
            logger.warning(f"[TEST] tiny-mp4 generation failed: {e}")
            return None


@router.post("/seed-final-video")
async def seed_final_video(req: SeedReelRequest):
    """Insert a PUBLISHED final_video into the current profile (test seam, T4850).

    Lets an E2E create a movable reel without driving the whole upload -> annotate
    -> frame -> export -> publish pipeline. With `with_media` (default), a real tiny
    MP4 is uploaded to R2 under the current profile's final_videos/ prefix so the
    reel actually PLAYS/downloads — exercising the per-profile media path the move
    must relocate. Non-prod only (gated three ways like every seam)."""
    _require_seams_enabled()

    from ..database import get_db_connection
    from ..services.glicko import RD_MAX, seed_rating
    from ..storage import upload_bytes_to_r2

    single = req.clip_count == 1
    rating = seed_rating(req.quality_score) if single else None
    rd = RD_MAX if single else None
    safe = "".join(c for c in req.name.replace(" ", "_") if c.isalnum() or c in "_-")
    filename = f"seed_{get_current_user_id()[:6]}_{safe}.mp4"

    media_uploaded = False
    if req.with_media and R2_ENABLED:
        data = _generate_tiny_mp4()
        if data:
            media_uploaded = upload_bytes_to_r2(
                get_current_user_id(), f"final_videos/{filename}", data
            )

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO final_videos
              (project_id, filename, version, duration, source_type, name,
               published_at, aspect_ratio, clip_count, quality_score,
               rating, rd, match_count)
            VALUES (NULL, ?, 1, 1.0, 'custom_project', ?,
                    CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 0)
            """,
            (filename, req.name, req.aspect_ratio, req.clip_count,
             req.quality_score, rating, rd),
        )
        reel_id = cur.lastrowid
        conn.commit()

    logger.warning(
        f"[TEST] seeded final_video id={reel_id} name={req.name!r} media={media_uploaded}"
    )
    return {"status": "ok", "id": reel_id, "filename": filename, "media_uploaded": media_uploaded}


@router.post("/ensure-pg-user")
async def ensure_pg_user():
    """Idempotently create the current user in the Postgres `users` table (test seam).

    The X-User-ID isolation bypass gives a fresh SQLite profile but NO Postgres
    users row, so any Postgres-FK feature (sharing, referrals) 500s. This lets an
    E2E exercise those end-to-end under an isolated user. Non-prod only."""
    _require_seams_enabled()

    from ..services.auth_db import create_user, get_user_by_id

    user_id = get_current_user_id()
    if get_user_by_id(user_id) is None:
        create_user(user_id, email=f"{user_id}@e2e.local")
        return {"status": "created", "user_id": user_id}
    return {"status": "exists", "user_id": user_id}


@router.post("/simulate-machine-cycle")
async def simulate_machine_cycle():
    """Drop machine-local SQLite state and re-pull from R2 (test seam).

    The local DB files + their in-memory version caches are the ENTIRE
    machine-local surface a Fly cycle loses, so resetting exactly those and
    re-pulling == cycling the machine, with no process restart.
    """
    _require_seams_enabled()

    if not R2_ENABLED:
        # Without R2 there is no durable snapshot to restore to — the sim would
        # wipe local state with nothing to pull back. Refuse loudly (dev misconfig).
        raise HTTPException(
            status_code=409,
            detail="R2_ENABLED is false — cannot simulate a machine cycle without a durable R2 snapshot",
        )

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    from ..database import (
        USER_DATA_BASE,
        ensure_database,
        get_user_data_path_explicit,
        reset_initialized_flag,
        set_local_db_version,
        set_local_user_db_version,
    )
    from ..services.user_db import _init_lock, _initialized_user_dbs, ensure_user_database

    # 1. Clear version caches (so the re-pull is treated as a cold first access).
    set_local_db_version(user_id, profile_id, None)
    set_local_user_db_version(user_id, None)
    reset_initialized_flag()  # discards current user from profile-db init cache
    with _init_lock:
        _initialized_user_dbs.discard(user_id)

    # 2. Delete the local DB files (the un-synced delta lives only here).
    profile_existed = _unlink_db_files(
        get_user_data_path_explicit(user_id, profile_id), "profile.sqlite"
    )
    user_existed = _unlink_db_files(USER_DATA_BASE / user_id, "user.sqlite")

    # 3. Re-pull the last durable R2 snapshot — exactly the cold-machine path.
    ensure_user_database(user_id)
    ensure_database()

    logger.warning(
        f"[TEST] simulate-machine-cycle for user={user_id} profile={profile_id} "
        f"(profile_db_deleted={profile_existed}, user_db_deleted={user_existed}) — re-pulled from R2"
    )
    return {
        "status": "ok",
        "profile_db_deleted": profile_existed,
        "user_db_deleted": user_existed,
    }
