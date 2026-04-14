"""
T1380 + T1390: Per-user startup recovery runs lazily on user_session_init.

Verifies that orphaned export jobs and pending modal queue tasks are reconciled
on the user's first session init (once per user per process) — replacing the
boot-time loop that needed user context it didn't have.
"""

import sys
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

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
