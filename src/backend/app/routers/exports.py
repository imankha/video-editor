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
    """Get an export job by ID."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, project_id, type, status, error, input_data,
                   output_video_id, output_filename, modal_call_id,
                   created_at, started_at, completed_at
            FROM export_jobs
            WHERE id = ?
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
        # Generate presigned URL for the completed video
        presigned_url = generate_presigned_url(user_id, output_key)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Create working_video record
            cursor.execute("""
                INSERT INTO working_videos (project_id, filename, presigned_url, type, multi_clip)
                VALUES (?, ?, ?, 'processed', 1)
            """, (project_id, output_filename, presigned_url))
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
        cursor.execute("""
            SELECT e.id, e.project_id, p.name as project_name, e.type, e.status, e.error,
                   e.output_video_id, e.output_filename,
                   e.created_at, e.started_at, e.completed_at
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
                completed_at=e['completed_at']
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
                            "status": "complete",
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
                            "status": "complete",
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
                "status": "complete",
                "result": result,
                "job_status": job['status']
            }
        except TimeoutError:
            # Still running
            return {
                "status": "running",
                "message": "Modal job is still processing"
            }
        except Exception as modal_err:
            # Modal job may have failed
            logger.warning(f"[ExportJobs] Modal call.get failed for {job_id}: {modal_err}")
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
        logger.error(f"[ExportJobs] Failed to check Modal status for {job_id}: {e}")
        return {
            "status": "error",
            "error": str(e),
            "message": "Failed to retrieve Modal job"
        }


@router.delete("/{job_id}")
async def cancel_export(job_id: str):
    """
    Cancel a pending or processing export job.

    Note: If the job is already processing, cancellation may not take
    effect immediately. The worker will check for cancellation at
    safe points during processing.
    """
    job = get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job['status'] in ('complete', 'error'):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status '{job['status']}'"
        )

    # Mark as cancelled (worker will check this)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE export_jobs
            SET status = 'error', error = 'Cancelled by user', completed_at = datetime('now')
            WHERE id = ?
        """, (job_id,))
        conn.commit()

    logger.info(f"[ExportJobs] Job {job_id} cancelled by user")
    return {"message": "Export job cancelled"}


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
