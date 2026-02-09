"""
Shared helpers for export operations across annotate, framing, and overlay.

This module provides DRY utilities for:
- Export job lifecycle (create, complete, fail)
- Progress updates via WebSocket
- Project name derivation
- Common patterns used across all export types

Usage:
    from app.services.export_helpers import (
        create_export_job,
        complete_export_job,
        fail_export_job,
        send_progress,
        derive_project_name,
    )
"""

import json
import logging
import re
from typing import Optional

from app.database import get_db_connection
from app.constants import ExportStatus
from app.websocket import manager, export_progress, make_progress_data

logger = logging.getLogger(__name__)


# =============================================================================
# Export Job Lifecycle
# =============================================================================

def create_export_job(
    export_id: str,
    project_id: int,
    export_type: str,
    input_data: dict = None,
    game_id: int = None,
    game_name: str = None,
) -> str:
    """
    Create an export_jobs record for tracking.

    Args:
        export_id: Unique export job identifier
        project_id: Project ID (use 0 for annotate exports)
        export_type: 'framing', 'overlay', or 'annotate'
        input_data: Optional dict of input parameters
        game_id: Optional game ID (for annotate exports)
        game_name: Optional game name (for annotate exports)

    Returns:
        The export_id
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO export_jobs (id, project_id, type, status, input_data, game_id, game_name)
                VALUES (?, ?, ?, 'processing', ?, ?, ?)
            """, (
                export_id,
                project_id,
                export_type,
                json.dumps(input_data) if input_data else '{}',
                game_id,
                game_name,
            ))
            conn.commit()
        logger.info(f"[Export] Created job {export_id} (type={export_type}, project={project_id})")
    except Exception as e:
        logger.warning(f"[Export] Failed to create job record {export_id}: {e}")

    return export_id


def complete_export_job(
    export_id: str,
    output_filename: str = None,
    output_video_id: int = None,
):
    """
    Mark an export job as complete.

    Args:
        export_id: The export job ID
        output_filename: Optional output filename
        output_video_id: Optional output video ID (working_video_id or final_video_id)
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE export_jobs
                SET status = ?, output_filename = ?, output_video_id = ?, completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (ExportStatus.COMPLETE, output_filename, output_video_id, export_id))
            conn.commit()
        logger.info(f"[Export] Completed job {export_id}")
    except Exception as e:
        logger.warning(f"[Export] Failed to complete job record {export_id}: {e}")


def fail_export_job(export_id: str, error_message: str):
    """
    Mark an export job as failed.

    Args:
        export_id: The export job ID
        error_message: Error message (truncated to 500 chars)
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE export_jobs
                SET status = ?, error = ?, completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (ExportStatus.ERROR, error_message[:500], export_id))
            conn.commit()
        logger.error(f"[Export] Failed job {export_id}: {error_message[:100]}")
    except Exception as e:
        logger.warning(f"[Export] Failed to update job record {export_id}: {e}")


def store_modal_call_id(export_id: str, modal_call_id: str):
    """
    Store Modal call_id for job recovery.

    Args:
        export_id: The export job ID
        modal_call_id: Modal's call ID for this job
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE export_jobs
                SET modal_call_id = ?, started_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (modal_call_id, export_id))
            conn.commit()
        logger.info(f"[Export] Stored modal_call_id for {export_id}: {modal_call_id[:16]}...")
    except Exception as e:
        logger.warning(f"[Export] Failed to store modal_call_id for {export_id}: {e}")


# =============================================================================
# Progress Updates
# =============================================================================

async def send_progress(
    export_id: str,
    current: int,
    total: int,
    phase: str,
    message: str,
    export_type: str,
    done: bool = False,
    project_id: int = None,
    project_name: str = None,
    game_id: int = None,
    game_name: str = None,
    log_every: int = 5,
):
    """
    Send progress update via WebSocket using shared make_progress_data.

    This is the single entry point for progress updates across all export types.
    Ensures consistent formatting and status handling.

    Args:
        export_id: Export job ID
        current: Current progress value (0-100)
        total: Total progress value (usually 100)
        phase: Processing phase (init, download, processing, upload, done, error)
        message: Human-readable progress message
        export_type: 'annotate', 'framing', or 'overlay'
        done: Whether the export is complete
        project_id: Project ID (for framing/overlay)
        project_name: Project name (for framing/overlay)
        game_id: Game ID (for annotate)
        game_name: Game name (for annotate)
        log_every: Log every N percent (default 5)
    """
    progress_data = make_progress_data(
        current=current,
        total=total,
        phase=phase,
        message=message,
        export_type=export_type,
        done=done,
        project_id=project_id,
        project_name=project_name,
        game_id=game_id,
        game_name=game_name,
    )

    export_progress[export_id] = progress_data
    await manager.send_progress(export_id, progress_data)

    # Log significant progress changes
    if current % log_every == 0 or done or phase == 'error':
        logger.info(f"[Export] {export_id}: {current}/{total} ({phase}) - {message}")


def create_progress_callback(
    export_id: str,
    export_type: str,
    project_id: int = None,
    project_name: str = None,
    game_id: int = None,
    game_name: str = None,
):
    """
    Create an async progress callback for unified Modal/local processors.

    Returns an async function that can be passed to call_modal_* functions.

    Usage:
        progress_callback = create_progress_callback(
            export_id, 'framing', project_id=123, project_name='My Project'
        )
        result = await call_modal_framing_ai(..., progress_callback=progress_callback)
    """
    async def callback(progress: float, message: str, phase: str = "processing"):
        # Set done=True when phase is "complete" or "done", or progress is 100%
        is_done = phase in ('complete', 'done') or progress >= 100
        await send_progress(
            export_id=export_id,
            current=int(progress),
            total=100,
            phase=phase,
            message=message,
            export_type=export_type,
            done=is_done,
            project_id=project_id,
            project_name=project_name,
            game_id=game_id,
            game_name=game_name,
        )

    return callback


# =============================================================================
# Project Name Derivation
# =============================================================================

def derive_project_name(project_id: int, cursor) -> Optional[str]:
    """
    Derive a better project name from raw_clip data if project has generic name.

    Handles legacy auto-projects created before we added derive_clip_name.
    If project name matches "Clip {id}" pattern, tries to get a better name
    from the associated raw_clip.

    Args:
        project_id: The project ID
        cursor: Database cursor (must be from an active connection)

    Returns:
        Derived project name or None if no derivation needed/possible
    """
    # Get current project name
    cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    if not row or not row['name']:
        return None

    project_name = row['name']

    # Check if it's a generic "Clip {id}" name
    if not re.match(r'^Clip \d+$', project_name):
        return project_name  # Already has a good name

    # Try to derive from raw_clip
    cursor.execute("""
        SELECT rc.name, rc.rating, rc.tags
        FROM raw_clips rc
        WHERE rc.auto_project_id = ?
        LIMIT 1
    """, (project_id,))
    raw_clip = cursor.fetchone()

    if not raw_clip:
        return project_name

    tags = json.loads(raw_clip['tags']) if raw_clip['tags'] else []

    # Import here to avoid circular imports
    from app.queries import derive_clip_name
    derived_name = derive_clip_name(raw_clip['name'], raw_clip['rating'] or 0, tags)

    return derived_name if derived_name else project_name


def get_project_info(project_id: int) -> dict:
    """
    Get project info including derived name.

    Returns dict with 'id', 'name', 'working_video_id', 'final_video_id'.
    Name is automatically derived if it's a generic "Clip {id}" pattern.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, working_video_id, final_video_id
            FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            return None

        # Derive better name if needed
        name = derive_project_name(project_id, cursor) or project['name']

        return {
            'id': project['id'],
            'name': name,
            'working_video_id': project['working_video_id'],
            'final_video_id': project['final_video_id'],
        }


# =============================================================================
# Cleanup Utilities
# =============================================================================

def cleanup_temp_dir(temp_dir: str):
    """
    Clean up temporary directory.

    Safe to call even if directory doesn't exist.
    """
    import shutil
    import os

    try:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            logger.info(f"[Export] Cleaned up temp directory: {temp_dir}")
    except Exception as e:
        logger.warning(f"[Export] Failed to clean up temp dir: {e}")
