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


@router.post("/migrate-current-profile")
async def migrate_current_profile():
    """Migrate the logged-in user's current profile (+ user.sqlite) to HEAD schema (test seam).

    The durability self-verify spec drives a REAL overlay render, and the export
    finalize INSERT requires the head profile schema (e.g. v025's
    final_videos.slowmo_section_start/end). A /dotask container pulls the user's DB
    from R2 at whatever version R2 holds and does not otherwise migrate on startup,
    so a behind-head profile.sqlite makes the render throw a schema error BEFORE the
    durable boundary — masking the very thing the test checks (the render dies with a
    plain `error`, never a `sync_failed`).

    This migrates ONLY the current user's current profile to head by calling the SAME
    run_user_seam/run_profile_seam a real request hits on first access (T5083/T5085,
    hardened by T8190) — reproducing, in the container, exactly what JIT does in prod.
    T5087 retired the bulk-sweep primitives (_migrate_user_db/_migrate_profile_db) this
    used to call directly; run_user_seam/run_profile_seam already retry wal_busy and a
    CAS-refused sync once, so this is a strict upgrade, not a shortcut. Non-prod only
    (gated three ways like every seam).

    A genuinely blocked migration raises MigrationBlocked, which the global exception
    handler maps to 503 -- the same outcome a real request hitting the seam gets.

    Clears `_seam_verified` for this profile FIRST (review finding): otherwise a repeat
    call within the same process — e.g. after `/api/test/simulate-machine-cycle`, which
    does not touch `_seam_verified` — would see the pair already marked verified and
    return without touching the DB at all, silently reporting `ok` against whatever
    version happens to be on disk. The response reports the ACTUAL observed schema
    version after the call, not a hard-coded 'ok', so a caller can tell a genuine
    no-further-work-needed result from a seam that quietly did nothing.

    Call with the sync fault CLEARED: this does its own durable R2 upload+verify, which a
    forced FORCE_R2_SYNC_FAILURE would short-circuit to failure."""
    _require_seams_enabled()

    import asyncio

    from ..database import USER_DATA_BASE
    from ..migrations import (
        PROFILE_DB_RUNNER,
        _clear_seam_verified,
        _read_sqlite_user_version,
        run_profile_seam,
        run_user_seam,
    )

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    _clear_seam_verified(user_id)

    # Blocking (R2 round-trips + sqlite) — offload off the event loop, mirroring
    # every other seam caller.
    await asyncio.to_thread(run_user_seam, user_id)
    await asyncio.to_thread(run_profile_seam, user_id, profile_id)

    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    head = PROFILE_DB_RUNNER.latest_version
    version = await asyncio.to_thread(_read_sqlite_user_version, db_path)

    logger.warning(
        f"[TEST] migrate-current-profile user={user_id} profile={profile_id} "
        f"version={version} head={head}"
    )
    return {
        "status": "ok" if version == head else "not_at_head",
        "profile_version": version,
        "head_version": head,
    }


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


def _generate_tiny_mp4(duration: int = 1) -> bytes | None:
    """Render a ~`duration`s faststart MP4 via ffmpeg so a seeded reel/game is
    genuinely playable (metadata + seekable). Returns None if ffmpeg is
    unavailable."""
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "seed.mp4"
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi",
                    "-i", f"color=c=blue:s=180x320:d={duration}:r=15",
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


# --- T5710: seed a both-layer recap game (test seam) -------------------------

class SeedRecapGameRequest(BaseModel):
    name: str = "T5710 Seed Game"
    athlete_clips: int = 2
    team_clips: int = 2
    stitch: bool = True  # also run ensure_recap for both layers + set recap_video_url,
                          # so the game card's "Watch recap" entry (gated on
                          # recap_video_url) is discoverable through the real UI.


@router.post("/seed-recap-game")
async def seed_recap_game(req: SeedRecapGameRequest):
    """Seed a game with rated clips on BOTH layers, for T5710 e2e verification
    (test seam). Uploads a real tiny MP4 as the global `games/{hash}.mp4` source
    long enough to cover every seeded clip, then (if `stitch`) runs the REAL
    `ensure_recap(game_id, layer)` for both layers so the game exits with actual
    stitched per-layer recaps + `games.recap_video_url` set (matching what
    auto-export would eventually produce). Non-prod only (gated three ways like
    every seam)."""
    _require_seams_enabled()

    import hashlib
    import time

    from ..constants import RecapLayer
    from ..database import get_db_connection
    from ..profile_context import get_current_profile_id
    from ..storage import R2_ENABLED, upload_bytes_to_r2_global
    from ..user_context import get_current_user_id
    from ..utils.encoding import encode_data

    # T5710: each clip gets an 8s window (not 1s) so a real e2e run -- which
    # spends several real wall-clock seconds on sequential Playwright
    # assertions (chip visibility, filter clicks, Create Clip) -- can't have
    # the stitched video's autoplay drift onto the NEXT clip mid-assertion.
    # A 1s-per-clip video reliably caused exactly that: the "active" clip
    # (and therefore Create Clip's target + the NotesOverlay/transport label)
    # would silently move on before the test finished checking the one it
    # just clicked.
    CLIP_SECONDS = 8
    total_clips = req.athlete_clips + req.team_clips
    data = _generate_tiny_mp4(duration=max(total_clips, 1) * CLIP_SECONDS)
    video_hash = hashlib.sha256(
        (data or b"") + str(time.time()).encode()
    ).hexdigest()[:32]
    media_uploaded = False
    if data and R2_ENABLED:
        media_uploaded = upload_bytes_to_r2_global(f"games/{video_hash}.mp4", data)

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            (req.name, video_hash),
        )
        game_id = cur.lastrowid
        cur.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, 1)",
            (game_id, video_hash),
        )

        athlete_ids, team_ids = [], []
        offset = 0.0
        for i in range(req.athlete_clips):
            cur.execute(
                """INSERT INTO raw_clips (game_id, filename, name, rating,
                                           start_time, end_time, video_sequence, my_athlete)
                   VALUES (?, '', ?, 4, ?, ?, 1, 1)""",
                (game_id, f"Athlete clip {i+1}", offset, offset + CLIP_SECONDS),
            )
            athlete_ids.append(cur.lastrowid)
            offset += CLIP_SECONDS
        for i in range(req.team_clips):
            cur.execute(
                """INSERT INTO raw_clips (game_id, filename, name, rating,
                                           start_time, end_time, video_sequence,
                                           my_athlete, tagged_teammates)
                   VALUES (?, '', ?, 4, ?, ?, 1, 0, ?)""",
                (game_id, f"Team clip {i+1}", offset, offset + CLIP_SECONDS,
                 encode_data([f"Player {i+1}"])),
            )
            team_ids.append(cur.lastrowid)
            offset += CLIP_SECONDS
        conn.commit()

    stitched = {}
    if req.stitch and media_uploaded:
        from ..services.auto_export import ensure_recap

        user_id = get_current_user_id()
        profile_id = get_current_profile_id()
        for layer in (RecapLayer.TEAM, RecapLayer.ATHLETE):
            try:
                stitched[layer.value] = ensure_recap(user_id, profile_id, game_id, layer)
            except Exception as e:
                logger.warning(f"[TEST] seed-recap-game stitch failed for layer={layer}: {e}")
                stitched[layer.value] = {"status": "failed", "error": str(e)}

        athlete_result = stitched.get(RecapLayer.ATHLETE.value)
        if athlete_result and athlete_result.get("status") in ("present", "stitched"):
            with get_db_connection() as conn:
                conn.execute(
                    "UPDATE games SET auto_export_status = 'complete', recap_video_url = ? WHERE id = ?",
                    (athlete_result["recap_key"], game_id),
                )
                conn.commit()

    logger.warning(
        f"[TEST] seeded recap game id={game_id} name={req.name!r} "
        f"athlete_clips={athlete_ids} team_clips={team_ids} media={media_uploaded} "
        f"stitched={stitched}"
    )
    return {
        "status": "ok",
        "game_id": game_id,
        "athlete_clip_ids": athlete_ids,
        "team_clip_ids": team_ids,
        "media_uploaded": media_uploaded,
        "stitched": stitched,
    }


# --- T6200: concurrency / event-loop-serialization probe (test seam) ---------
# Reproduces the "N concurrent requests all take the same time and finish
# together" signature under the SAME single-worker uvicorn config prod runs.
# Each mode performs a controlled `ms`-long unit of work, differing ONLY in how
# it interacts with the asyncio event loop:
#   block  -> time.sleep(ms)                 blocking work INSIDE an async def
#             (mirrors validate_session's psycopg2 call + the async handlers'
#              synchronous sqlite cursor.execute/fetchall, all run on the loop)
#   async  -> await asyncio.sleep(ms)        properly yields the loop
#   thread -> await asyncio.to_thread(sleep)  offloaded to the default executor
#             (mirrors the proposed fix; executor is min(32, cpu+4) threads)
# Fire N concurrent of each and compare per-request wall time (see
# scripts/concurrency_probe.py). Linear scaling in `block` + flat in `async`
# is the proof that blocking-on-the-loop is what serializes concurrent requests.
# Prod-inert: test-seams router is only mounted in non-prod, and the handler
# re-asserts the gate.
@router.get("/loop-probe")
async def loop_probe(mode: str = "block", ms: int = 200):
    """Controlled event-loop workload for the T6200 concurrency probe."""
    _require_seams_enabled()
    import asyncio
    import time

    ms = max(0, min(ms, 10_000))  # clamp; never let a stray call wedge the loop
    seconds = ms / 1000.0
    t0 = time.perf_counter()
    if mode == "async":
        await asyncio.sleep(seconds)
    elif mode == "thread":
        await asyncio.to_thread(time.sleep, seconds)
    else:  # "block" (default): synchronous sleep ON the event loop
        mode = "block"
        time.sleep(seconds)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    return {"mode": mode, "requested_ms": ms, "worked_ms": elapsed_ms}


# --- T5180: rich-text engine PARITY seam (test seam) --------------------------
# Bridges the Playwright parity spec (T5180-text-parity.spec.js) to the SAME
# render_text_layer() the backend pytest suite (test_t5180_text_render.py)
# exercises directly, so the two suites can't drift on "what counts as the
# bbox." Design: docs/plans/tasks/T5180-design.md §8. Gated exactly like every
# other /api/test/* seam (mounted only when _test_seams_enabled(); 404 on
# prod/staging).

class RenderTextBboxRequest(BaseModel):
    spec: dict
    frame_w: int
    frame_h: int


def _tight_alpha_bbox(img):
    """(min_x, min_y, max_x, max_y) of non-transparent pixels, or None if fully
    transparent. Computed the SAME way tests/test_t5180_text_render.py's
    _tight_alpha_bbox does (numpy min/max of nonzero alpha), so this seam and
    the backend pytest suite can't drift on the bbox definition."""
    import numpy as np

    alpha = np.array(img)[:, :, 3]
    ys, xs = np.nonzero(alpha > 0)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


@router.post("/render-text-bbox")
async def render_text_bbox(req: RenderTextBboxRequest):
    """Render a TextSpec through the real backend renderer and return the
    measurements the Playwright parity spec compares against RichText.jsx's
    DOM measurements (test seam, T5180).

    The given spec is rendered AS GIVEN, and its tight alpha bbox + baseline
    are always returned. The parity spec sends either a pure fill-only spec,
    a shadow-only spec, or a stroke-only spec (never a mix) — so:
      - when spec.shadow.blur > 0: also render a fill-only variant (shadow
        zeroed) and return shadow_halo_bbox = the given (shadow-inclusive)
        render's bbox, which is larger due to the halo.
      - when spec.stroke.width > 0: also render a fill-only variant (stroke
        zeroed) and return stroke_extent_px = given bbox width - fill-only
        bbox width.
      - otherwise both are null.
    """
    _require_seams_enabled()

    from ..schemas import TextSpec
    from ..services.text_render import render_text_layer

    spec = TextSpec(**req.spec)
    img = render_text_layer(spec, req.frame_w, req.frame_h)
    given_bbox = _tight_alpha_bbox(img)
    if given_bbox is None:
        raise HTTPException(status_code=422, detail="render produced a fully transparent layer")
    # `bbox` returned to the caller is always the FILL-ONLY box (design §8 — box/
    # baseline parity must never be inflated by a shadow halo). When the given spec
    # carries a shadow/stroke, it is recomputed below from a zeroed variant;
    # otherwise the given render already IS the fill-only one.
    bbox = given_bbox

    # Baseline = block top (position.y * frame_h) + the resolved font's ascent,
    # in pixels — computed the same way TestLineHeightFromFaceMetrics /
    # TestAlignment in test_t5180_text_render.py reason about line placement
    # (font.getmetrics() ascent, never a hard-coded multiplier). Uses the same
    # variable-axis-pinning loader as the real renderer (load_font_for_render)
    # so a variable face's ascent is measured at its PINNED weight, not the
    # font's own default instance.
    from ..services.fonts import load_font_for_render

    px = max(round(spec.size * req.frame_h), 1)
    font = load_font_for_render(spec.font.value, px)
    ascent, _descent = font.getmetrics()
    baseline_y = spec.position.y * req.frame_h + ascent

    shadow_halo_bbox = None
    stroke_extent_px = None

    if spec.shadow.blur > 0:
        fill_variant = spec.model_copy(
            update={"shadow": spec.shadow.model_copy(update={"blur": 0, "opacity": 0})}
        )
        fill_img = render_text_layer(fill_variant, req.frame_w, req.frame_h)
        fill_bbox = _tight_alpha_bbox(fill_img)
        if fill_bbox is not None:
            shadow_halo_bbox = list(given_bbox)
            bbox = fill_bbox

    if spec.stroke.width > 0:
        fill_variant = spec.model_copy(
            update={"stroke": spec.stroke.model_copy(update={"width": 0})}
        )
        fill_img = render_text_layer(fill_variant, req.frame_w, req.frame_h)
        fill_bbox = _tight_alpha_bbox(fill_img)
        if fill_bbox is not None:
            given_width = given_bbox[2] - given_bbox[0]
            fill_width = fill_bbox[2] - fill_bbox[0]
            stroke_extent_px = given_width - fill_width
            bbox = fill_bbox

    return {
        "bbox": list(bbox),
        "baseline_y": baseline_y,
        "shadow_halo_bbox": shadow_halo_bbox,
        "stroke_extent_px": stroke_extent_px,
    }
