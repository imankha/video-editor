"""
Modal Queue Service

All GPU operations go through this persistent queue:
1. Enqueue task (DB insert only)
2. Process queue (reads DB, calls Modal or local FFmpeg, updates DB)
3. Same processor runs on startup for recovery

This ensures:
- Tasks survive server restarts
- No duplicate processing
- Clear separation of concerns
- Works with Modal (cloud) OR local FFmpeg (dev)

Flow:
    enqueue_clip_extraction() -> DB insert (status='pending')
                              |
                              v
    process_modal_queue() -> Read pending tasks from DB
                          -> Mark as 'running'
                          -> Call Modal OR local FFmpeg
                          -> Mark as 'completed' or 'failed'
"""

import json
import logging
import asyncio
import uuid
import os
import tempfile
from typing import Optional
from pathlib import Path
from app.database import get_db_connection, get_raw_clips_path, get_games_path
from app.services.modal_client import modal_enabled, call_modal_extract_clip
from app.services.ffmpeg_service import extract_clip as ffmpeg_extract_clip
from app.storage import R2_ENABLED, download_from_r2, upload_to_r2
from app.websocket import broadcast_extraction_event

logger = logging.getLogger(__name__)


def enqueue_clip_extraction(
    clip_id: int,
    project_id: int,
    game_id: int,
    video_filename: str,
    start_time: float,
    end_time: float,
    user_id: str,
) -> int:
    """
    Add a clip extraction task to the queue (DB insert only).

    This does NOT call Modal - it only persists the task.
    Call process_modal_queue() afterward to process the queue.

    Returns the task_id.
    """
    clip_filename = f"{uuid.uuid4().hex[:12]}.mp4"

    params = json.dumps({
        "user_id": user_id,
        "input_key": f"games/{video_filename}",
        "output_key": f"raw_clips/{clip_filename}",
        "start_time": start_time,
        "end_time": end_time,
        "copy_codec": True,
        "clip_filename": clip_filename,  # Store for later use
    })

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO modal_tasks (task_type, status, params, raw_clip_id, project_id, game_id)
            VALUES ('clip_extraction', 'pending', ?, ?, ?, ?)
        """, (params, clip_id, project_id, game_id))
        task_id = cursor.lastrowid
        conn.commit()

    logger.info(f"[ModalQueue] Enqueued clip extraction: task={task_id}, clip={clip_id}, project={project_id}")
    return task_id


async def process_modal_queue() -> dict:
    """
    Process all pending tasks in the modal_tasks queue.

    Called:
    - After enqueueing new tasks (in background)
    - On app startup (for recovery)

    Uses Modal when MODAL_ENABLED=true, otherwise falls back to local FFmpeg.

    Returns summary of processed tasks.
    """
    use_modal = modal_enabled()
    if use_modal:
        logger.info("[ModalQueue] Processing queue with Modal (cloud GPU)")
    else:
        logger.info("[ModalQueue] Processing queue with local FFmpeg")

    # Phase 1: Find and claim pending tasks
    tasks_to_process = []

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get all pending tasks (also recover any 'running' tasks from crashed server)
        cursor.execute("""
            SELECT id, task_type, params, raw_clip_id, project_id, game_id
            FROM modal_tasks
            WHERE status IN ('pending', 'running')
            ORDER BY created_at ASC
        """)
        tasks = cursor.fetchall()

        if not tasks:
            return {"processed": 0, "succeeded": 0, "failed": 0}

        logger.info(f"[ModalQueue] Found {len(tasks)} tasks to process")

        # Mark all as 'running' to claim them
        task_ids = [t['id'] for t in tasks]
        placeholders = ','.join('?' * len(task_ids))
        cursor.execute(f"""
            UPDATE modal_tasks
            SET status = 'running', started_at = CURRENT_TIMESTAMP
            WHERE id IN ({placeholders})
        """, task_ids)
        conn.commit()

        for task in tasks:
            tasks_to_process.append({
                "task_id": task['id'],
                "task_type": task['task_type'],
                "params": json.loads(task['params']),
                "raw_clip_id": task['raw_clip_id'],
                "project_id": task['project_id'],
                "game_id": task['game_id'],
            })

    # Phase 2: Process tasks in parallel (outside DB connection)
    results = await asyncio.gather(
        *[_process_single_task(task) for task in tasks_to_process],
        return_exceptions=True
    )

    succeeded = sum(1 for r in results if isinstance(r, dict) and r.get("success"))
    failed = len(results) - succeeded

    logger.info(f"[ModalQueue] Processing complete: {succeeded} succeeded, {failed} failed")

    return {
        "processed": len(results),
        "succeeded": succeeded,
        "failed": failed,
    }


async def _process_single_task(task_info: dict) -> dict:
    """Process a single task from the queue."""
    task_id = task_info["task_id"]
    task_type = task_info["task_type"]

    try:
        if task_type == "clip_extraction":
            return await _process_clip_extraction(task_info)
        else:
            logger.warning(f"[ModalQueue] Unknown task type: {task_type}")
            _mark_task_failed(task_id, f"Unknown task type: {task_type}")
            return {"success": False, "task_id": task_id, "error": "Unknown task type"}

    except Exception as e:
        logger.error(f"[ModalQueue] Task {task_id} failed with exception: {e}")
        _mark_task_failed(task_id, str(e))
        return {"success": False, "task_id": task_id, "error": str(e)}


async def _process_clip_extraction(task_info: dict) -> dict:
    """Process a clip extraction task using Modal or local FFmpeg."""
    task_id = task_info["task_id"]
    params = task_info["params"]
    clip_id = task_info["raw_clip_id"]
    clip_filename = params.get("clip_filename")
    user_id = params["user_id"]

    logger.info(f"[ModalQueue] Processing clip extraction: task={task_id}, clip={clip_id}")

    if modal_enabled():
        # Use Modal (cloud GPU)
        result = await call_modal_extract_clip(
            user_id=user_id,
            input_key=params["input_key"],
            output_key=params["output_key"],
            start_time=params["start_time"],
            end_time=params["end_time"],
            copy_codec=params.get("copy_codec", True),
        )
    else:
        # Use local FFmpeg
        result = await _extract_clip_local(
            user_id=user_id,
            input_key=params["input_key"],
            output_key=params["output_key"],
            start_time=params["start_time"],
            end_time=params["end_time"],
            copy_codec=params.get("copy_codec", True),
        )

    if result.get("status") == "success":
        # Update clip with filename and mark task complete
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE raw_clips SET filename = ? WHERE id = ?", (clip_filename, clip_id))
            cursor.execute("""
                UPDATE modal_tasks
                SET status = 'completed', completed_at = CURRENT_TIMESTAMP, result = ?
                WHERE id = ?
            """, (json.dumps(result), task_id))
            conn.commit()

        logger.info(f"[ModalQueue] Completed clip {clip_id}: {clip_filename}")

        # Broadcast extraction complete event
        await broadcast_extraction_event(
            "extraction_complete",
            clip_id=clip_id,
            project_id=task_info.get("project_id")
        )

        return {"success": True, "task_id": task_id, "clip_id": clip_id, "filename": clip_filename}
    else:
        error = result.get("error", "Unknown error")
        _mark_task_failed(task_id, error)
        logger.error(f"[ModalQueue] Failed clip {clip_id}: {error}")

        # Broadcast extraction failed event
        await broadcast_extraction_event(
            "extraction_failed",
            clip_id=clip_id,
            project_id=task_info.get("project_id"),
            error=error
        )

        return {"success": False, "task_id": task_id, "clip_id": clip_id, "error": error}


async def _extract_clip_local(
    user_id: str,
    input_key: str,
    output_key: str,
    start_time: float,
    end_time: float,
    copy_codec: bool = True,
) -> dict:
    """
    Extract a clip using local FFmpeg.

    Handles both local files and R2 storage:
    - Downloads from R2 if R2_ENABLED
    - Extracts clip using FFmpeg
    - Uploads to R2 if R2_ENABLED

    Returns dict with 'status' key ('success' or 'error').
    """
    try:
        # Determine input path
        if R2_ENABLED:
            # Download source video from R2 to temp file
            with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp_input:
                input_path = tmp_input.name

            logger.info(f"[LocalExtract] Downloading {input_key} from R2")
            success = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: download_from_r2(user_id, input_key, Path(input_path))
            )
            if not success:
                return {"status": "error", "error": f"Failed to download {input_key} from R2"}
        else:
            # Use local file path
            # input_key is like "games/filename.mp4"
            input_path = str(get_games_path() / input_key.replace("games/", ""))
            if not os.path.exists(input_path):
                return {"status": "error", "error": f"Input file not found: {input_path}"}

        # Determine output path
        output_filename = output_key.replace("raw_clips/", "")
        local_output_path = str(get_raw_clips_path() / output_filename)

        # Ensure output directory exists
        os.makedirs(os.path.dirname(local_output_path), exist_ok=True)

        # Extract clip using FFmpeg
        logger.info(f"[LocalExtract] Extracting clip: {start_time}s - {end_time}s")
        success = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: ffmpeg_extract_clip(
                input_path=input_path,
                output_path=local_output_path,
                start_time=start_time,
                end_time=end_time,
                copy_codec=copy_codec,
            )
        )

        if not success:
            return {"status": "error", "error": "FFmpeg extraction failed"}

        # Upload to R2 if enabled
        if R2_ENABLED:
            logger.info(f"[LocalExtract] Uploading {output_key} to R2")
            upload_success = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: upload_to_r2(user_id, output_key, Path(local_output_path))
            )
            if not upload_success:
                return {"status": "error", "error": f"Failed to upload {output_key} to R2"}

            # Clean up temp input file if we downloaded it
            if R2_ENABLED and os.path.exists(input_path) and input_path.startswith(tempfile.gettempdir()):
                os.unlink(input_path)

        logger.info(f"[LocalExtract] Successfully extracted clip to {output_key}")
        return {"status": "success", "output_key": output_key}

    except Exception as e:
        logger.error(f"[LocalExtract] Error: {e}")
        return {"status": "error", "error": str(e)}


def _mark_task_failed(task_id: int, error: str):
    """Mark a task as failed in the database."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE modal_tasks
            SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = ?
            WHERE id = ?
        """, (error, task_id))
        conn.commit()


def run_queue_processor_sync():
    """
    Synchronous wrapper for process_modal_queue().
    Used when running in a background thread (e.g., FastAPI BackgroundTasks).
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(process_modal_queue())
    finally:
        loop.close()
