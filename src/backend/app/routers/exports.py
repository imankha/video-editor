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
                   output_video_id, output_filename,
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


def cleanup_stale_exports(max_age_minutes: int = 60):
    """Mark exports that have been processing too long as stale/error.

    This prevents orphaned exports from accumulating if:
    - Server crashed during processing
    - User navigated away and export errored silently
    - Network issues prevented completion update
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE export_jobs
            SET status = 'error',
                error = 'Export timed out (stale)',
                completed_at = datetime('now')
            WHERE status IN ('pending', 'processing')
              AND created_at < datetime('now', ? || ' minutes')
        """, (f'-{max_age_minutes}',))
        if cursor.rowcount > 0:
            logger.warning(f"[ExportJobs] Cleaned up {cursor.rowcount} stale exports")
        conn.commit()


def get_active_exports() -> List[dict]:
    """Get all currently active (pending or processing) exports.

    Also cleans up stale exports that have been processing too long.
    15 minutes is chosen because most exports complete in under 10 minutes.
    """
    # Clean up stale exports first
    cleanup_stale_exports(max_age_minutes=15)

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
