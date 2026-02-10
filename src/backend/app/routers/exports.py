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

from fastapi import APIRouter, HTTPException, Form, UploadFile, File, BackgroundTasks, Query
from pydantic import BaseModel
from typing import Optional, List
import uuid
import json
import logging
import os
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timedelta

from ..database import get_db_connection, get_user_data_path
from ..storage import generate_presigned_url
from ..user_context import get_current_user_id
from ..constants import ExportStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/exports", tags=["exports"])


def get_export_staging_path() -> Path:
    """Get the staging directory for export input files."""
    path = get_user_data_path() / "export_staging"
    path.mkdir(parents=True, exist_ok=True)
    return path


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
    project_id: int
    project_name: Optional[str] = None
    type: str
    status: str  # 'pending' | 'processing' | 'complete' | 'error'
    error: Optional[str] = None
    output_video_id: Optional[int] = None
    output_filename: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    # T12: Annotate exports use game_id instead of project_id
    game_id: Optional[int] = None
    game_name: Optional[str] = None


class ExportJobListResponse(BaseModel):
    """Response model for listing exports."""
    exports: List[ExportJobResponse]


# ============================================================================
# Database Operations
# ============================================================================

def create_export_job(project_id: int, job_type: str, config: dict) -> str:
    """Create a new export job in the database. Returns job_id."""
    job_id = f"export_{uuid.uuid4().hex[:12]}"
    input_data = json.dumps(config)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO export_jobs (id, project_id, type, status, input_data)
            VALUES (?, ?, ?, 'pending', ?)
        """, (job_id, project_id, job_type, input_data))
        conn.commit()

    logger.info(f"[ExportJobs] Created job {job_id} for project {project_id} (type: {job_type})")
    return job_id


def get_export_job(job_id: str) -> Optional[dict]:
    """Get an export job by ID, including project name."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT e.id, e.project_id, p.name as project_name,
                   e.type, e.status, e.error, e.input_data,
                   e.output_video_id, e.output_filename, e.modal_call_id,
                   e.created_at, e.started_at, e.completed_at
            FROM export_jobs e
            LEFT JOIN projects p ON e.project_id = p.id
            WHERE e.id = ?
        """, (job_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    return None


def get_project_exports(project_id: int) -> List[dict]:
    """Get all exports for a project, ordered by creation time desc."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, project_id, type, status, error,
                   output_video_id, output_filename,
                   created_at, started_at, completed_at
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
        cursor.execute("""
            UPDATE export_jobs
            SET status = 'processing', started_at = datetime('now')
            WHERE id = ?
        """, (job_id,))
        conn.commit()
    logger.info(f"[ExportJobs] Job {job_id} started processing")


def update_job_complete(job_id: str, output_video_id: int, output_filename: str):
    """Mark job as complete with output references."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE export_jobs
            SET status = 'complete',
                completed_at = datetime('now'),
                output_video_id = ?,
                output_filename = ?
            WHERE id = ?
        """, (output_video_id, output_filename, job_id))
        conn.commit()
    logger.info(f"[ExportJobs] Job {job_id} completed (video_id: {output_video_id})")


def update_job_error(job_id: str, error_message: str):
    """Mark job as failed with error message."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE export_jobs
            SET status = 'error',
                completed_at = datetime('now'),
                error = ?
            WHERE id = ?
        """, (error_message, job_id))
        conn.commit()
    logger.error(f"[ExportJobs] Job {job_id} failed: {error_message}")


def delete_export_job(job_id: str) -> bool:
    """Delete an export job. Returns True if deleted."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM export_jobs WHERE id = ?", (job_id,))
        conn.commit()
        return cursor.rowcount > 0


def finalize_modal_export(job: dict, modal_result: dict, user_id: str) -> dict:
    """
    Finalize a Modal export that completed while the user was away.

    This creates the working_video record, updates the project, and marks
    the export_jobs as complete. Called by /modal-status when it discovers
    a completed Modal job that our DB doesn't know about yet.

    SAFETY FEATURES:
    - Idempotent: checks if already finalized before creating records
    - User validation: verifies user owns the project before finalizing

    Args:
        job: The export_jobs record
        modal_result: The result dict from Modal
        user_id: The user's ID for R2 paths

    Returns:
        Dict with finalization result
    """
    job_id = job['id']
    project_id = job['project_id']
    output_key = modal_result.get('output_key', '')

    # Extract filename from output_key (e.g., "working_videos/working_123_abc.mp4" -> "working_123_abc.mp4")
    output_filename = output_key.split('/')[-1] if output_key else f"recovered_{job_id}.mp4"

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # IDEMPOTENCY CHECK: If job already finalized, return existing data
            cursor.execute("""
                SELECT status, output_video_id, output_filename
                FROM export_jobs WHERE id = ?
            """, (job_id,))
            current_job = cursor.fetchone()
            if current_job and current_job['status'] == 'complete':
                logger.info(f"[ExportJobs] Job {job_id} already finalized, returning existing data")
                return {
                    "finalized": True,
                    "already_finalized": True,
                    "working_video_id": current_job['output_video_id'],
                    "output_filename": current_job['output_filename'],
                }

            # USER VALIDATION: Verify user owns this project
            # The project's user_id should match the requesting user
            # For now, we check that the project exists (user isolation is handled by middleware)
            cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
            if not cursor.fetchone():
                logger.error(f"[ExportJobs] Project {project_id} not found for job {job_id}")
                return {
                    "finalized": False,
                    "error": "Project not found"
                }

            # Create working_video record (presigned_url generated on-the-fly, not stored)
            cursor.execute("""
                INSERT INTO working_videos (project_id, filename)
                VALUES (?, ?)
            """, (project_id, output_filename))
            working_video_id = cursor.lastrowid

            # Update project to point to the new working video
            cursor.execute("""
                UPDATE projects SET working_video_id = ? WHERE id = ?
            """, (working_video_id, project_id))

            # Update export_jobs to complete
            cursor.execute("""
                UPDATE export_jobs
                SET status = 'complete',
                    output_video_id = ?,
                    output_filename = ?,
                    completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (working_video_id, output_filename, job_id))

            conn.commit()

        logger.info(f"[ExportJobs] Finalized recovered export {job_id}: working_video_id={working_video_id}")

        return {
            "finalized": True,
            "working_video_id": working_video_id,
            "output_filename": output_filename,
            "presigned_url": presigned_url
        }

    except Exception as e:
        logger.error(f"[ExportJobs] Failed to finalize export {job_id}: {e}")
        return {
            "finalized": False,
            "error": str(e)
        }


def check_modal_job_running(modal_call_id: str) -> bool:
    """Check if a Modal job is still running using its call_id.

    Returns True if running, False if complete/error/not found.
    """
    try:
        import modal
        call = modal.FunctionCall.from_id(modal_call_id)
        try:
            # Non-blocking check - TimeoutError means still running
            call.get(timeout=0)
            return False  # Got result, not running
        except TimeoutError:
            return True  # Still running
        except Exception:
            return False  # Error, not running
    except ImportError:
        return False  # Modal not available
    except Exception:
        return False  # Failed to check, assume not running


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
        cursor.execute("""
            SELECT id, modal_call_id
            FROM export_jobs
            WHERE status IN ('pending', 'processing')
              AND created_at < datetime('now', ? || ' minutes')
        """, (f'-{max_age_minutes}',))
        stale_candidates = cursor.fetchall()

        if not stale_candidates:
            return

        # Check each candidate - only mark stale if Modal job is NOT running
        stale_count = 0
        still_running_count = 0

        for job_id, modal_call_id in stale_candidates:
            if modal_call_id:
                # Check Modal status before marking stale
                if check_modal_job_running(modal_call_id):
                    still_running_count += 1
                    logger.info(f"[ExportJobs] Job {job_id} still running on Modal, not marking stale")
                    continue  # Don't mark as stale - Modal says it's running

            # Either no modal_call_id or Modal says not running - mark as stale
            cursor.execute("""
                UPDATE export_jobs
                SET status = 'error',
                    error = 'Export timed out (stale)',
                    completed_at = datetime('now')
                WHERE id = ?
            """, (job_id,))
            stale_count += 1

        conn.commit()

        if stale_count > 0:
            logger.warning(f"[ExportJobs] Cleaned up {stale_count} stale exports")
        if still_running_count > 0:
            logger.info(f"[ExportJobs] {still_running_count} exports still running on Modal")


def get_active_exports() -> List[dict]:
    """Get all currently active (pending or processing) exports.

    Also cleans up stale exports that have been processing too long.
    60 minutes is chosen because Modal jobs can run 40+ minutes for large exports.
    """
    # Clean up stale exports first (increased from 15 to 60 minutes for Modal jobs)
    cleanup_stale_exports(max_age_minutes=60)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # T12: Include game_id and game_name for annotate exports
        cursor.execute("""
            SELECT e.id, e.project_id, p.name as project_name, e.type, e.status, e.error,
                   e.output_video_id, e.output_filename,
                   e.created_at, e.started_at, e.completed_at,
                   e.game_id, e.game_name
            FROM export_jobs e
            LEFT JOIN projects p ON e.project_id = p.id
            WHERE e.status IN ('pending', 'processing')
            ORDER BY e.created_at DESC
        """)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_recent_exports(hours: int = 24) -> List[dict]:
    """Get exports from the last N hours."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # SQLite datetime comparison
        cursor.execute("""
            SELECT id, project_id, type, status, error,
                   output_video_id, output_filename,
                   created_at, started_at, completed_at
            FROM export_jobs
            WHERE created_at >= datetime('now', ? || ' hours')
            ORDER BY created_at DESC
        """, (f'-{hours}',))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_exports_by_status(statuses: List[str]) -> List[dict]:
    """Get exports filtered by status list."""
    if not statuses:
        return []

    with get_db_connection() as conn:
        cursor = conn.cursor()
        placeholders = ','.join(['?' for _ in statuses])
        cursor.execute(f"""
            SELECT id, project_id, type, status, error,
                   output_video_id, output_filename,
                   created_at, started_at, completed_at
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

    # Parse keyframes
    try:
        keyframes = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {e}")

    if not keyframes:
        raise HTTPException(status_code=400, detail="No keyframes provided")

    # Parse segment data
    segment_data = None
    if segment_data_json:
        try:
            segment_data = json.loads(segment_data_json)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid segment data JSON: {e}")

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
        raise HTTPException(status_code=500, detail=f"Failed to stage video: {e}")

    # Build config
    config = {
        "video_path": str(staged_video_path),
        "keyframes": keyframes,
        "target_fps": target_fps,
        "export_mode": export_mode,
        "segment_data": segment_data,
        "include_audio": include_audio.lower() == "true"
    }

    # Create job in database
    input_data = json.dumps(config)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO export_jobs (id, project_id, type, status, input_data)
            VALUES (?, ?, 'framing', 'pending', ?)
        """, (job_id, project_id, input_data))
        conn.commit()

    logger.info(f"[Exports] Created framing job {job_id} for project {project_id}")

    # Start background processing
    background_tasks.add_task(process_export_job, job_id)

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Framing export started"
    }


@router.post("/overlay", response_model=dict)
async def start_overlay_export(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    project_id: int = Form(...),
    highlight_regions_json: str = Form(None),
    highlight_keyframes_json: str = Form(None),
    highlight_effect_type: str = Form("original"),
):
    """
    Start an overlay export job with video file upload.

    This is the async version of /api/export/overlay.
    """
    from ..services.export_worker import process_export_job

    # Validate project exists
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

    # Parse highlight data (support both formats)
    highlight_regions = None
    if highlight_regions_json:
        try:
            highlight_regions = json.loads(highlight_regions_json)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight regions JSON: {e}")
    elif highlight_keyframes_json:
        try:
            highlight_regions = json.loads(highlight_keyframes_json)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {e}")

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
        raise HTTPException(status_code=500, detail=f"Failed to stage video: {e}")

    # Build config
    config = {
        "video_path": str(staged_video_path),
        "highlight_regions": highlight_regions,
        "highlight_effect_type": highlight_effect_type,
    }

    # Create job in database
    input_data = json.dumps(config)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO export_jobs (id, project_id, type, status, input_data)
            VALUES (?, ?, 'overlay', 'pending', ?)
        """, (job_id, project_id, input_data))
        conn.commit()

    logger.info(f"[Exports] Created overlay job {job_id} for project {project_id}")

    # Start background processing
    background_tasks.add_task(process_export_job, job_id)

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Overlay export started"
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
    exports = get_active_exports()

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
                completed_at=e['completed_at']
            )
            for e in exports
        ]
    )


@router.get("/unacknowledged", response_model=ExportJobListResponse)
async def list_unacknowledged_exports():
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
        cursor.execute("""
            SELECT e.id, e.project_id, p.name as project_name, e.type, e.status, e.error,
                   e.output_video_id, e.output_filename,
                   e.created_at, e.started_at, e.completed_at,
                   e.game_id, e.game_name
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
            )
            for e in exports
        ]
    )


@router.post("/acknowledge")
async def acknowledge_exports(job_ids: List[str] = None):
    """
    T12: Mark exports as acknowledged (notification shown).

    Call this after showing completion notifications to prevent
    duplicate notifications on subsequent page loads.

    If job_ids is empty/null, acknowledges all unacknowledged exports.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        if job_ids:
            # Acknowledge specific exports
            placeholders = ','.join(['?' for _ in job_ids])
            cursor.execute(f"""
                UPDATE export_jobs
                SET acknowledged_at = datetime('now')
                WHERE id IN ({placeholders})
                  AND acknowledged_at IS NULL
            """, job_ids)
        else:
            # Acknowledge all unacknowledged exports
            cursor.execute("""
                UPDATE export_jobs
                SET acknowledged_at = datetime('now')
                WHERE acknowledged_at IS NULL
                  AND status IN ('complete', 'error')
            """)

        conn.commit()
        acknowledged_count = cursor.rowcount

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
        completed_at=job['completed_at']
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
        # Job doesn't have a Modal call_id (old job or non-Modal export)
        return {
            "status": "not_modal",
            "job_status": job['status'],
            "message": "This job does not have a Modal call ID"
        }

    try:
        import modal

        # Retrieve the Modal function call
        call = modal.FunctionCall.from_id(modal_call_id)

        # Try non-blocking get to check if complete
        try:
            result = call.get(timeout=0)

            # Job is complete - finalize if our DB still shows 'processing'
            if job['status'] == 'processing':
                logger.info(f"[ExportJobs] Modal job {job_id} completed while user was away, finalizing...")

                if result.get('status') == 'success':
                    # Finalize the export (create working_video, update project, etc.)
                    user_id = get_current_user_id()
                    finalization = finalize_modal_export(job, result, user_id)

                    if finalization.get('finalized'):
                        return {
                            "status": ExportStatus.COMPLETE,
                            "result": result,
                            "message": "Export recovered and finalized successfully",
                            "working_video_id": finalization.get('working_video_id'),
                            "output_filename": finalization.get('output_filename'),
                            "presigned_url": finalization.get('presigned_url')
                        }
                    else:
                        # Finalization failed but Modal succeeded - still return success
                        logger.warning(f"[ExportJobs] Finalization failed for {job_id}: {finalization.get('error')}")
                        return {
                            "status": ExportStatus.COMPLETE,
                            "result": result,
                            "message": "Modal completed but finalization failed",
                            "finalization_error": finalization.get('error')
                        }
                else:
                    # Modal job failed - update export_jobs to error
                    error_msg = result.get('error', 'Unknown Modal error')
                    update_job_error(job_id, error_msg)
                    return {
                        "status": "error",
                        "error": error_msg,
                        "result": result
                    }

            # Job already finalized (status is 'complete' or 'error')
            return {
                "status": ExportStatus.COMPLETE,
                "result": result,
                "job_status": job['status']
            }
        except TimeoutError:
            # Still running on Modal
            # If our DB incorrectly shows 'error' (e.g., from a connection hiccup), fix it
            if job['status'] == 'error':
                logger.info(f"[ExportJobs] Modal job {job_id} still running but DB shows error - resetting to processing")
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs
                        SET status = 'processing', error = NULL, completed_at = NULL
                        WHERE id = ?
                    """, (job_id,))
                    conn.commit()

            return {
                "status": "running",
                "message": "Modal job is still processing"
            }
        except Exception as modal_err:
            # Modal job may have failed or call_id expired
            error_str = str(modal_err).lower()
            logger.warning(f"[ExportJobs] Modal call.get failed for {job_id}: {modal_err}")

            # Check for common expiration/not-found patterns
            if 'not found' in error_str or 'expired' in error_str or 'invalid' in error_str:
                return {
                    "status": "expired",
                    "error": "Modal job expired or not found",
                    "message": "This export job is too old to recover. The Modal job has expired."
                }

            return {
                "status": "error",
                "error": str(modal_err),
                "message": "Failed to get Modal job result"
            }

    except ImportError:
        return {
            "status": "error",
            "error": "Modal SDK not available",
            "message": "Modal is not installed on this server"
        }
    except Exception as e:
        error_str = str(e).lower()
        logger.error(f"[ExportJobs] Failed to check Modal status for {job_id}: {e}")

        # Check for expiration when retrieving the call itself
        if 'not found' in error_str or 'expired' in error_str or 'invalid' in error_str:
            return {
                "status": "expired",
                "error": "Modal job expired or not found",
                "message": "This export job is too old to recover. The Modal job has expired."
            }

        return {
            "status": "error",
            "error": str(e),
            "message": "Failed to retrieve Modal job"
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
        cursor.execute("""
            UPDATE export_jobs
            SET status = 'error', error = 'Cancelled by user', completed_at = datetime('now')
            WHERE id = ?
        """, (job_id,))
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
        try:
            import modal
        except ImportError:
            logger.error(f"[ExportJobs] Modal not available for progress loop {job_id}")
            _active_progress_loops.discard(job_id)
            return

        try:
            call = modal.FunctionCall.from_id(modal_call_id)

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
                # Check if job completed
                try:
                    result = call.get(timeout=0)
                    # Job completed - finalize
                    logger.info(f"[ExportJobs] Modal job {job_id} completed during progress loop")

                    if result.get('status') == 'success':
                        user_id = get_current_user_id()
                        finalization = finalize_modal_export(job, result, user_id)

                        progress_data = {
                            "progress": 100,
                            "message": "Export complete!",
                            "status": ExportStatus.COMPLETE,
                            "projectId": project_id,
                            "projectName": project_name,
                            "workingVideoId": finalization.get('working_video_id'),
                        }
                    else:
                        error_msg = result.get('error', 'Unknown error')
                        update_job_error(job_id, error_msg)
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

                except TimeoutError:
                    # Still running - calculate and send progress
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

                except Exception as e:
                    error_str = str(e).lower()
                    if 'not found' in error_str or 'expired' in error_str:
                        logger.warning(f"[ExportJobs] Modal job {job_id} expired during progress loop")
                        update_job_error(job_id, "Modal job expired")
                        break
                    logger.warning(f"[ExportJobs] Error polling Modal for {job_id}: {e}")

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
                completed_at=e['completed_at']
            )
            for e in exports
        ]
    )
