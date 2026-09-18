"""
Export Jobs Router - Durable export job management.

This router provides endpoints for starting, monitoring, and managing
background export jobs. Exports run asynchronously and persist their
state to the database, allowing users to close their browser and
return later to find completed exports.

Key design principles:
- Jobs are durable (survive browser close, page refresh)
- Progress is ephemeral (WebSocket only, not stored in DB)
- Only state transitions are persisted (pending -> processing -> complete/error)
"""

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path

import anyio.to_thread
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..analytics import record_milestone
from ..constants import ExportStatus
from ..database import get_db_connection, get_user_data_path
from ..highlight_transform import round_credits_half_up
from ..profile_context import get_current_profile_id
from ..services import export_job_repository
from ..storage import file_exists_in_r2
from ..user_context import get_current_user_id
from ..utils.encoding import encode_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/exports", tags=["exports"])


def get_export_staging_path() -> Path:
    """Get the staging directory for export input files."""
    path = get_user_data_path() / "export_staging"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _has_stage_columns(conn) -> bool:
    """T5630: export_jobs.stage/output_key may be absent during the deploy->v028
    window (versioned migrations do not auto-run). Hot reads must tolerate a
    below-head profile DB — probe the columns before naming them in a SELECT so a
    still-un-migrated profile does not 500. (PRAGMA rows are tuples: index r[1].)"""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(export_jobs)").fetchall()}
    return "stage" in cols and "output_key" in cols


# ============================================================================
# Pydantic Models
# ============================================================================

class ExportJobCreate(BaseModel):
    """Request model for creating an export job."""
    project_id: int
    type: str  # 'framing' | 'overlay' | 'multi_clip'
    config: dict  # Export configuration (clips, keyframes, etc.)


class ExportJobResponse(BaseModel):
    """Response model for export job status."""
    job_id: str
    project_id: int | None = None
    project_name: str | None = None
    type: str
    status: str  # 'pending' | 'processing' | 'complete' | 'error'
    error: str | None = None
    output_video_id: int | None = None
    output_filename: str | None = None
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    # T12: Annotate exports use game_id instead of project_id
    game_id: int | None = None
    game_name: str | None = None
    # T5630: durable finalize stage (payload-only hook for a future progress panel;
    # None on a below-head profile DB during the deploy->v028 window).
    stage: str | None = None


class ExportJobListResponse(BaseModel):
    """Response model for listing exports."""
    exports: list[ExportJobResponse]


# ============================================================================
# Database Operations
# ============================================================================

def create_export_job(project_id: int, job_type: str, config: dict) -> str:
    """Create a new export job in the database. Returns job_id."""
    job_id = f"export_{uuid.uuid4().hex[:12]}"
    input_data = encode_data(config)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        export_job_repository.create(cursor, job_id=job_id, project_id=project_id, job_type=job_type, input_data=input_data)
        conn.commit()

    return job_id


def get_export_job(job_id: str) -> dict | None:
    """Get an export job by ID, including project name."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        extra = ", e.stage, e.output_key" if _has_stage_columns(conn) else ""
        cursor.execute(f"""
            SELECT e.id, e.project_id, p.name as project_name,
                   e.type, e.status, e.error, e.input_data,
                   e.output_video_id, e.output_filename, e.modal_call_id,
                   e.created_at, e.started_at, e.completed_at{extra}
            FROM export_jobs e
            LEFT JOIN projects p ON e.project_id = p.id
            WHERE e.id = ?
        """, (job_id,))
        row = cursor.fetchone()
        if row:
            d = dict(row)
            d.setdefault("stage", None)
            d.setdefault("output_key", None)
            return d
    return None


def get_project_exports(project_id: int) -> list[dict]:
    """Get all exports for a project, ordered by creation time desc."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        extra = ", stage" if _has_stage_columns(conn) else ""
        cursor.execute(f"""
            SELECT id, project_id, type, status, error,
                   output_video_id, output_filename,
                   created_at, started_at, completed_at{extra}
            FROM export_jobs
            WHERE project_id = ?
            ORDER BY created_at DESC
        """, (project_id,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def update_job_started(job_id: str):
    """Mark job as processing (started)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        export_job_repository.start(cursor, job_id)
        conn.commit()


def update_job_complete(job_id: str, output_video_id: int, output_filename: str):
    """Mark job as complete with output references."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        export_job_repository.complete(cursor, job_id, output_video_id=output_video_id, output_filename=output_filename)
        conn.commit()


def update_job_error(job_id: str, error_message: str):
    """Mark job as failed with error message, and refund what it charged.

    T10360: every caller of this is a RECOVERY path (`/modal-status`,
    `resume-progress`) -- by construction the process that reserved the credits is
    gone, so its own refund handler never ran. The refund is idempotent with that
    handler, so a job that somehow got both is still only refunded once.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        export_job_repository.fail(cursor, job_id, error_message)
        conn.commit()
    from ..services.export_helpers import refund_failed_export
    refund_failed_export(job_id)


def delete_export_job(job_id: str) -> bool:
    """Delete an export job. Returns True if deleted."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM export_jobs WHERE id = ?", (job_id,))
        conn.commit()
        return cursor.rowcount > 0


async def finalize_modal_export(job: dict, modal_result: dict, user_id: str) -> dict:
    """
    Finalize a Modal export discovered complete during recovery (thin adapter).

    T5630: recovery now runs the SAME unified finalize_export as a normal in-band
    export — detect -> persist -> sync — so a restart-interrupted export recovers
    into FULL overlay data (highlights + detections), not the old lossy minimal
    working_videos row that skipped detection (the Brilliant-Control incident).

    output_key comes from the persisted 'rendered' checkpoint
    (export_jobs.output_key). For pre-v028 jobs that never persisted it, fall back
    to modal_result.output_key (the transitional path). A truly-empty output_key
    still fails loudly inside finalize_export (T4240: never fabricate a filename).

    Args:
        job: The export_jobs record (from get_export_job — carries stage/output_key/input_data).
        modal_result: The result dict from Modal (gpu_seconds/modal_function/fallback output_key).
        user_id: The user's ID for R2 paths.

    Returns:
        Dict with finalization result (finalized/working_video_id/output_filename/error).
    """
    from ..profile_context import get_current_profile_id
    from ..services.export_finalize import finalize_export

    # Prefer the durably-persisted render key; fall back to the Modal result for
    # jobs that predate the output_key checkpoint (deploy->v028 window).
    output_key = job.get('output_key') or modal_result.get('output_key', '')
    profile_id = get_current_profile_id()

    result = await finalize_export(
        job,
        output_key=output_key,
        user_id=user_id,
        profile_id=profile_id,
        gpu_seconds=modal_result.get('gpu_seconds'),
        modal_function=modal_result.get('modal_function'),
    )

    # Record the recovery milestone only for a fresh finalize (not an idempotent
    # no-op on an already-complete job) — preserves the pre-T5630 recovery signal.
    if result.get('finalized') and not result.get('already_finalized'):
        record_milestone(user_id, "export_completed", {"export_id": job['id'], "type": "recovered"})
        logger.info(f"[ExportJobs] Finalized recovered export {job['id']}: working_video_id={result.get('working_video_id')}")

    return result


def check_modal_job_running(modal_call_id: str) -> bool | None:
    """Check if a Modal job is still running using its call_id.

    Three-state (T4240):
    - True  -> still running (queued or executing).
    - False -> definitively not running: Modal recorded a TERMINAL input status.
    - None  -> UNKNOWN: Modal is unavailable, the API/transport errored, or the
      input record aged out. Callers MUST NOT treat None as "dead" -- killing a
      paid job requires positive evidence. A transient Modal API hiccup previously
      returned False here and let cleanup_stale_exports mark live jobs error.

    **T10360 -- this asks Modal a DIFFERENT question than it used to, because the
    old one had no answer.** It used to call `FunctionCall.get(timeout=0)`, which
    reads the OUTPUT store. Every `modal_call_id` we persist comes from
    `process_clips_ai`, a generator invoked via `remote_gen` (framing/overlay
    capture no id at all) -- and a generator's only output is a `GeneratorDone`
    marker that the in-band consumer EXPIRES as it reads it (`clear_on_success`),
    so a second process asking for it gets `NotFoundError` every time, whether the
    render succeeded, failed, or is still going. That made this function a constant
    `None` for every job in the database and the entire recovery mechanism inert.
    Verified against the 2026-09-18 incident's own call id.

    `get_call_graph()` reads the INPUT record instead, which is not consumed and is
    still queryable hours later (same verification). It fails safe: an unrecognised
    future status maps to PENDING (`InputStatus._missing_`), and an aged-out record
    comes back `[]`, which we report as UNKNOWN.

    **`False` DOES NOT MEAN FAILURE.** A generator that finished perfectly also
    records SUCCESS, and `process_clips_ai` catches its own errors and yields
    `{"status": "error"}` before returning normally -- so SUCCESS covers both.
    Any caller that turns `False` into a failed job MUST first check whether the
    render object landed in R2. Use `reconcile_dispatched_export` below, which
    enforces that ordering, instead of calling this directly.
    """
    try:
        import modal
        from modal.call_graph import InputStatus
    except ImportError:
        return None  # Modal not available -> can't know

    try:
        call = modal.FunctionCall.from_id(modal_call_id)
    except Exception:
        logger.warning(f"[ExportJobs] Modal lookup failed for call {modal_call_id}; status unknown", exc_info=True)
        return None  # API error looking up the call -> unknown

    try:
        graph = call.get_call_graph()
    except Exception:
        logger.warning(f"[ExportJobs] Modal status check errored for call {modal_call_id}; status unknown", exc_info=True)
        return None

    info = next((i for i in graph if i.function_call_id == modal_call_id), None)
    if info is None:
        # Empty graph = input retention expired. Not evidence of death.
        logger.info(f"[ExportJobs] Modal has no input record for call {modal_call_id}; status unknown")
        return None
    # PENDING = queued or executing (and the bucket any unrecognised future status
    # falls into). Everything else is terminal: SUCCESS / FAILURE / TIMEOUT /
    # TERMINATED / INIT_FAILURE.
    return info.status == InputStatus.PENDING


def reconcile_dispatched_export(job: dict) -> str:
    """What REALLY became of a dispatched export, for the recovery paths whose own
    render process is gone. Returns one of:

    - `rendered` -> the render object is in R2. Finalize it.
    - `running`  -> Modal says the input is still PENDING. Leave it alone.
    - `dead`     -> Modal recorded a terminal status AND nothing landed in R2.
    - `unknown`  -> we cannot tell. Leave it alone; only the age backstop in
      `cleanup_stale_exports` may end this state.

    **R2 is checked FIRST, deliberately, and its verdict outranks anything Modal
    says.** `output_key` is written in the same UPDATE as `modal_call_id` at
    DISPATCH time (T7210), so the COLUMN proves nothing -- but the OBJECT proves
    the render finished and uploaded, which is the only fact that survives losing
    the process that was watching. It is unambiguous per job: the key carries a
    per-dispatch uuid and Modal writes it with a single final PUT. Asking Modal
    first would invert the incident's own lesson, since a finished generator call
    reports the same terminal status as a dead one (see `check_modal_job_running`)
    -- a Modal-first order refunds users for reels that exist.

    Blocking (an R2 HEAD plus a Modal control-plane round-trip); async callers must
    offload it (T7040).
    """
    output_key = job.get('output_key')
    if output_key and file_exists_in_r2(get_current_user_id(), output_key):
        return 'rendered'

    modal_call_id = job.get('modal_call_id')
    if not modal_call_id:
        # Never dispatched, or dispatched before the id was persisted. No evidence
        # either way, which is not a licence to kill the job.
        return 'unknown'

    running = check_modal_job_running(modal_call_id)
    if running:
        return 'running'
    if running is None:
        return 'unknown'
    if not output_key:
        # Modal says terminal, but with no output_key there was no R2 probe to
        # answer "terminal HOW?" -- and a SUCCESSFUL generator reports terminal too.
        # A pre-v028 job, or rolling-deploy skew hiding the column. Not provably
        # dead, so not killed here; the age backstop still terminates it.
        return 'unknown'
    return 'dead'


# T10360: how long a job whose Modal status we can NEVER resolve is allowed to
# sit at 'processing' before the sweep declares it dead. Must clear the longest
# real render: `process_clips_ai` carries a Modal timeout of 3600s (1h), plus
# queue time, so 3h is ~3x the ceiling. Only ever applied to a job with NO render
# object in R2 -- a finished render is delivered regardless of age.
UNKNOWN_MODAL_GIVEUP_MINUTES = 180


def cleanup_stale_exports(max_age_minutes: int = 60):
    """Mark exports that have been processing too long as stale/error.

    This prevents orphaned exports from accumulating if:
    - Server crashed during processing
    - User navigated away and export errored silently
    - Network issues prevented completion update

    IMPORTANT: For jobs with modal_call_id, we check Modal status first.
    Modal jobs can run for 40+ minutes, so we don't mark them stale
    if Modal says they're still running.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # First, get potentially stale jobs (older than max_age_minutes)
        stale_candidates = export_job_repository.get_stale_candidates(cursor, max_age_minutes)

        if not stale_candidates:
            return

        # Check each candidate - only mark stale if Modal job is NOT running
        swept: list[str] = []
        still_running_count = 0
        unknown_count = 0
        delivered_count = 0

        for row in stale_candidates:
            job_id = row['id']
            verdict = reconcile_dispatched_export(dict(row))

            if verdict == 'rendered':
                # The render FINISHED -- there is a reel to hand over. Keep the job
                # active so `/modal-status` finalizes it. Failing it here would
                # refund the user and silently bin a video they paid for and which
                # exists: the 2026-09-18 incident, just 60 minutes later.
                delivered_count += 1
                logger.info(
                    f"[ExportJobs] Job {job_id} is stale but its render IS in R2 "
                    f"({row['output_key']}) -- leaving active to finalize"
                )
                continue

            if verdict == 'running':
                still_running_count += 1
                logger.info(f"[ExportJobs] Job {job_id} still running on Modal, not marking stale")
                continue

            if verdict == 'unknown':
                if (row['age_minutes'] or 0) < UNKNOWN_MODAL_GIVEUP_MINUTES:
                    # T4240: never mark a paid job error on a hunch -- re-check next sweep.
                    unknown_count += 1
                    logger.info(f"[ExportJobs] Job {job_id} Modal status unknown, skipping this sweep")
                    continue
                # T10360: but UNKNOWN must not be permanent. It can repeat on every
                # sweep (expired input record, Modal down), so "re-check next time"
                # need not converge -- and a job pinned at 'processing' forever blocks
                # its project from EVER being re-exported (409 export_in_flight from
                # insert_export_job_if_none_active) and never returns the credits.
                # Past the give-up age with nothing in R2, it is dead regardless.
                logger.warning(
                    f"[ExportJobs] Job {job_id} Modal status still unknown after "
                    f"{row['age_minutes']:.0f}min and no render in R2 -- giving up"
                )

            # 'dead', or an unknowable one we have given up on. Either way the render
            # produced nothing, so the user owes nothing for it.
            export_job_repository.fail(cursor, job_id, 'Export timed out (stale)')
            swept.append(job_id)

        conn.commit()

        if swept:
            logger.warning(f"[ExportJobs] Cleaned up {len(swept)} stale exports")
        if delivered_count > 0:
            logger.info(f"[ExportJobs] {delivered_count} stale exports have a finished render in R2, left to finalize")
        if still_running_count > 0:
            logger.info(f"[ExportJobs] {still_running_count} exports still running on Modal")
        if unknown_count > 0:
            logger.info(f"[ExportJobs] {unknown_count} exports had unknown Modal status, left untouched for next sweep")

    # T10360: a swept job was paid for and produced nothing -- refund it. Runs
    # AFTER the commit and OUTSIDE the connection block: the credit ledger is
    # Postgres, so it must not ride inside the per-user SQLite write transaction.
    from ..services.export_helpers import refund_failed_export
    for job_id in swept:
        refund_failed_export(job_id)


def get_active_exports() -> list[dict]:
    """Get all currently active (pending or processing) exports.

    Also cleans up stale exports that have been processing too long.
    60 minutes is chosen because Modal jobs can run 40+ minutes for large exports.
    """
    # Clean up stale exports first (increased from 15 to 60 minutes for Modal jobs)
    cleanup_stale_exports(max_age_minutes=60)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # T12: Include game_id and game_name for annotate exports
        extra = ", e.stage" if _has_stage_columns(conn) else ""
        cursor.execute(f"""
            SELECT e.id, e.project_id, p.name as project_name, e.type, e.status, e.error,
                   e.output_video_id, e.output_filename,
                   e.created_at, e.started_at, e.completed_at,
                   e.game_id, e.game_name{extra}
            FROM export_jobs e
            LEFT JOIN projects p ON e.project_id = p.id
            WHERE e.status IN ('pending', 'processing')
            ORDER BY e.created_at DESC
        """)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_recent_exports(hours: int = 24) -> list[dict]:
    """Get exports from the last N hours."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # SQLite datetime comparison
        extra = ", stage" if _has_stage_columns(conn) else ""
        cursor.execute(f"""
            SELECT id, project_id, type, status, error,
                   output_video_id, output_filename,
                   created_at, started_at, completed_at{extra}
            FROM export_jobs
            WHERE created_at >= datetime('now', ? || ' hours')
            ORDER BY created_at DESC
        """, (f'-{hours}',))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_exports_by_status(statuses: list[str]) -> list[dict]:
    """Get exports filtered by status list."""
    if not statuses:
        return []

    with get_db_connection() as conn:
        cursor = conn.cursor()
        placeholders = ','.join(['?' for _ in statuses])
        extra = ", stage" if _has_stage_columns(conn) else ""
        cursor.execute(f"""
            SELECT id, project_id, type, status, error,
                   output_video_id, output_filename,
                   created_at, started_at, completed_at{extra}
            FROM export_jobs
            WHERE status IN ({placeholders})
            ORDER BY created_at DESC
        """, statuses)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


# ============================================================================
# API Endpoints
# ============================================================================

@router.post("", response_model=dict)
async def start_export(
    request: ExportJobCreate,
    background_tasks: BackgroundTasks
):
    """
    Start a new export job (JSON config only, no file upload).

    Use this for exports where the video is already on the server
    (e.g., working_video_id reference).

    The job is created immediately and processing begins in the background.
    Returns the job_id which can be used to:
    - Connect to WebSocket for real-time progress
    - Poll GET /exports/{job_id} for status
    """
    from ..services.export_worker import process_export_job

    # Validate project exists
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (request.project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

    # Create job in database
    job_id = create_export_job(request.project_id, request.type, request.config)
    record_milestone(get_current_user_id(), "export_started", {"export_id": job_id, "type": request.type})

    # Start background processing
    background_tasks.add_task(process_export_job, job_id)

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Export job created"
    }


@router.post("/framing", response_model=dict)
async def start_framing_export(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    project_id: int = Form(...),
    keyframes_json: str = Form(...),
    target_fps: int = Form(30),
    export_mode: str = Form("quality"),
    segment_data_json: str = Form(None),
    include_audio: str = Form("true"),
):
    """
    Start a framing export job with video file upload.

    This is the async version of /api/export/upscale. The video is
    staged to disk and processing happens in the background.

    Returns job_id immediately - use WebSocket or polling for progress.
    """
    from ..services.export_worker import process_export_job

    # Validate project exists
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # T8310: refuse up front if any source game for this project's clips has
        # been reclaimed, rather than staging/reserving credits and failing
        # mid-pipeline. Reuses the same gate as the clip playback seams.
        from app.routers.games import assert_clip_source_available
        cursor.execute("""
            SELECT DISTINCT g.id AS game_id,
                   COALESCE(gv.blake3_hash, g.blake3_hash) AS blake3_hash,
                   g.auto_export_status
            FROM working_clips wc
            JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            JOIN games g ON rc.game_id = g.id
            LEFT JOIN game_videos gv
                ON gv.game_id = rc.game_id
                AND gv.sequence = COALESCE(rc.video_sequence, 1)
            WHERE wc.project_id = ? AND wc.raw_clip_id IS NOT NULL
        """, (project_id,))
        for src in cursor.fetchall():
            assert_clip_source_available(
                cursor,
                game_id=src['game_id'],
                blake3_hash=src['blake3_hash'],
                auto_export_status=src['auto_export_status'],
            )

    # Parse keyframes
    try:
        keyframes = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {e}") from e

    if not keyframes:
        raise HTTPException(status_code=400, detail="No keyframes provided")

    # Parse segment data
    segment_data = None
    if segment_data_json:
        try:
            segment_data = json.loads(segment_data_json)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid segment data JSON: {e}") from e

    # Generate job ID
    job_id = f"export_{uuid.uuid4().hex[:12]}"

    # Stage the video file
    staging_dir = get_export_staging_path()
    video_ext = Path(video.filename).suffix or '.mp4'
    staged_video_path = staging_dir / f"{job_id}{video_ext}"

    try:
        with open(staged_video_path, 'wb') as f:
            content = await video.read()
            f.write(content)
        logger.info(f"[Exports] Staged video for job {job_id}: {staged_video_path}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stage video: {e}") from e

    # T890: Credit reservation — reserve before job creation, confirm after
    from ..services.credit_ledger import CreditsUnavailable, confirm_reservation, release_reservation, reserve_credits
    from ..services.ffmpeg_service import get_video_duration

    user_id = get_current_user_id()
    video_seconds = get_video_duration(str(staged_video_path))
    # T9750: round-half-up + 1-credit floor via the SAME shared helper the
    # framing/multi-clip charge sites use (highlight_transform.compute_export_credits),
    # so both charge sites state ONE rounding rule. Was math.ceil(video_seconds).
    credits_required = round_credits_half_up(video_seconds)
    credits_deducted = 0

    # Step 1: Reserve credits (atomic in Postgres)
    if credits_required > 0:
        try:
            result = reserve_credits(
                user_id, credits_required, job_id, video_seconds,
                profile_id=get_current_profile_id(),
            )
        except CreditsUnavailable:
            staged_video_path.unlink(missing_ok=True)
            raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
        if not result["success"]:
            staged_video_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_credits",
                    "required": credits_required,
                    "available": result["balance"],
                    "video_seconds": video_seconds,
                },
            )
        credits_deducted = credits_required

    # Build config
    config = {
        "video_path": str(staged_video_path),
        "keyframes": keyframes,
        "target_fps": target_fps,
        "export_mode": export_mode,
        "segment_data": segment_data,
        "include_audio": include_audio.lower() == "true",
        "credits_deducted": credits_deducted,
        "video_seconds": video_seconds,
        "credit_user_id": user_id,
        "profile_id": get_current_profile_id(),
    }

    # Step 2: Create job in database (atomic in profile.sqlite)
    input_data = encode_data(config)
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            export_job_repository.create(cursor, job_id=job_id, project_id=project_id, job_type='framing', input_data=input_data)
            conn.commit()

        # Step 3: Confirm reservation (atomic in user.sqlite)
        if credits_deducted > 0:
            confirm_reservation(user_id, job_id)
    except Exception:
        # Job creation failed — release the reservation
        if credits_deducted > 0:
            release_reservation(user_id, job_id)
        raise

    logger.info(f"[Exports] Created framing job {job_id} for project {project_id}")

    # Start background processing
    background_tasks.add_task(process_export_job, job_id)

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Framing export started"
    }



# ============================================================================
# Global Export Discovery Endpoints (for recovery on page load)
# ============================================================================

@router.get("/active", response_model=ExportJobListResponse)
async def list_active_exports():
    """
    Get all currently active (pending or processing) exports.

    Use this on app startup to:
    - Discover exports that are still running
    - Reconnect WebSocket connections for progress tracking
    - Recover export tracking state after page refresh
    """
    # T7040: get_active_exports() runs cleanup_stale_exports(), which for every
    # stale job with a modal_call_id makes a BLOCKING Modal control-plane
    # round-trip (check_modal_job_running -> call.get) in a sequential loop.
    # Run inline on the event loop, that froze uvicorn's single worker for the
    # whole sweep (observed 31s), starving every OTHER concurrent request on the
    # machine -- a collection download racing this call died client-side with a
    # bare "TypeError: Failed to fetch". Offload the whole blocking chain to a
    # worker thread so the event loop stays responsive. anyio copies the request
    # contextvars (user/profile) into the thread, so get_db_connection() still
    # resolves the caller's per-user DB.
    exports = await anyio.to_thread.run_sync(get_active_exports)

    return ExportJobListResponse(
        exports=[
            ExportJobResponse(
                job_id=e['id'],
                project_id=e['project_id'],
                project_name=e.get('project_name'),
                type=e['type'],
                status=e['status'],
                error=e['error'],
                output_video_id=e['output_video_id'],
                output_filename=e['output_filename'],
                created_at=e['created_at'],
                started_at=e['started_at'],
                completed_at=e['completed_at'],
                # T12: Include game_id and game_name for annotate exports
                game_id=e.get('game_id'),
                game_name=e.get('game_name'),
                stage=e.get('stage'),
            )
            for e in exports
        ]
    )


@router.get("/recent", response_model=ExportJobListResponse)
async def list_recent_exports(hours: int = Query(default=24, ge=1, le=168)):
    """
    Get exports from the last N hours (default: 24, max: 168/1 week).

    Use this to:
    - Show recent export history
    - Find completed exports that may have been missed
    - Display export activity feed
    """
    exports = get_recent_exports(hours)

    return ExportJobListResponse(
        exports=[
            ExportJobResponse(
                job_id=e['id'],
                project_id=e['project_id'],
                project_name=e.get('project_name'),
                type=e['type'],
                status=e['status'],
                error=e['error'],
                output_video_id=e['output_video_id'],
                output_filename=e['output_filename'],
                created_at=e['created_at'],
                started_at=e['started_at'],
                completed_at=e['completed_at'],
                stage=e.get('stage'),
            )
            for e in exports
        ]
    )


@router.get("/unacknowledged", response_model=ExportJobListResponse)
# T9130: sync def -> anyio threadpool, matching its sibling /active (T7040). Blocking
# get_db_connection() read, no await in the body.
def list_unacknowledged_exports():
    """
    T12: Get exports that completed while user was away (not yet acknowledged).

    Use this on app startup to:
    - Find completed exports that need notifications
    - Show "export finished while you were away" messages

    Only returns exports from the last 24 hours that:
    - Status is 'complete' or 'error'
    - Not yet acknowledged (acknowledged_at is NULL)
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        extra = ", e.stage" if _has_stage_columns(conn) else ""
        cursor.execute(f"""
            SELECT e.id, e.project_id, p.name as project_name, e.type, e.status, e.error,
                   e.output_video_id, e.output_filename,
                   e.created_at, e.started_at, e.completed_at,
                   e.game_id, e.game_name{extra}
            FROM export_jobs e
            LEFT JOIN projects p ON e.project_id = p.id
            WHERE e.status IN ('complete', 'error')
              AND e.acknowledged_at IS NULL
              AND e.completed_at >= datetime('now', '-24 hours')
            ORDER BY e.completed_at DESC
        """)
        rows = cursor.fetchall()
        exports = [dict(row) for row in rows]

    return ExportJobListResponse(
        exports=[
            ExportJobResponse(
                job_id=e['id'],
                project_id=e['project_id'],
                project_name=e.get('project_name'),
                type=e['type'],
                status=e['status'],
                error=e['error'],
                output_video_id=e['output_video_id'],
                output_filename=e['output_filename'],
                created_at=e['created_at'],
                started_at=e['started_at'],
                completed_at=e['completed_at'],
                game_id=e.get('game_id'),
                game_name=e.get('game_name'),
                stage=e.get('stage'),
            )
            for e in exports
        ]
    )


@router.post("/acknowledge")
async def acknowledge_exports(job_ids: list[str] | None = None):
    """
    T12: Mark exports as acknowledged (notification shown).

    Call this after showing completion notifications to prevent
    duplicate notifications on subsequent page loads.

    If job_ids is empty/null, acknowledges all unacknowledged exports.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        acknowledged_count = export_job_repository.acknowledge(cursor, job_ids)
        conn.commit()

    logger.info(f"[ExportJobs] Acknowledged {acknowledged_count} exports")
    return {"acknowledged": acknowledged_count}


@router.get("/{job_id}", response_model=ExportJobResponse)
async def get_export_status(job_id: str):
    """
    Get the status of an export job.

    Use this to check if an export is complete after reconnecting.
    For real-time progress, connect to WebSocket at /ws/export/{job_id}
    """
    job = get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    return ExportJobResponse(
        job_id=job['id'],
        project_id=job['project_id'],
        type=job['type'],
        status=job['status'],
        error=job['error'],
        output_video_id=job['output_video_id'],
        output_filename=job['output_filename'],
        created_at=job['created_at'],
        started_at=job['started_at'],
        completed_at=job['completed_at'],
        stage=job.get('stage'),
    )


@router.get("/{job_id}/modal-status")
async def check_modal_status(job_id: str):
    """
    Check real Modal job status using stored call_id.

    Use this endpoint to verify if a Modal job is still running, has completed,
    or has failed. This is the source of truth for long-running Modal jobs
    when WebSocket connection is lost.

    Returns:
        - status: "not_modal" | "running" | "complete" | "error"
        - result: Modal result dict (if complete)
        - error: Error message (if error)
    """
    job = get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    modal_call_id = job.get('modal_call_id')
    if not modal_call_id:
        # Non-Modal export (local processing) — return actual DB status
        # so frontend can detect completion even without Modal call_id
        if job['status'] == 'complete':
            return {
                "status": ExportStatus.COMPLETE,
                "job_status": job['status'],
                "message": "Local export completed"
            }
        elif job['status'] == 'error':
            return {
                "status": "error",
                "job_status": job['status'],
                "error": job.get('error', 'Unknown error'),
                "message": "Local export failed"
            }
        else:
            return {
                "status": "not_modal",
                "job_status": job['status'],
                "message": "This job does not have a Modal call ID"
            }

    # T10360: this used to ask Modal for the call's OUTPUT (`call.get(timeout=0)`),
    # which for these generator calls always raises NotFoundError -- so the endpoint
    # answered "expired" for EVERY recoverable export and the R2 probe underneath it
    # never once executed in production. `reconcile_dispatched_export` asks the two
    # questions that have answers: is the render in R2, and what does Modal's INPUT
    # record say. See `check_modal_job_running` for why the old one had no answer.
    #
    # Offloaded like GET /active (T7040): the reconciler does a blocking R2 HEAD and
    # a blocking Modal control-plane round-trip, and this is an async handler on
    # uvicorn's single worker.
    try:
        verdict = await anyio.to_thread.run_sync(reconcile_dispatched_export, job)
    except Exception as e:
        logger.error(f"[ExportJobs] Failed to check Modal status for {job_id}: {e}", exc_info=True)
        return {
            "status": "error",
            "error": str(e),
            "message": "Failed to retrieve Modal job"
        }

    if verdict == 'rendered':
        if job['status'] != 'processing':
            return {
                "status": ExportStatus.COMPLETE,
                "job_status": job['status'],
                "message": "Export already finalized"
            }

        logger.info(f"[ExportJobs] Modal job {job_id} completed while user was away, finalizing...")
        # finalize_export's own stage CAS (T7210) settles a race with the in-band
        # finalizer, so nothing needs to be claimed here.
        finalization = await finalize_modal_export(job, {"status": "success"}, get_current_user_id())

        if finalization.get('finalized'):
            return {
                "status": ExportStatus.COMPLETE,
                "result": {"status": "success"},
                "message": "Export recovered and finalized successfully",
                "working_video_id": finalization.get('working_video_id'),
                "output_filename": finalization.get('output_filename'),
                "presigned_url": finalization.get('presigned_url')
            }
        # Modal succeeded but we could not finalize. Do NOT fail the job (and so do
        # not refund it): the render exists and a later poll can still land it.
        logger.warning(f"[ExportJobs] Finalization failed for {job_id}: {finalization.get('error')}")
        return {
            "status": ExportStatus.COMPLETE,
            "result": {"status": "success"},
            "message": "Modal completed but finalization failed",
            "finalization_error": finalization.get('error')
        }

    if verdict == 'dead':
        error_msg = "Modal render finished but produced no output object"
        logger.warning(f"[ExportJobs] {error_msg} for job {job_id}, call {modal_call_id}")
        if job['status'] == 'processing':
            update_job_error(job_id, error_msg)   # refunds
        return {
            "status": "error",
            "error": error_msg,
        }

    # 'running' or 'unknown' -- both mean "do not touch it". UNKNOWN deliberately
    # reports running rather than erroring: only cleanup_stale_exports' age backstop
    # may end an unknowable job, and it refunds when it does.
    if job['status'] == 'error':
        # DB says error but Modal's input is still pending -- a stale verdict from
        # before T10360, or a connection hiccup. Put it back.
        logger.info(f"[ExportJobs] Modal job {job_id} still running but DB shows error - resetting to processing")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            export_job_repository.recover(cursor, job_id)
            conn.commit()

    return {
        "status": "running",
        "message": "Modal job is still processing"
    }


@router.delete("/{job_id}")
async def cancel_export(job_id: str):
    """
    Cancel a pending or processing export job.

    If the job has a Modal call_id, also cancels the Modal job to stop
    GPU usage immediately.
    """
    job = get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job['status'] in ('complete', 'error'):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status '{job['status']}'"
        )

    # Cancel Modal job if it has a call_id (stops GPU usage)
    modal_cancelled = False
    modal_call_id = job.get('modal_call_id')
    if modal_call_id:
        try:
            import modal
            call = modal.FunctionCall.from_id(modal_call_id)
            call.cancel()
            modal_cancelled = True
            logger.info(f"[ExportJobs] Cancelled Modal job {modal_call_id}")
        except Exception as e:
            # Modal cancellation failed, but we still mark DB as cancelled
            logger.warning(f"[ExportJobs] Failed to cancel Modal job {modal_call_id}: {e}")

    # Mark as cancelled in database
    with get_db_connection() as conn:
        cursor = conn.cursor()
        export_job_repository.fail(cursor, job_id, 'Cancelled by user')
        conn.commit()

    logger.info(f"[ExportJobs] Job {job_id} cancelled by user (Modal cancelled: {modal_cancelled})")
    return {"message": "Export job cancelled", "modal_cancelled": modal_cancelled}


# Track which jobs have active progress loops to avoid duplicates
_active_progress_loops = set()


@router.post("/{job_id}/resume-progress")
async def resume_progress(job_id: str, background_tasks: BackgroundTasks):
    """
    Resume progress simulation for a recovered Modal job.

    When a Modal job is recovered after a connection loss, this endpoint
    starts a background task that:
    1. Simulates progress based on elapsed time
    2. Polls Modal periodically to check completion
    3. Sends progress updates via WebSocket
    4. Finalizes the export when Modal completes
    """
    from ..websocket import export_progress, manager

    job = get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job['status'] != 'processing':
        raise HTTPException(status_code=400, detail=f"Job status is '{job['status']}', not 'processing'")

    modal_call_id = job.get('modal_call_id')
    if not modal_call_id:
        raise HTTPException(status_code=400, detail="Job does not have a Modal call ID")

    # Avoid starting duplicate progress loops
    if job_id in _active_progress_loops:
        return {"message": "Progress loop already active", "job_id": job_id}

    _active_progress_loops.add(job_id)

    async def progress_loop():
        """Background task that polls Modal and sends progress updates."""
        import asyncio
        # T10360: no direct Modal use left here -- reconcile_dispatched_export owns
        # the SDK call (and already reports UNKNOWN if the SDK is missing).
        try:
            # Calculate progress based on elapsed time
            # Use UTC consistently since DB timestamps are in UTC
            started_at = job.get('started_at')
            if started_at:
                start_time = datetime.fromisoformat(started_at.replace(' ', 'T'))
            else:
                start_time = datetime.utcnow()

            # Estimate total time based on job type (multi-clip ~20-40 min)
            estimated_total_seconds = 30 * 60  # 30 minutes estimate

            project_id = job.get('project_id')
            project_name = job.get('project_name')

            phases = [
                (0.05, "Downloading source clips..."),
                (0.10, "Loading AI model..."),
                (0.15, "Processing clips with AI upscaling..."),
                (0.60, "Encoding clips..."),
                (0.80, "Concatenating clips..."),
                (0.90, "Uploading result..."),
            ]

            while True:
                # T10360: polled `call.get(timeout=0)` and read 'not found' as
                # "Modal job expired" -> update_job_error. For a generator call that
                # lookup ALWAYS says not-found (see check_modal_job_running), so this
                # loop would have killed every job it was asked to resume -- harmless
                # only because /modal-status answered "expired" first and the frontend
                # never got here. Now that /modal-status reports 'running', this had
                # to move onto the same reconciler or it would kill (and, post-T10360,
                # REFUND) every resumed export on its first poll.
                verdict = await anyio.to_thread.run_sync(reconcile_dispatched_export, job)

                if verdict == 'rendered':
                    logger.info(f"[ExportJobs] Modal job {job_id} completed during progress loop")
                    finalization = await finalize_modal_export(
                        job, {"status": "success"}, get_current_user_id()
                    )
                    progress_data = {
                        "progress": 100,
                        "message": "Export complete!",
                        "status": ExportStatus.COMPLETE,
                        "projectId": project_id,
                        "projectName": project_name,
                        "workingVideoId": finalization.get('working_video_id'),
                    }
                    export_progress[job_id] = progress_data
                    await manager.send_progress(job_id, progress_data)
                    break

                if verdict == 'dead':
                    error_msg = "Modal render finished but produced no output object"
                    logger.warning(f"[ExportJobs] {error_msg} for job {job_id}")
                    update_job_error(job_id, error_msg)   # refunds
                    progress_data = {
                        "progress": 0,
                        "message": f"Export failed: {error_msg}",
                        "status": ExportStatus.ERROR,
                        "error": error_msg,
                        "projectId": project_id,
                        "projectName": project_name,
                    }
                    export_progress[job_id] = progress_data
                    await manager.send_progress(job_id, progress_data)
                    break

                # 'running' or 'unknown' -- keep waiting and keep the bar moving.
                # UNKNOWN must never end this loop: only cleanup_stale_exports' age
                # backstop is allowed to declare an unknowable job dead.
                elapsed = (datetime.utcnow() - start_time).total_seconds()
                raw_progress = min(elapsed / estimated_total_seconds, 0.95)
                progress = 10 + raw_progress * 80  # 10-90%

                phase_msg = "Processing..."
                for threshold, msg in phases:
                    if raw_progress >= threshold:
                        phase_msg = msg

                progress_data = {
                    "progress": int(progress),
                    "message": phase_msg,
                    "status": "processing",
                    "projectId": project_id,
                    "projectName": project_name,
                }
                export_progress[job_id] = progress_data
                await manager.send_progress(job_id, progress_data)

                await asyncio.sleep(5)  # Poll every 5 seconds

        except Exception as e:
            logger.error(f"[ExportJobs] Progress loop failed for {job_id}: {e}")
        finally:
            _active_progress_loops.discard(job_id)

    # Start the progress loop as a background task
    background_tasks.add_task(progress_loop)

    return {"message": "Progress loop started", "job_id": job_id}


# ============================================================================
# Project-scoped endpoints (for discovering exports on page load)
# ============================================================================

@router.get("/project/{project_id}", response_model=ExportJobListResponse)
async def list_project_exports(project_id: int):
    """
    List all exports for a project.

    Use this on page load to discover:
    - In-progress exports (reconnect WebSocket for progress)
    - Completed exports (show download/continue options)
    - Failed exports (show error message)
    """
    exports = get_project_exports(project_id)

    return ExportJobListResponse(
        exports=[
            ExportJobResponse(
                job_id=e['id'],
                project_id=e['project_id'],
                project_name=e.get('project_name'),
                type=e['type'],
                status=e['status'],
                error=e['error'],
                output_video_id=e['output_video_id'],
                output_filename=e['output_filename'],
                created_at=e['created_at'],
                started_at=e['started_at'],
                completed_at=e['completed_at'],
                stage=e.get('stage'),
            )
            for e in exports
        ]
    )
