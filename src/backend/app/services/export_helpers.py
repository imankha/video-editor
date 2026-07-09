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
from app.constants import ExportStatus, ExportPhase
from app.utils.encoding import encode_data, decode_data
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
                encode_data(input_data) if input_data else encode_data({}),
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
    project_id: int = None,
    project_name: str = None,
    game_id: int = None,
    game_name: str = None,
    log_every: int = 5,
):
    """
    Send progress update via WebSocket using shared make_progress_data.

    This is the single entry point for progress updates across all export types.
    Status and done are derived from phase (single source of truth).

    Args:
        export_id: Export job ID
        current: Current progress value (0-100)
        total: Total progress value (usually 100)
        phase: Processing phase (init, download, processing, upload, complete, error)
        message: Human-readable progress message
        export_type: 'annotate', 'framing', or 'overlay'
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
        project_id=project_id,
        project_name=project_name,
        game_id=game_id,
        game_name=game_name,
    )

    export_progress[export_id] = progress_data
    await manager.send_progress(export_id, progress_data)

    # Log significant progress changes (done is derived from phase)
    is_terminal = phase in (ExportPhase.COMPLETE, 'done', ExportPhase.ERROR)
    if current % log_every == 0 or is_terminal:
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
    Status and done are derived from phase (single source of truth).

    Usage:
        progress_callback = create_progress_callback(
            export_id, 'framing', project_id=123, project_name='My Project'
        )
        result = await call_modal_framing_ai(..., progress_callback=progress_callback)
    """
    async def callback(progress: float, message: str, phase: str = "processing"):
        # Status and done are derived from phase in make_progress_data
        await send_progress(
            export_id=export_id,
            current=int(progress),
            total=100,
            phase=phase,
            message=message,
            export_type=export_type,
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
        SELECT rc.name, rc.rating, rc.tags, rc.notes
        FROM raw_clips rc
        WHERE rc.auto_project_id = ?
        LIMIT 1
    """, (project_id,))
    raw_clip = cursor.fetchone()

    if not raw_clip:
        return project_name

    tags = decode_data(raw_clip['tags']) or []

    # Import here to avoid circular imports
    from app.queries import derive_clip_name
    derived_name = derive_clip_name(raw_clip['name'], raw_clip['rating'] or 0, tags, raw_clip['notes'] or '')

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
# Background Task R2 Sync
# =============================================================================

def sync_export_db_to_r2(user_id: str, profile_id: Optional[str]) -> bool:
    """
    Explicit, durable R2 sync for background export tasks (T940 pattern).

    Background tasks run outside the request middleware, so their DB writes
    (working_videos/final_videos rows, export_jobs status, credit refunds)
    are never synced automatically. Call this after the background pipeline
    completes or fails. On failure, marks sync pending so the next write
    request retries via the middleware recovery path.

    Durable: sync_db_to_r2_explicit/sync_user_db_to_r2_explicit default to
    lock_timeout=None, so this blocks on the per-user upload lock rather than
    silently deferring (the 0.5s defer is a loss path).

    T4110: returns the sync status (True iff BOTH the profile DB — where
    final_videos lives — and the user DB reached R2). Callers gate the
    export-COMPLETE WebSocket event on this so we never announce "done" for
    rows that aren't durably in R2 (the prod project-46 loss). It still marks
    pending on failure as the secondary recovery path.
    """
    from app.database import (
        sync_db_to_r2_explicit,
        sync_user_db_to_r2_explicit,
        mark_sync_pending,
    )

    ok = True
    if profile_id:
        try:
            ok = sync_db_to_r2_explicit(user_id, profile_id) and ok
        except Exception as e:
            logger.error(f"[Export] Background profile DB sync failed for user={user_id}: {e}")
            ok = False
    try:
        ok = sync_user_db_to_r2_explicit(user_id) and ok
    except Exception as e:
        logger.error(f"[Export] Background user DB sync failed for user={user_id}: {e}")
        ok = False

    if ok:
        logger.info(f"[SYNC] EXPORT user={user_id} -> R2 sync OK")
    else:
        mark_sync_pending(user_id)
        logger.warning(f"[SYNC] EXPORT user={user_id} -> R2 sync FAILED - marked pending for retry")
    return ok


# =============================================================================
# Clip Source Resolution (shared across framing + multi-clip render paths)
# =============================================================================

class SourceUnavailable(Exception):
    """No editable source could be resolved for a clip.

    Raised when the game video is gone, no preserved per-clip extract exists,
    and no recap segment covers the clip. A visible failure — never a silent
    fallback (CLAUDE.md: no silent fallbacks for internal data).
    """

    def __init__(self, clip_id):
        self.clip_id = clip_id
        super().__init__(f"No editable source available for clip {clip_id}")


def _resolve_recap_source(clip: dict):
    """Resolve a clip to its surviving recap segment (T4140).

    The recap (recaps/{game_id}.mp4) is a full-quality re-edit master that
    outlives the game video (auto_export._generate_recap). Its per-clip mapping
    recaps/{game_id}_clips.json keys each clip's frozen recap_start/recap_end by
    the RAW clip id (a recap entry's 'id' is the raw_clips.id — see games.py
    _compute_recap_clips). Returns:

      (recap_url, recap_start, recap_end, flexible=False)   # frozen bounds

    or None (falls through to a visible SourceUnavailable in resolve_clip_source)
    when the game_id, the recap mapping, the matching entry, or the recap object
    is missing. No silent fallback (CLAUDE.md): a missing recap fails visibly
    rather than pretending a source exists.
    """
    import json
    import tempfile
    from pathlib import Path

    from app.storage import download_from_r2, generate_presigned_url
    from app.user_context import get_current_user_id

    game_id = clip.get('game_id')
    if not game_id:
        return None
    # In the framing/multi-clip clip dict `id` is the working_clip id and
    # `raw_clip_id` is the raw_clips.id the recap mapping is keyed by; prefer the
    # raw id, falling back to `id` for callers that pass the raw id directly.
    raw_clip_id = clip.get('raw_clip_id') or clip.get('id')
    if raw_clip_id is None:
        return None

    user_id = get_current_user_id()

    with tempfile.TemporaryDirectory() as tmp:
        local_path = Path(tmp) / "clips.json"
        if not download_from_r2(user_id, f"recaps/{game_id}_clips.json", local_path):
            return None
        with open(local_path) as f:
            mapping = json.load(f)

    entry = next((e for e in mapping if e.get('id') == raw_clip_id), None)
    if entry is None:
        return None
    recap_start = entry.get('recap_start')
    recap_end = entry.get('recap_end')
    if recap_start is None or recap_end is None:
        return None

    recap_url = generate_presigned_url(user_id, f"recaps/{game_id}.mp4")
    if not recap_url:
        return None
    return (recap_url, float(recap_start), float(recap_end), False)


def resolve_clip_source(clip: dict) -> tuple:
    """Resolve a clip's editable source for a framing/multi-clip render.

    Returns (source_url, in_offset, out_offset, flexible) where in/out are the
    seconds to extract out of source_url and flexible is True only when the
    full game video backs the clip (wider trims possible). Resolution order,
    first hit wins, visible-fail on total miss:

      1. game video present -> (game_url, raw_start, raw_end, flexible=True)
      2. T4175 preserved per-clip extract (raw_clips.filename set)
                            -> (extract_url, 0.0, duration, flexible=False)
      3. T4140 recap segment -> (recap_url, recap_start, recap_end, flexible=False)
      4. none               -> raise SourceUnavailable (no silent fallback)

    The game video is preferred while it exists (best quality, full trim
    flexibility). After the game is reclaimed the preserved extract is the
    surviving native-resolution single-clip source; the hi-q recap is the
    fallback for clips that were never given a preserved extract (both frozen
    bounds, reframe-only).

    clip must carry: game_id, game_blake3_hash, raw_start_time, raw_end_time,
    raw_filename, and raw_clip_id (the raw_clips.id keying the recap mapping).
    """
    from app.storage import (
        generate_presigned_url,
        generate_presigned_url_global,
        r2_head_object_global,
    )
    from app.user_context import get_current_user_id

    clip_id = clip.get('id') or clip.get('raw_clip_id')

    # 1. Game video — best quality, full trim flexibility.
    game_id = clip.get('game_id')
    game_hash = clip.get('game_blake3_hash')
    if game_id and game_hash:
        game_key = f"games/{game_hash}.mp4"
        # T4140: HEAD-probe the game before using it. Since the recap
        # (recaps/{game_id}.mp4) is now a universal fallback for any game clip —
        # not just clips with a preserved extract — a reclaimed game must fall
        # through to the extract/recap rather than hand back a dead presigned URL.
        # r2_head_object_global retries transient errors internally, so a brief
        # blip does not spuriously demote a present game; a sustained miss falls
        # through to a real fallback or a visible SourceUnavailable.
        if r2_head_object_global(game_key) is not None:
            url = generate_presigned_url_global(game_key)
            if url:
                return (url, clip['raw_start_time'], clip['raw_end_time'], True)

    # 2. T4175 preserved per-clip extract (native-res single clip; whole-file range).
    raw_filename = clip.get('raw_filename')
    if raw_filename:
        user_id = get_current_user_id()
        url = generate_presigned_url(user_id, f"raw_clips/{raw_filename}")
        if url:
            start = clip.get('raw_start_time') or 0.0
            end = clip.get('raw_end_time')
            if end is not None:
                duration = end - start
            else:
                duration = clip.get('raw_duration') or 0.0
            return (url, 0.0, float(duration), False)

    # 3. T4140 recap fallback (stubbed until T4140 lands).
    recap = _resolve_recap_source(clip)
    if recap is not None:
        return recap

    # 4. Visible failure — no silent fallback.
    raise SourceUnavailable(clip_id)


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
