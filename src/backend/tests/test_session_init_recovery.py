"""
T1380 + T1390: Per-user startup recovery runs lazily on user_session_init.

Verifies that orphaned export jobs and pending modal queue tasks are reconciled
on the user's first session init (once per user per process) — replacing the
boot-time loop that needed user context it didn't have.
"""

import asyncio
import sys
import time
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def _uid(prefix: str = "recov") -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


def _seed_orphans_for(user_id: str, profile_id: str) -> int:
    """Create per-user DBs and insert an orphan export job + pending modal task.

    Returns the export_jobs row id so the test can assert it was updated.
    """
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    from app.services.user_db import ensure_user_database
    from app.database import ensure_database, get_db_connection

    set_current_user_id(user_id)
    set_current_profile_id(profile_id)
    ensure_user_database(user_id)
    ensure_database()

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO export_jobs (id, type, status, input_data, created_at)
            VALUES ('test-orphan-' || hex(randomblob(4)), 'test', 'processing', '{}', CURRENT_TIMESTAMP)
            """
        )
        job_id = cur.lastrowid
        cur.execute(
            """
            INSERT INTO modal_tasks (task_type, params, status, created_at)
            VALUES ('__unknown_for_test__', '{}', 'pending', CURRENT_TIMESTAMP)
            """
        )
        conn.commit()
    return job_id


class TestLazyStartupRecovery:
    def test_recovery_runs_on_first_init(self):
        """user_session_init triggers orphan recovery + modal queue drain."""
        from app.session_init import _init_cache
        from app.services.user_db import create_profile, set_selected_profile_id
        from app.database import get_db_connection
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        uid = _uid("lazy")
        pid = uuid4().hex[:8]

        # Seed per-user DB under an explicit profile id + register profile.
        _seed_orphans_for(uid, pid)
        create_profile(uid, pid, "Test", "#000", is_default=True)
        set_selected_profile_id(uid, pid)

        # Force the slow path.
        _init_cache.pop(uid, None)

        # Orphan has no modal_call_id so recovery skips the Modal check and
        # goes straight to update_job_error — no Modal import needed.
        from app.session_init import user_session_init
        user_session_init(uid)

        # Restore context for assertions (user_session_init set it already).
        set_current_user_id(uid)
        set_current_profile_id(pid)
        with get_db_connection() as conn:
            cur = conn.cursor()
            job_status = cur.execute(
                "SELECT status FROM export_jobs WHERE type='test'"
            ).fetchone()["status"]
            task_status = cur.execute(
                "SELECT status FROM modal_tasks WHERE task_type='__unknown_for_test__'"
            ).fetchone()["status"]

        assert job_status == "error", f"orphan job should be reconciled, got {job_status}"
        assert task_status != "pending", f"modal task should have been claimed, got {task_status}"

    def test_recovery_is_gated_by_cache(self):
        """Second call to user_session_init must not rerun recovery."""
        from app.session_init import _init_cache, user_session_init
        from app.services.user_db import create_profile, set_selected_profile_id

        uid = _uid("cached")
        pid = uuid4().hex[:8]
        _seed_orphans_for(uid, pid)
        create_profile(uid, pid, "Test", "#000", is_default=True)
        set_selected_profile_id(uid, pid)
        _init_cache.pop(uid, None)

        call_count = {"n": 0}

        async def _counting_recovery(user_id):
            call_count["n"] += 1

        with patch("app.session_init._run_startup_recovery", _counting_recovery):
            user_session_init(uid)   # slow path -> schedules once
            user_session_init(uid)   # cache hit -> must NOT schedule again
            user_session_init(uid)

        assert call_count["n"] == 1, f"expected 1 recovery invocation, got {call_count['n']}"


class TestRunningLoopPath:
    """Covers the production path where an event loop is already running.

    user_session_init is called from sync middleware inside an async
    FastAPI request, so there IS a running loop. The scheduler must:
      1. Return immediately (create_task is fire-and-forget).
      2. Propagate the caller's user_id / profile_id ContextVars into
         the background task via the default context copy semantics.
      3. Not block the caller on the recovery's duration.
    """

    @pytest.mark.asyncio
    async def test_create_task_branch_propagates_context_and_does_not_block(self):
        from app.session_init import (
            _init_cache, user_session_init, _run_startup_recovery as _real,
        )
        from app.services.user_db import create_profile, set_selected_profile_id
        from app.user_context import get_current_user_id
        from app.profile_context import get_current_profile_id

        uid = _uid("loop")
        pid = uuid4().hex[:8]
        _seed_orphans_for(uid, pid)
        create_profile(uid, pid, "Test", "#000", is_default=True)
        set_selected_profile_id(uid, pid)
        _init_cache.pop(uid, None)

        observed = {}
        gate = asyncio.Event()

        async def _spy(user_id: str):
            # Sleep long enough that a blocking caller would be obvious.
            await asyncio.sleep(0.2)
            observed["user_id_arg"] = user_id
            observed["ctx_user_id"] = get_current_user_id()
            observed["ctx_profile_id"] = get_current_profile_id()
            gate.set()

        with patch("app.session_init._run_startup_recovery", _spy):
            started = time.perf_counter()
            user_session_init(uid)
            elapsed = time.perf_counter() - started

        # create_task must return immediately — user_session_init returning
        # cannot have waited 200ms for the background task.
        assert elapsed < 0.1, (
            f"user_session_init blocked for {elapsed:.3f}s — create_task "
            f"should be fire-and-forget"
        )

        # Now drain the scheduled task.
        await asyncio.wait_for(gate.wait(), timeout=2.0)

        assert observed["user_id_arg"] == uid
        assert observed["ctx_user_id"] == uid, (
            "user_id ContextVar did not propagate into create_task"
        )
        assert observed["ctx_profile_id"] == pid, (
            "profile_id ContextVar did not propagate into create_task"
        )


class TestErrorIsolation:
    """If recover_orphaned_jobs raises, process_modal_queue must still run."""

    @pytest.mark.asyncio
    async def test_queue_drain_runs_even_if_orphan_recovery_raises(self):
        from app import session_init as si
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        uid = _uid("isolerr")
        pid = uuid4().hex[:8]
        _seed_orphans_for(uid, pid)
        set_current_user_id(uid)
        set_current_profile_id(pid)

        queue_called = {"n": 0}

        async def _boom():
            raise RuntimeError("orphan recovery exploded")

        async def _ok_queue():
            queue_called["n"] += 1
            return {"processed": 0, "succeeded": 0, "failed": 0}

        with patch("app.services.export_worker.recover_orphaned_jobs", _boom), \
             patch("app.services.modal_queue.process_modal_queue", _ok_queue):
            # Call the inner coroutine directly so we test _run_startup_recovery's
            # try/except structure, not the scheduler.
            await si._run_startup_recovery(uid)

        assert queue_called["n"] == 1, (
            "process_modal_queue must run even when recover_orphaned_jobs raises"
        )
