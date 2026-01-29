"""
Modal Queue Service

All Modal GPU operations go through this persistent queue:
1. Enqueue task (DB insert only)
2. Process queue (reads DB, calls Modal, updates DB)
3. Same processor runs on startup for recovery

This ensures:
- Tasks survive server restarts
- No duplicate processing
- Clear separation of concerns

Flow:
    enqueue_clip_extraction() -> DB insert (status='pending')
                              |
                              v
    process_modal_queue() -> Read pending tasks from DB
                          -> Mark as 'running'
                          -> Call Modal
                          -> Mark as 'completed' or 'failed'
"""

import json
import logging
import asyncio
import uuid
from typing import Optional
from app.database import get_db_connection
from app.services.modal_client import modal_enabled, call_modal_extract_clip
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

    Returns summary of processed tasks.
    """
    if not modal_enabled():
        logger.info("[ModalQueue] Modal not enabled, skipping queue processing")
        return {"processed": 0, "succeeded": 0, "failed": 0, "skipped": True}

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
    """Process a clip extraction task."""
    task_id = task_info["task_id"]
    params = task_info["params"]
    clip_id = task_info["raw_clip_id"]
    clip_filename = params.get("clip_filename")

    logger.info(f"[ModalQueue] Processing clip extraction: task={task_id}, clip={clip_id}")

    result = await call_modal_extract_clip(
        user_id=params["user_id"],
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
