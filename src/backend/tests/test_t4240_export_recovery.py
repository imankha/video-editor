"""
T4240 regression tests for the export-recovery defects (defect #1, the undefined
`presigned_url` NameError, was already fixed by T4790 -- see
test_t4790_undefined_name_bugs.py). These cover the remaining three:

#2 A Modal API error must NOT mark a live job dead: check_modal_job_running returns
   None (unknown) and cleanup_stale_exports skips unknown-status jobs.
#3 A Modal result with no output_key must fail loudly (mark error), never fabricate
   recovered_{job_id}.mp4 or insert a working_videos row pointing at a missing object.
#4 export_worker's error handler must not itself raise when config decode fails.
"""

import sqlite3
from contextlib import contextmanager

import pytest


def _in_memory_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        "CREATE TABLE export_jobs (id TEXT PRIMARY KEY, project_id INTEGER, status TEXT, "
        "output_video_id INTEGER, output_filename TEXT, error TEXT, modal_call_id TEXT, "
        "created_at TEXT, completed_at TEXT)"
    )
    cur.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY, working_video_id INTEGER)")
    cur.execute(
        "CREATE TABLE working_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, filename TEXT)"
    )
    cur.execute("INSERT INTO projects (id, working_video_id) VALUES (?, ?)", (42, None))
    conn.commit()
    return conn


def _patch_conn(monkeypatch, conn):
    @contextmanager
    def _fake_conn():
        yield conn  # shared connection; do not close between calls

    from app.routers import exports
    monkeypatch.setattr(exports, "get_db_connection", _fake_conn)
    return exports


# --- #3: no fabricated filename ---------------------------------------------

@pytest.mark.asyncio
async def test_missing_output_key_delegates_empty_and_no_milestone(monkeypatch):
    """T5630: finalize_modal_export now delegates to finalize_export. With no
    persisted output_key AND no modal_result output_key, it passes output_key=''
    (the guard trigger — finalize_export fails loudly / never fabricates a row;
    that end behavior is covered by test_t5630_finalize_unit +
    test_t5630_characterization). No recovery milestone on a non-finalized result."""
    from app.profile_context import set_current_profile_id
    from app.routers import exports
    from app.services import export_finalize

    set_current_profile_id("testprofile")
    captured = {}
    milestones = []

    async def fake_finalize_export(job, output_key, user_id, profile_id, **kwargs):
        captured["output_key"] = output_key
        return {"finalized": False, "error": "Modal result incomplete: no output_key"}

    monkeypatch.setattr(export_finalize, "finalize_export", fake_finalize_export)
    monkeypatch.setattr(exports, "record_milestone", lambda *a, **k: milestones.append(a))

    result = await exports.finalize_modal_export(
        job={"id": "job-3", "project_id": 42}, modal_result={}, user_id="user-1",
    )

    assert result["finalized"] is False
    assert "output_key" in result["error"]
    assert captured["output_key"] == ""
    assert not milestones


# --- #2: Modal API error -> unknown, live job untouched ----------------------

def test_check_modal_job_running_is_none_on_lookup_error(monkeypatch):
    """A Modal API/transport error looking up the call returns None (unknown), never
    False (which would let cleanup mark a live job dead)."""
    from app.routers import exports
    import modal

    def _boom(_call_id):
        raise RuntimeError("modal API unavailable")

    monkeypatch.setattr(modal.FunctionCall, "from_id", staticmethod(_boom))
    assert exports.check_modal_job_running("call-xyz") is None


def test_cleanup_skips_jobs_with_unknown_modal_status(monkeypatch):
    """cleanup_stale_exports must leave a stale job UNTOUCHED when Modal status is
    unknown (None); it may only mark error on positive evidence (False)."""
    conn = _in_memory_db()
    exports = _patch_conn(monkeypatch, conn)
    # An old 'processing' job with a modal_call_id (a candidate for cleanup).
    conn.execute(
        "INSERT INTO export_jobs (id, project_id, status, modal_call_id, created_at) "
        "VALUES (?, ?, ?, ?, datetime('now', '-120 minutes'))",
        ("job-2", 42, "processing", "call-abc"),
    )
    conn.commit()

    # Unknown status -> must be skipped.
    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: None)
    exports.cleanup_stale_exports(max_age_minutes=60)
    assert conn.execute("SELECT status FROM export_jobs WHERE id='job-2'").fetchone()["status"] == "processing"

    # Control: positive 'not running' (False) -> marked error.
    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: False)
    exports.cleanup_stale_exports(max_age_minutes=60)
    assert conn.execute("SELECT status FROM export_jobs WHERE id='job-2'").fetchone()["status"] == "error"


# --- #4: error handler must not itself raise ---------------------------------

@pytest.mark.asyncio
async def test_worker_error_handler_survives_config_decode_failure(monkeypatch):
    """If decode_data(job['input_data']) fails, the except handler reads config/
    job_type/project_id -- they must already be bound so the handler marks the job
    error instead of crashing with NameError/UnboundLocalError."""
    import app.services.export_worker as w

    job = {"id": "job-4", "project_id": 42, "type": "framing", "status": "pending", "input_data": b"garbage"}

    errors = []
    monkeypatch.setattr(w, "get_export_job", lambda _id: job)
    monkeypatch.setattr(w, "update_job_started", lambda *a, **k: None)
    monkeypatch.setattr(w, "update_job_error", lambda jid, msg: errors.append((jid, msg)))
    monkeypatch.setattr(w, "record_milestone", lambda *a, **k: None)
    monkeypatch.setattr(w, "_sync_after_export", lambda *a, **k: None)

    async def _no_progress(*a, **k):
        return None
    monkeypatch.setattr(w, "send_progress", _no_progress)

    def _boom(_data):
        raise ValueError("cannot decode input_data")
    monkeypatch.setattr(w, "decode_data", _boom)

    # Must NOT raise (pre-fix: the handler crashed on config.get(...) with config unbound).
    await w.process_export_job("job-4")

    assert errors and errors[0][0] == "job-4"  # job was marked error cleanly
