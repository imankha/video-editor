"""
T4380 — ExportJobRepository unit tests.

Design: docs/plans/tasks/export-write-path/T4380-export-job-repository.md.
Every export_jobs INSERT/UPDATE in the codebase now goes through
app.services.export_job_repository — these tests exercise the repository
directly (transitions + raise-on-insert-failure), independent of T4370's
golden harness (which pins end-to-end trigger behavior, not this module's
internals).

Run: pytest src/backend/tests/test_t4380_export_job_repository.py -v
"""

import sys
import uuid
from pathlib import Path

import pytest
import sqlite3

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t4380_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

from app.session_init import _init_cache  # noqa: E402

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    import shutil

    from app.database import USER_DATA_BASE
    from app.user_context import reset_user_id

    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID}) as c:
        yield c


@pytest.fixture
def project_id(client):
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)",
            ("T4380 repository", "9:16"),
        )
        conn.commit()
        return cur.lastrowid


def _job_id() -> str:
    return f"export_{uuid.uuid4().hex[:12]}"


def _row(job_id: str) -> dict:
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
        row = cur.fetchone()
        return dict(row) if row else None


# =============================================================================
# create()
# =============================================================================

def test_create_inserts_pending(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    job_id = _job_id()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        returned = repo.create(cursor, job_id=job_id, project_id=project_id, job_type="framing", input_data=b"\x80")
        conn.commit()

    assert returned == job_id
    row = _row(job_id)
    assert row["status"] == "pending"
    assert row["project_id"] == project_id
    assert row["type"] == "framing"


def test_create_raises_on_insert_failure(project_id):
    """T4380: insert failure RAISES (no swallow) -- the documented behavior
    change from the old export_helpers.create_export_job. Forced via a
    duplicate primary key (id is TEXT PRIMARY KEY)."""
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    job_id = _job_id()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        repo.create(cursor, job_id=job_id, project_id=project_id, job_type="framing", input_data=b"\x80")
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        with pytest.raises(sqlite3.IntegrityError):
            repo.create(cursor, job_id=job_id, project_id=project_id, job_type="framing", input_data=b"\x80")


# =============================================================================
# create_if_none_active()
# =============================================================================

def test_create_if_none_active_inserts_processing_when_none_active(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    job_id = _job_id()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        inserted = repo.create_if_none_active(cursor, job_id=job_id, project_id=project_id, job_type="overlay", input_data=b"\x80")
        conn.commit()

    assert inserted is True
    row = _row(job_id)
    assert row["status"] == "processing"


def test_create_if_none_active_blocks_duplicate_dispatch(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    first, second = _job_id(), _job_id()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        assert repo.create_if_none_active(cursor, job_id=first, project_id=project_id, job_type="overlay", input_data=b"\x80") is True
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        blocked = repo.create_if_none_active(cursor, job_id=second, project_id=project_id, job_type="overlay", input_data=b"\x80")
        conn.commit()

    assert blocked is False
    assert _row(second) is None


def test_create_if_none_active_allows_after_terminal(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    first, second = _job_id(), _job_id()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        repo.create_if_none_active(cursor, job_id=first, project_id=project_id, job_type="overlay", input_data=b"\x80")
        repo.fail(cursor, first, "boom")
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        allowed = repo.create_if_none_active(cursor, job_id=second, project_id=project_id, job_type="overlay", input_data=b"\x80")
        conn.commit()

    assert allowed is True


# =============================================================================
# start / complete / fail / recover
# =============================================================================

def _create(cursor, project_id, job_type="framing"):
    from app.services import export_job_repository as repo

    job_id = _job_id()
    repo.create(cursor, job_id=job_id, project_id=project_id, job_type=job_type, input_data=b"\x80")
    return job_id


def test_start_transitions_pending_to_processing(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.start(cursor, job_id)
        conn.commit()

    row = _row(job_id)
    assert row["status"] == "processing"
    assert row["started_at"] is not None


def test_complete_direct_set_writes_output_refs(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.complete(cursor, job_id, output_video_id=42, output_filename="out.mp4", gpu_seconds=1.5, modal_function="fn")
        conn.commit()

    row = _row(job_id)
    assert row["status"] == "complete"
    assert row["output_video_id"] == 42
    assert row["output_filename"] == "out.mp4"
    assert row["gpu_seconds"] == 1.5
    assert row["modal_function"] == "fn"
    assert row["completed_at"] is not None


def test_complete_direct_set_overwrites_with_none(project_id):
    """Direct-set (preserve_gpu_metadata=False, the default) nulls gpu/modal
    when not supplied -- matches every call site that either always supplies
    fresh values or never populates those columns for this job at all."""
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.store_modal_call_id(cursor, job_id, "call_abc")
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        repo.complete(cursor, job_id)  # no output/gpu kwargs at all
        conn.commit()

    row = _row(job_id)
    assert row["status"] == "complete"
    assert row["output_video_id"] is None
    assert row["gpu_seconds"] is None


def test_complete_preserve_gpu_metadata_coalesces(project_id):
    """preserve_gpu_metadata=True: a resumed finalize call omitting gpu/modal
    keeps the PRIOR value instead of nulling it out (export_finalize's resumable
    upsert)."""
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.complete(cursor, job_id, output_video_id=1, output_filename="a.mp4", gpu_seconds=9.0, modal_function="fn_a", preserve_gpu_metadata=True)
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Resume: same job re-completed with NO gpu/modal supplied.
        repo.complete(cursor, job_id, output_video_id=1, output_filename="a.mp4", preserve_gpu_metadata=True)
        conn.commit()

    row = _row(job_id)
    assert row["gpu_seconds"] == 9.0
    assert row["modal_function"] == "fn_a"


def test_fail_sets_error_status_and_message(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.fail(cursor, job_id, "boom")
        conn.commit()

    row = _row(job_id)
    assert row["status"] == "error"
    assert row["error"] == "boom"
    assert row["completed_at"] is not None


def test_recover_resets_error_to_processing(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.fail(cursor, job_id, "transient")
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        repo.recover(cursor, job_id)
        conn.commit()

    row = _row(job_id)
    assert row["status"] == "processing"
    assert row["error"] is None
    assert row["completed_at"] is None


def test_clear_pending_on_startup_bulk_errors_active_jobs(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        pending_job = _create(cursor, project_id)
        processing_job = _create(cursor, project_id)
        repo.start(cursor, processing_job)
        done_job = _create(cursor, project_id)
        repo.complete(cursor, done_job, output_video_id=1, output_filename="x.mp4")
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Bulk clear is deliberately DB-wide (matches production: a startup
        # sweep, not scoped to one project) -- other tests in this module may
        # have left their own pending/processing rows behind, so assert on
        # THESE jobs' outcome, not the total rowcount.
        n = repo.clear_pending_on_startup(cursor)
        conn.commit()

    assert n >= 2
    assert _row(pending_job)["status"] == "error"
    assert _row(processing_job)["status"] == "error"
    assert _row(done_job)["status"] == "complete"  # untouched


# =============================================================================
# acknowledge()
# =============================================================================

def test_acknowledge_specific_ids(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_a = _create(cursor, project_id)
        job_b = _create(cursor, project_id)
        repo.fail(cursor, job_a, "x")
        repo.fail(cursor, job_b, "x")
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        n = repo.acknowledge(cursor, [job_a])
        conn.commit()

    assert n == 1
    assert _row(job_a)["acknowledged_at"] is not None
    assert _row(job_b)["acknowledged_at"] is None


def test_acknowledge_all_terminal_when_no_ids_given(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        done_job = _create(cursor, project_id)
        repo.complete(cursor, done_job, output_video_id=1, output_filename="x.mp4")
        pending_job = _create(cursor, project_id)
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        repo.acknowledge(cursor, None)
        conn.commit()

    assert _row(done_job)["acknowledged_at"] is not None
    assert _row(pending_job)["acknowledged_at"] is None  # not terminal, untouched


# =============================================================================
# Modal call id / stage checkpoints
# =============================================================================

def test_store_modal_call_id(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.store_modal_call_id(cursor, job_id, "call_xyz")
        conn.commit()

    row = _row(job_id)
    assert row["modal_call_id"] == "call_xyz"
    assert row["started_at"] is not None


def test_store_modal_call_id_with_stage_sets_stage_and_output_key(project_id):
    from app.database import get_db_connection
    from app.constants import ExportStage
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.store_modal_call_id_with_stage(cursor, job_id, "call_xyz", ExportStage.RENDERING.value, "working_videos/x.mp4")
        conn.commit()

    row = _row(job_id)
    assert row["modal_call_id"] == "call_xyz"
    assert row["stage"] == "rendering"
    assert row["output_key"] == "working_videos/x.mp4"


def test_set_input_data_checkpoint(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.set_input_data_checkpoint(cursor, job_id, b"\x82checkpoint")
        conn.commit()

    assert _row(job_id)["input_data"] == b"\x82checkpoint"


def test_set_rendered_checkpoint(project_id):
    from app.database import get_db_connection
    from app.constants import ExportStage
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.set_rendered_checkpoint(cursor, job_id, ExportStage.RENDERED.value, "working_videos/y.mp4")
        conn.commit()

    row = _row(job_id)
    assert row["stage"] == "rendered"
    assert row["output_key"] == "working_videos/y.mp4"


def test_set_stage(project_id):
    from app.database import get_db_connection
    from app.constants import ExportStage
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.set_stage(cursor, job_id, ExportStage.DETECTING.value)
        conn.commit()

    assert _row(job_id)["stage"] == "detecting"


def test_claim_stage_for_finalize_cas_succeeds_on_matching_snapshot(project_id):
    from app.database import get_db_connection
    from app.constants import ExportStage
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.set_stage(cursor, job_id, ExportStage.RENDERED.value)
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        won = repo.claim_stage_for_finalize(cursor, job_id, ExportStage.RENDERED.value, ExportStage.DETECTING.value)
        conn.commit()

    assert won is True
    assert _row(job_id)["stage"] == "detecting"


def test_claim_stage_for_finalize_cas_loses_on_stale_snapshot(project_id):
    """A second caller racing in with a stale (already-advanced-past) snapshot
    loses the CAS -- T7210's double-finalize guard."""
    from app.database import get_db_connection
    from app.constants import ExportStage
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        job_id = _create(cursor, project_id)
        repo.set_stage(cursor, job_id, ExportStage.RENDERED.value)
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Winner advances rendered -> detecting.
        assert repo.claim_stage_for_finalize(cursor, job_id, ExportStage.RENDERED.value, ExportStage.DETECTING.value) is True
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Loser's snapshot (still 'rendered') no longer matches the DB ('detecting').
        lost = repo.claim_stage_for_finalize(cursor, job_id, ExportStage.RENDERED.value, ExportStage.DETECTING.value)
        conn.commit()

    assert lost is False


# =============================================================================
# Reads
# =============================================================================

def test_get_returns_none_for_missing_job(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        assert repo.get(cursor, "export_does_not_exist") is None


def test_get_stale_candidates_only_returns_old_active_jobs(project_id):
    from app.database import get_db_connection
    from app.services import export_job_repository as repo

    with get_db_connection() as conn:
        cursor = conn.cursor()
        old_job = _create(cursor, project_id)
        cursor.execute(
            "UPDATE export_jobs SET created_at = datetime('now', '-120 minutes') WHERE id = ?",
            (old_job,),
        )
        fresh_job = _create(cursor, project_id)
        old_done_job = _create(cursor, project_id)
        repo.complete(cursor, old_done_job, output_video_id=1, output_filename="x.mp4")
        cursor.execute(
            "UPDATE export_jobs SET created_at = datetime('now', '-120 minutes') WHERE id = ?",
            (old_done_job,),
        )
        conn.commit()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        candidates = repo.get_stale_candidates(cursor, max_age_minutes=60)
        candidate_ids = {row["id"] for row in candidates}

    assert old_job in candidate_ids
    assert fresh_job not in candidate_ids
    assert old_done_job not in candidate_ids  # terminal status excluded regardless of age
