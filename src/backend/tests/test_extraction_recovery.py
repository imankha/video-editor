"""
T249: Tests for extraction recovery — stale task timeout, auto-retry, manual retry, dedup.

Run with: pytest src/backend/tests/test_extraction_recovery.py -v
"""

import json
import pytest
import shutil
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_extraction_{uuid.uuid4().hex[:8]}"


def setup_module():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id("testdefault")


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.user_context import set_current_user_id, reset_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id("testdefault")
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from app.database import get_db_connection


def _create_game(cursor):
    """Helper: create a game and return its ID."""
    cursor.execute(
        "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
        ("Test Game", f"hash_{uuid.uuid4().hex[:32]}"),
    )
    return cursor.lastrowid


def _create_raw_clip(cursor, game_id):
    """Helper: create a raw clip (unextracted) and return its ID.
    Uses empty filename to simulate an unextracted clip."""
    cursor.execute(
        "INSERT INTO raw_clips (game_id, start_time, end_time, filename, rating) VALUES (?, ?, ?, ?, ?)",
        (game_id, 10.0, 20.0, "", 3),
    )
    return cursor.lastrowid


def _create_project(cursor):
    """Helper: create a project and return its ID."""
    cursor.execute(
        "INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)",
        ("Test Project", "9:16"),
    )
    return cursor.lastrowid


def _create_task(cursor, raw_clip_id, project_id, game_id, status="pending",
                 started_at=None, completed_at=None, retry_count=0, error=None):
    """Helper: create a modal_task and return its ID."""
    params = json.dumps({
        "user_id": TEST_USER_ID,
        "input_key": "games/test.mp4",
        "output_key": "raw_clips/test_out.mp4",
        "start_time": 10.0,
        "end_time": 20.0,
        "clip_filename": "test_out.mp4",
    })
    cursor.execute("""
        INSERT INTO modal_tasks (task_type, status, params, raw_clip_id, project_id, game_id,
                                 started_at, completed_at, retry_count, error)
        VALUES ('clip_extraction', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (status, params, raw_clip_id, project_id, game_id,
          started_at, completed_at, retry_count, error))
    return cursor.lastrowid


# --- Stale task timeout ---

class TestStaleTaskTimeout:
    """Failure mode #1 & #4: Tasks stuck in 'running' with no timeout."""

    def test_stale_running_task_marked_failed(self):
        """A task running for > 10 minutes should be marked 'failed'."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            # Create a task started 15 minutes ago
            stale_time = (datetime.utcnow() - timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S")
            task_id = _create_task(cursor, clip_id, project_id, game_id,
                                   status="running", started_at=stale_time)
            conn.commit()

        # Run the timeout check
        from app.services.modal_queue import check_stale_tasks
        timed_out = check_stale_tasks()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status, error FROM modal_tasks WHERE id = ?", (task_id,))
            task = cursor.fetchone()

        assert task['status'] == 'failed'
        assert 'timed out' in task['error'].lower()
        assert timed_out >= 1

    def test_recent_running_task_not_timed_out(self):
        """A task running for < 10 minutes should NOT be marked failed."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            recent_time = (datetime.utcnow() - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
            task_id = _create_task(cursor, clip_id, project_id, game_id,
                                   status="running", started_at=recent_time)
            conn.commit()

        from app.services.modal_queue import check_stale_tasks
        check_stale_tasks()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status FROM modal_tasks WHERE id = ?", (task_id,))
            task = cursor.fetchone()

        assert task['status'] == 'running'


# --- Auto-retry with backoff ---

class TestAutoRetry:
    """Failure mode #2: Failed tasks have no retry mechanism."""

    def test_failed_task_auto_retried(self):
        """A failed task with retry_count < 3 should be reset to 'pending'."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            # Failed task completed long enough ago to pass backoff
            old_time = (datetime.utcnow() - timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M:%S")
            task_id = _create_task(cursor, clip_id, project_id, game_id,
                                   status="failed", completed_at=old_time,
                                   retry_count=0, error="Some error")
            conn.commit()

        from app.services.modal_queue import check_and_retry_failed_tasks
        retried = check_and_retry_failed_tasks()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status, retry_count, error FROM modal_tasks WHERE id = ?", (task_id,))
            task = cursor.fetchone()

        assert task['status'] == 'pending'
        assert task['retry_count'] == 1
        assert task['error'] is None
        assert retried >= 1

    def test_max_retries_exhausted_stays_failed(self):
        """A failed task with retry_count >= 3 should stay 'failed'."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            old_time = (datetime.utcnow() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
            task_id = _create_task(cursor, clip_id, project_id, game_id,
                                   status="failed", completed_at=old_time,
                                   retry_count=3, error="Max retries")
            conn.commit()

        from app.services.modal_queue import check_and_retry_failed_tasks
        check_and_retry_failed_tasks()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status, retry_count FROM modal_tasks WHERE id = ?", (task_id,))
            task = cursor.fetchone()

        assert task['status'] == 'failed'
        assert task['retry_count'] == 3

    def test_backoff_prevents_immediate_retry(self):
        """A recently-failed task should not be retried until backoff elapses."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            # Failed just 10 seconds ago — backoff for retry 0 is 60s
            recent_time = (datetime.utcnow() - timedelta(seconds=10)).strftime("%Y-%m-%d %H:%M:%S")
            task_id = _create_task(cursor, clip_id, project_id, game_id,
                                   status="failed", completed_at=recent_time,
                                   retry_count=0, error="Recent failure")
            conn.commit()

        from app.services.modal_queue import check_and_retry_failed_tasks
        retried = check_and_retry_failed_tasks()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status FROM modal_tasks WHERE id = ?", (task_id,))
            task = cursor.fetchone()

        assert task['status'] == 'failed'
        assert retried == 0


# --- Dedup fix ---

class TestAlreadyQueuedDedup:
    """Failure mode #3: already_queued ignores failed tasks, causing duplicates."""

    def test_failed_with_retries_remaining_blocks_requeue(self):
        """A failed task with retry_count < 3 should be considered 'already queued'."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            _create_task(cursor, clip_id, project_id, game_id,
                         status="failed", retry_count=1, error="Retrying")
            conn.commit()

        from app.services.modal_queue import is_clip_already_queued
        assert is_clip_already_queued(clip_id) is True

    def test_failed_with_exhausted_retries_allows_requeue(self):
        """A failed task with retry_count >= 3 should NOT block re-enqueue."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            _create_task(cursor, clip_id, project_id, game_id,
                         status="failed", retry_count=3, error="Exhausted")
            conn.commit()

        from app.services.modal_queue import is_clip_already_queued
        assert is_clip_already_queued(clip_id) is False

    def test_pending_task_blocks_requeue(self):
        """A pending task should block re-enqueue (existing behavior)."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            _create_task(cursor, clip_id, project_id, game_id, status="pending")
            conn.commit()

        from app.services.modal_queue import is_clip_already_queued
        assert is_clip_already_queued(clip_id) is True


# --- Extraction status in API response ---

class TestExtractionStatusResponse:
    """Verify that extraction_status distinguishes 'retrying' from 'failed'."""

    def test_failed_with_retries_remaining_shows_retrying(self):
        """extraction_status should be 'retrying' when failed + retry_count < 3."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            _create_task(cursor, clip_id, project_id, game_id,
                         status="failed", retry_count=1, error="Will retry")
            conn.commit()

        from app.services.modal_queue import get_extraction_status
        status = get_extraction_status(clip_id)
        assert status == 'retrying'

    def test_failed_with_exhausted_retries_shows_failed(self):
        """extraction_status should be 'failed' when retry_count >= 3."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            _create_task(cursor, clip_id, project_id, game_id,
                         status="failed", retry_count=3, error="Exhausted")
            conn.commit()

        from app.services.modal_queue import get_extraction_status
        status = get_extraction_status(clip_id)
        assert status == 'failed'

    def test_running_shows_running(self):
        """extraction_status should be 'running' for running tasks."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            game_id = _create_game(cursor)
            clip_id = _create_raw_clip(cursor, game_id)
            project_id = _create_project(cursor)

            _create_task(cursor, clip_id, project_id, game_id, status="running")
            conn.commit()

        from app.services.modal_queue import get_extraction_status
        status = get_extraction_status(clip_id)
        assert status == 'running'
