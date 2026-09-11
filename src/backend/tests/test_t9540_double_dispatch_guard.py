"""
T9540 — no duplicate export job / no duplicate charge on double-click.

Design: docs/plans/tasks/T9540-design.md §3a (APPROVED 2026-09-11).

The double-click vector is NOT the double-finalize race T7210's
`_claim_stage_for_finalize` guards (that gates ONE job finishing twice). Two
rapid clicks generate two DISTINCT client `export_id`s -> two independent
`export_jobs` rows -> two credit reservations -> two charges. Neither the
finalize-CAS nor the export_id-keyed credit reservation dedups this.

The durable guard is an ATOMIC per-(project, type) in-flight check at job
creation, BEFORE any credit reservation: a conditional INSERT that lands the
row only when no active ('pending'/'processing') job already exists for that
(project, type). The shared helper returns True when it inserted (caller
proceeds to reserve + dispatch) and False when an active job already exists
(caller returns 409 export_in_flight, reserves nothing).

These tests target that helper directly (the durable layer). They are RED
until `insert_export_job_if_none_active` exists in export_helpers.

Run: pytest src/backend/tests/test_t9540_double_dispatch_guard.py -v
"""

import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t9540_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

from app.session_init import _init_cache

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    import shutil

    from app.database import USER_DATA_BASE
    from app.user_context import reset_user_id, set_current_user_id

    set_current_user_id(TEST_USER_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    # Set the request context INSIDE the fixture (before startup) so the per-user
    # profile DB is initialized under the right user — otherwise a later direct
    # get_db_connection() races an uninitialized DB and locks.
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID}) as c:
        yield c


@pytest.fixture
def project_id(client):
    """A bare project row to hang export jobs off of."""
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)",
            ("T9540 dispatch guard", "9:16"),
        )
        conn.commit()
        return cur.lastrowid


def _count_jobs(project_id: int, export_type: str) -> int:
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) AS n FROM export_jobs WHERE project_id = ? AND type = ?",
            (project_id, export_type),
        )
        return cur.fetchone()["n"]


def _set_status(export_id: str, status: str) -> None:
    from app.database import get_db_connection

    with get_db_connection() as conn:
        conn.execute("UPDATE export_jobs SET status = ? WHERE id = ?", (status, export_id))
        conn.commit()


def test_first_dispatch_inserts_and_returns_true(project_id):
    from app.services.export_helpers import insert_export_job_if_none_active

    eid = f"export_{uuid.uuid4().hex}"
    ok = insert_export_job_if_none_active(eid, project_id, "framing")
    assert ok is True
    assert _count_jobs(project_id, "framing") == 1


def test_second_concurrent_dispatch_blocked_no_second_row(project_id):
    """The double-click: a second dispatch for the same (project, type) while the
    first is still processing must NOT create a second row and must return False."""
    from app.services.export_helpers import insert_export_job_if_none_active

    first = f"export_{uuid.uuid4().hex}"
    second = f"export_{uuid.uuid4().hex}"

    assert insert_export_job_if_none_active(first, project_id, "framing") is True
    # First job is 'processing' (the INSERT default) — simulate the in-flight window.
    assert insert_export_job_if_none_active(second, project_id, "framing") is False
    assert _count_jobs(project_id, "framing") == 1


def test_different_type_allowed_same_project(project_id):
    """Focus (framing) then Spotlight (overlay) for the same project is legitimate —
    different `type`, so the second is allowed even while the first is in-flight."""
    from app.services.export_helpers import insert_export_job_if_none_active

    assert insert_export_job_if_none_active(f"export_{uuid.uuid4().hex}", project_id, "framing") is True
    assert insert_export_job_if_none_active(f"export_{uuid.uuid4().hex}", project_id, "overlay") is True
    assert _count_jobs(project_id, "framing") == 1
    assert _count_jobs(project_id, "overlay") == 1


def _seed_active_job(project_id: int, export_type: str) -> str:
    """Simulate the first click's job being in-flight."""
    from app.database import get_db_connection

    eid = f"first_{uuid.uuid4().hex}"
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO export_jobs (id, project_id, type, status, input_data) VALUES (?, ?, ?, 'processing', '{}')",
            (eid, project_id, export_type),
        )
        conn.commit()
    return eid


def test_render_endpoint_returns_409_when_active_framing_job_exists(client, project_id):
    """Endpoint wiring: the /render guard runs before any credit reservation, so a
    second dispatch while a framing job is in-flight gets 409 export_in_flight and
    reserves nothing (no duplicate charge)."""
    _seed_active_job(project_id, "framing")
    resp = client.post(
        "/api/export/render",
        json={"project_id": project_id, "export_id": f"dup_{uuid.uuid4().hex}"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "export_in_flight"
    # The duplicate export_id must NOT have created a second row.
    assert _count_jobs(project_id, "framing") == 1


def test_render_overlay_endpoint_returns_409_when_active_overlay_job_exists(client, project_id):
    """Endpoint wiring for the free effects render: a second dispatch while an overlay
    job is in-flight gets 409 and creates no duplicate job row."""
    _seed_active_job(project_id, "overlay")
    resp = client.post(
        "/api/export/render-overlay",
        json={"project_id": project_id, "export_id": f"dup_{uuid.uuid4().hex}", "effect_type": "dark_overlay"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "export_in_flight"
    assert _count_jobs(project_id, "overlay") == 1


def test_rerender_allowed_after_terminal_state(project_id):
    """After the first job reaches a terminal state, a fresh dispatch is allowed —
    this is what lets a legitimate re-render charge again (§3b)."""
    from app.services.export_helpers import insert_export_job_if_none_active

    first = f"export_{uuid.uuid4().hex}"
    assert insert_export_job_if_none_active(first, project_id, "framing") is True

    _set_status(first, "complete")
    second = f"export_{uuid.uuid4().hex}"
    assert insert_export_job_if_none_active(second, project_id, "framing") is True
    assert _count_jobs(project_id, "framing") == 2

    # And a failed job likewise frees the slot for a retry.
    _set_status(second, "error")
    third = f"export_{uuid.uuid4().hex}"
    assert insert_export_job_if_none_active(third, project_id, "framing") is True
    assert _count_jobs(project_id, "framing") == 3
