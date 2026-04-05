"""
Modal Queue Service

Persistent task queue for GPU operations:
1. Enqueue task (DB insert)
2. Process queue (reads DB, dispatches to handler, updates DB)
3. Same processor runs on startup for recovery

This ensures:
- Tasks survive server restarts
- No duplicate processing
- Clear separation of concerns

Currently no task types are enqueued (clip extraction was removed in T740/T800).
The infrastructure is kept for future GPU task types.
"""

import json
import logging
import asyncio

from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id

logger = logging.getLogger(__name__)

STALE_TASK_TIMEOUT_MINUTES = 10
MAX_RETRY_COUNT = 3
RETRY_BACKOFF_SECONDS = [60, 300, 900]  # 1min, 5min, 15min


async def process_modal_queue() -> dict:
    """
    Process all pending tasks in the modal_tasks queue.

    Called on app startup for recovery.
    Returns summary of processed tasks.
    """
    check_stale_tasks()
    check_and_retry_failed_tasks()

    # Phase 1: Find and claim pending tasks
    tasks_to_process = []

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, task_type, params, raw_clip_id, project_id, game_id
            FROM modal_tasks
            WHERE status = 'pending'
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
        logger.warning(f"[ModalQueue] Unknown task type: {task_type}")
        _mark_task_failed(task_id, f"Unknown task type: {task_type}")
        return {"success": False, "task_id": task_id, "error": "Unknown task type"}

    except Exception as e:
        logger.error(f"[ModalQueue] Task {task_id} failed with exception: {e}")
        _mark_task_failed(task_id, str(e))
        return {"success": False, "task_id": task_id, "error": str(e)}


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


def check_stale_tasks() -> int:
    """
    Mark tasks stuck in 'running' for > STALE_TASK_TIMEOUT_MINUTES as 'failed'.

    Returns the number of tasks timed out.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE modal_tasks
            SET status = 'failed',
                completed_at = CURRENT_TIMESTAMP,
                error = 'Timed out after {STALE_TASK_TIMEOUT_MINUTES} minutes'
            WHERE status = 'running'
            AND started_at < datetime('now', '-{STALE_TASK_TIMEOUT_MINUTES} minutes')
        """)
        stale_count = cursor.rowcount
        if stale_count > 0:
            conn.commit()
            logger.warning(f"[ModalQueue] Timed out {stale_count} stale running task(s)")
        return stale_count


def check_and_retry_failed_tasks() -> int:
    """
    Auto-retry failed tasks with retry_count < MAX_RETRY_COUNT.

    Respects exponential backoff: waits RETRY_BACKOFF_SECONDS[retry_count]
    after failure before retrying.

    Returns the number of tasks reset to 'pending'.
    """
    retried = 0
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, retry_count, completed_at FROM modal_tasks
            WHERE status = 'failed'
            AND retry_count < ?
        """, (MAX_RETRY_COUNT,))
        candidates = cursor.fetchall()

        for task in candidates:
            retry_count = task['retry_count']
            backoff_secs = RETRY_BACKOFF_SECONDS[min(retry_count, len(RETRY_BACKOFF_SECONDS) - 1)]
            cursor.execute("""
                UPDATE modal_tasks
                SET status = 'pending', retry_count = retry_count + 1,
                    error = NULL, started_at = NULL, completed_at = NULL
                WHERE id = ? AND status = 'failed'
                AND completed_at < datetime('now', ? || ' seconds')
            """, (task['id'], f'-{backoff_secs}'))
            if cursor.rowcount > 0:
                retried += 1

        if retried > 0:
            conn.commit()
            logger.info(f"[ModalQueue] Auto-retrying {retried} failed task(s)")
    return retried


async def run_queue_processor(user_id: str = None, profile_id: str = None):
    """
    Async wrapper for process_modal_queue().
    Used as a FastAPI BackgroundTask.

    Must receive user_id and profile_id explicitly because background tasks
    don't inherit request-scoped contextvars.
    """
    if user_id:
        set_current_user_id(user_id)
    if profile_id:
        set_current_profile_id(profile_id)

    return await process_modal_queue()


def run_queue_processor_sync(user_id: str = None, profile_id: str = None):
    """
    Synchronous wrapper for process_modal_queue().
    Used only for startup recovery or non-async contexts.
    """
    if user_id:
        set_current_user_id(user_id)
    if profile_id:
        set_current_profile_id(profile_id)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(process_modal_queue())
    finally:
        loop.close()
