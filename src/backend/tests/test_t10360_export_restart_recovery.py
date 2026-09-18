"""
T10360 regression tests: a deploy that replaces the Fly machine mid-export must
not destroy the export, and a failure declared out-of-band must refund.

Incident (staging, 2026-09-18): a redeploy landed while sakarati@'s Focus export
was rendering. Modal kept going and uploaded the finished video, but the next
session-init ran `recover_orphaned_jobs`, whose ad-hoc Modal liveness check fell
through its `except Exception` to "mark as error" -- so the job left the active
list and `/modal-status` (which CAN see the finished render in R2) was never
polled for it. 11 credits charged, no reel, no refund.

Two independent defects, one test file:
  #1 recover_orphaned_jobs must never fail a job that was DISPATCHED to Modal.
  #2 out-of-band failure paths must refund what the export charged.
"""

import sqlite3
from contextlib import contextmanager

import pytest

from app.services.credit_ledger import (
    confirm_reservation,
    get_balance,
    grant,
    refund_credits,
    refund_export_charge,
    reserve_credits,
)

USER = "user-a"   # registered in conftest._TEST_USER_IDS, so the fixture cleans it


# =============================================================================
# #1 recover_orphaned_jobs: a dispatched job is never failed here
# =============================================================================

# The real export_jobs DDL, lifted verbatim from app/database.py's ensure_database
# (minus the projects FK, which needs the rest of the schema). A hand-written
# subset silently drifts -- these tests depend on stage/output_key/created_at,
# none of which the old ad-hoc 9-column table had.
_EXPORT_JOBS_DDL = """
CREATE TABLE export_jobs (
    id TEXT PRIMARY KEY, project_id INTEGER, type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', error TEXT, input_data BLOB NOT NULL,
    output_video_id INTEGER, output_filename TEXT, modal_call_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, started_at TIMESTAMP,
    completed_at TIMESTAMP, game_id INTEGER, game_name TEXT,
    acknowledged_at TIMESTAMP, gpu_seconds REAL, modal_function TEXT,
    stage TEXT DEFAULT 'queued', output_key TEXT
)
"""


def _jobs_db(**overrides):
    """One 'processing' export_jobs row ('job-1') on the real schema."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(_EXPORT_JOBS_DDL)
    row = {
        "id": "job-1", "project_id": 42, "type": "framing", "status": "processing",
        "input_data": b"{}", "modal_call_id": None, "output_key": None,
        "created_at": "datetime('now')",
    }
    row.update(overrides)
    created = row.pop("created_at")
    cols = ", ".join(row) + ", created_at"
    marks = ", ".join("?" * len(row)) + f", {created}"
    conn.execute(f"INSERT INTO export_jobs ({cols}) VALUES ({marks})", tuple(row.values()))
    conn.commit()
    return conn


def _orphan_db(modal_call_id):
    return _jobs_db(modal_call_id=modal_call_id)


def _run_recovery(monkeypatch, conn, *, modal_running):
    """Drive recover_orphaned_jobs against `conn`, with the Modal liveness check
    stubbed to `modal_running` (True / False / None). Returns refunded job ids."""
    from app.routers import exports
    from app.services import export_helpers, export_worker

    @contextmanager
    def _fake_conn():
        yield conn

    refunded = []
    monkeypatch.setenv("CLEAR_PENDING_JOBS_ON_STARTUP", "false")
    monkeypatch.setattr(export_worker, "get_db_connection", _fake_conn)
    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: modal_running)
    monkeypatch.setattr(export_helpers, "refund_failed_export", lambda jid: refunded.append(jid))

    export_worker.recover_orphaned_jobs()
    return refunded


def _status(conn):
    return conn.execute("SELECT status FROM export_jobs WHERE id='job-1'").fetchone()["status"]


@pytest.mark.parametrize(
    "modal_running,label",
    [
        (None, "unknown (lookup/transport error)"),
        (False, "finished on Modal"),
        (True, "still running on Modal"),
    ],
)
def test_dispatched_job_is_never_failed_by_startup_recovery(monkeypatch, modal_running, label):
    """THE incident regression. Whatever Modal answers, a job carrying a
    modal_call_id stays 'processing' so `/modal-status` gets its chance to
    HEAD-probe the render output and finalize. `None` is the exact path that
    lost sakarati@'s export; `False` matters just as much, because Modal
    reporting "finished" is precisely when there IS a finished video to
    recover -- failing it here hides the render instead of delivering it."""
    conn = _orphan_db("fc-abc123")
    refunded = _run_recovery(monkeypatch, conn, modal_running=modal_running)

    assert _status(conn) == "processing", f"dispatched job was failed on Modal status {label}"
    assert refunded == [], "a job that may still deliver must not be refunded yet"


def test_undispatched_job_is_failed_and_refunded(monkeypatch):
    """The genuinely-dead case: no modal_call_id means the render never left
    this process, so nothing is running anywhere. Fail it -- and give the
    credits back, which the in-process handler never got to do."""
    conn = _orphan_db(None)
    refunded = _run_recovery(monkeypatch, conn, modal_running=None)

    row = conn.execute("SELECT status, error FROM export_jobs WHERE id='job-1'").fetchone()
    assert row["status"] == "error"
    assert row["error"] == "Server restarted during processing"
    assert refunded == ["job-1"], "a killed undispatched export must be refunded"


# =============================================================================
# #2 refund_export_charge: exact, once, derived from the charge itself
# =============================================================================

def _charge(job_id, amount, seconds=10.5):
    """Put a real framing_usage debit on the ledger, the way an export does."""
    assert reserve_credits(USER, amount, job_id, seconds, profile_id="p1")["success"]
    assert confirm_reservation(USER, job_id)


class TestRefundExportCharge:
    def test_refunds_exactly_what_was_charged(self, pg_conn):
        grant(USER, 100, "admin_grant", "admin:seed-1")
        _charge("export-a", 11)
        assert get_balance(USER) == 89

        assert refund_export_charge(USER, "export-a") == 11
        assert get_balance(USER) == 100

    def test_second_call_is_a_no_op(self, pg_conn):
        grant(USER, 100, "admin_grant", "admin:seed-2")
        _charge("export-b", 11)

        assert refund_export_charge(USER, "export-b") == 11
        assert refund_export_charge(USER, "export-b") == 0
        assert get_balance(USER) == 100, "double refund"

    def test_does_not_double_refund_after_the_in_process_handler(self, pg_conn):
        """The in-process failure handler and a recovery path can both fire for
        the same export. They share the `refund:{export_id}` key, so the second
        one applies nothing."""
        grant(USER, 100, "admin_grant", "admin:seed-3")
        _charge("export-c", 11)

        refund_credits(USER, 11, "export-c", 10.5)  # in-process handler
        assert get_balance(USER) == 100

        assert refund_export_charge(USER, "export-c") == 0
        assert get_balance(USER) == 100

    def test_uncharged_export_refunds_nothing(self, pg_conn):
        """A free export, or one whose reservation was released before it was
        ever confirmed, has no debit row -- nothing is owed and nothing is
        invented."""
        grant(USER, 100, "admin_grant", "admin:seed-4")
        assert refund_export_charge(USER, "never-charged") == 0
        assert get_balance(USER) == 100


# =============================================================================
# cleanup_stale_exports: deliver a finished render, and never strand a job
# =============================================================================

@contextmanager
def _sweep_env(monkeypatch, conn, *, modal_running, r2_has=()):
    """Point exports.cleanup_stale_exports at `conn`, stub the Modal liveness
    answer and which output_keys exist in R2. Yields the refunded job ids."""
    from app.routers import exports
    from app.services import export_helpers

    @contextmanager
    def _fake_conn():
        yield conn

    refunded = []
    monkeypatch.setattr(exports, "get_db_connection", _fake_conn)
    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: modal_running)
    monkeypatch.setattr(exports, "get_current_user_id", lambda: USER)
    monkeypatch.setattr(exports, "file_exists_in_r2", lambda _u, key: key in r2_has)
    monkeypatch.setattr(export_helpers, "refund_failed_export", lambda jid: refunded.append(jid))
    yield refunded


def test_stale_job_whose_render_is_in_r2_is_left_to_finalize(monkeypatch):
    """BLOCKING 2. A generator call that FINISHED reports the same "not running"
    as one that died, so status alone cannot tell them apart -- but the render
    object can. When it is there, the job must stay active for /modal-status to
    finalize; failing+refunding it here bins a reel the user paid for and which
    actually exists (the incident, 60 minutes later)."""
    from app.routers import exports
    conn = _jobs_db(output_key="working_videos/working_1_9ff78631.mp4",
                    modal_call_id="fc-abc", created_at="datetime('now', '-120 minutes')")

    with _sweep_env(monkeypatch, conn, modal_running=False,
                    r2_has=("working_videos/working_1_9ff78631.mp4",)) as refunded:
        exports.cleanup_stale_exports(max_age_minutes=60)

    assert _status(conn) == "processing", "a finished render was swept away"
    assert refunded == [], "refunding here would replace the reel with credits"


def test_stale_job_with_no_render_in_r2_is_failed_and_refunded(monkeypatch):
    """Control for the above: same job, but the render object never appeared."""
    from app.routers import exports
    conn = _jobs_db(output_key="working_videos/working_1_9ff78631.mp4",
                    modal_call_id="fc-abc", created_at="datetime('now', '-120 minutes')")

    with _sweep_env(monkeypatch, conn, modal_running=False, r2_has=()) as refunded:
        exports.cleanup_stale_exports(max_age_minutes=60)

    assert _status(conn) == "error"
    assert refunded == ["job-1"]


def test_permanently_unknown_job_is_eventually_given_up_on(monkeypatch):
    """BLOCKING 1. For a generator call the Modal lookup can fail identically on
    every sweep, so "skip and re-check next time" never converges. A job pinned
    at 'processing' forever blocks its project from EVER being re-exported
    (insert_export_job_if_none_active -> 409 export_in_flight) and never returns
    the credits. Past the give-up age, with no render in R2, it is dead."""
    from app.routers import exports

    young = _jobs_db(modal_call_id="fc-abc", created_at="datetime('now', '-90 minutes')")
    with _sweep_env(monkeypatch, young, modal_running=None) as refunded:
        exports.cleanup_stale_exports(max_age_minutes=60)
    assert _status(young) == "processing", "gave up before the Modal timeout could elapse"
    assert refunded == []

    old = _jobs_db(modal_call_id="fc-abc",
                   created_at=f"datetime('now', '-{exports.UNKNOWN_MODAL_GIVEUP_MINUTES + 30} minutes')")
    with _sweep_env(monkeypatch, old, modal_running=None) as refunded:
        exports.cleanup_stale_exports(max_age_minutes=60)
    assert _status(old) == "error", "job stranded at 'processing' forever"
    assert refunded == ["job-1"]


def test_sweep_refunds_only_the_jobs_it_swept(monkeypatch):
    """The refund loop runs over `swept`, not over every candidate -- a job left
    running or left to finalize must not be refunded out from under itself."""
    from app.routers import exports
    conn = _jobs_db(modal_call_id="fc-abc", created_at="datetime('now', '-120 minutes')")

    with _sweep_env(monkeypatch, conn, modal_running=True) as refunded:
        exports.cleanup_stale_exports(max_age_minutes=60)

    assert _status(conn) == "processing"
    assert refunded == []


def test_update_job_error_refunds(monkeypatch):
    """`/modal-status` and resume-progress declare failures for a job whose own
    process is gone, so update_job_error owns the refund for them."""
    from app.routers import exports
    from app.services import export_helpers
    conn = _jobs_db()

    @contextmanager
    def _fake_conn():
        yield conn

    refunded = []
    monkeypatch.setattr(exports, "get_db_connection", _fake_conn)
    monkeypatch.setattr(export_helpers, "refund_failed_export", lambda jid: refunded.append(jid))

    exports.update_job_error("job-1", "Modal job expired")

    row = conn.execute("SELECT status, error FROM export_jobs WHERE id='job-1'").fetchone()
    assert row["status"] == "error"
    assert row["error"] == "Modal job expired"
    assert refunded == ["job-1"]


def test_refund_failed_export_never_raises_and_needs_no_user_context():
    """The real wrapper (not the stub the other tests use): it must swallow a
    missing user context rather than break job reconciliation."""
    from app.services.export_helpers import refund_failed_export
    from app.user_context import reset_user_id

    reset_user_id()
    assert refund_failed_export("job-does-not-exist") == 0


# =============================================================================
# The liveness check and the reconciler
# =============================================================================

class _Info:
    def __init__(self, status, call_id="fc-abc"):
        self.status = status
        self.function_call_id = call_id
        self.function_name = "process_clips_ai"


@contextmanager
def _modal_graph(monkeypatch, graph):
    """Stub modal.FunctionCall.from_id(...).get_call_graph(). `graph` may be a
    list, or an exception instance to raise."""
    import modal

    class _Call:
        def get_call_graph(self):
            if isinstance(graph, Exception):
                raise graph
            return graph

    monkeypatch.setattr(modal.FunctionCall, "from_id", staticmethod(lambda _id: _Call()))
    yield


def test_liveness_reads_the_input_record_not_the_consumed_output(monkeypatch):
    """T10360 core. `.get()` reads the OUTPUT store, which for a generator call is
    a GeneratorDone marker the in-band consumer expires as it reads it -- so a
    second process got NotFoundError every time and this function was a constant
    None, leaving the whole recovery mechanism inert. `get_call_graph()` reads the
    INPUT record, which survives. Statuses per modal.call_graph.InputStatus:
    PENDING=0, SUCCESS=1, FAILURE=2, INIT_FAILURE=3, TERMINATED=4, TIMEOUT=5."""
    from modal.call_graph import InputStatus

    from app.routers import exports

    with _modal_graph(monkeypatch, [_Info(InputStatus.PENDING)]):
        assert exports.check_modal_job_running("fc-abc") is True

    for terminal in (InputStatus.SUCCESS, InputStatus.FAILURE, InputStatus.TIMEOUT,
                     InputStatus.TERMINATED, InputStatus.INIT_FAILURE):
        with _modal_graph(monkeypatch, [_Info(terminal)]):
            assert exports.check_modal_job_running("fc-abc") is False, terminal


def test_liveness_is_unknown_never_dead_when_modal_cannot_answer(monkeypatch):
    """T4240's rule survives the re-mechanisation: no answer is never "dead".
    An aged-out input record comes back as an empty graph, and a graph for some
    OTHER call must not be mistaken for ours."""
    from modal.call_graph import InputStatus

    from app.routers import exports

    with _modal_graph(monkeypatch, []):
        assert exports.check_modal_job_running("fc-abc") is None
    with _modal_graph(monkeypatch, RuntimeError("modal API unavailable")):
        assert exports.check_modal_job_running("fc-abc") is None
    with _modal_graph(monkeypatch, [_Info(InputStatus.SUCCESS, call_id="fc-someone-else")]):
        assert exports.check_modal_job_running("fc-abc") is None


def test_reconciler_puts_r2_ahead_of_modal(monkeypatch):
    """The ordering is the whole point. A generator call that SUCCEEDED reports the
    same terminal status as one that died -- so asking Modal first, and believing a
    terminal status, refunds users for reels that exist. R2 decides."""
    from app.routers import exports

    monkeypatch.setattr(exports, "get_current_user_id", lambda: USER)
    monkeypatch.setattr(exports, "file_exists_in_r2", lambda _u, key: key == "wv/done.mp4")

    job = {"output_key": "wv/done.mp4", "modal_call_id": "fc-abc"}
    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: False)
    assert exports.reconcile_dispatched_export(job) == "rendered"

    missing = {"output_key": "wv/never-appeared.mp4", "modal_call_id": "fc-abc"}
    assert exports.reconcile_dispatched_export(missing) == "dead"

    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: True)
    assert exports.reconcile_dispatched_export(missing) == "running"

    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: None)
    assert exports.reconcile_dispatched_export(missing) == "unknown"

    # No call id at all is an absence of evidence, not evidence of death.
    assert exports.reconcile_dispatched_export({"output_key": None, "modal_call_id": None}) == "unknown"

    # Nor is a terminal Modal status when there was no output_key to probe with:
    # a pre-v028 job, or rolling-deploy skew hiding the column. "Terminal" alone
    # does not say terminal HOW, since a successful generator reports it too.
    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: False)
    assert exports.reconcile_dispatched_export({"output_key": None, "modal_call_id": "fc-abc"}) == "unknown"


# =============================================================================
# The two rewired endpoints
# =============================================================================

@pytest.mark.asyncio
async def test_modal_status_finalizes_a_render_that_is_in_r2(monkeypatch):
    """The incident's actual delivery path. Before T10360 this endpoint called
    `.get()`, caught NotFoundError, and returned "expired" -- so the finished video
    sat in R2 forever and the user saw a dead export."""
    from app.routers import exports

    finalized = {}

    async def _fake_finalize(job, result, user_id):
        finalized['job'] = job['id']
        return {"finalized": True, "working_video_id": 7, "output_filename": "reel.mp4"}

    monkeypatch.setattr(exports, "get_export_job", lambda _id: {
        "id": "job-1", "status": "processing", "modal_call_id": "fc-abc",
        "output_key": "wv/done.mp4", "project_id": 42,
    })
    monkeypatch.setattr(exports, "reconcile_dispatched_export", lambda _job: "rendered")
    monkeypatch.setattr(exports, "finalize_modal_export", _fake_finalize)
    monkeypatch.setattr(exports, "get_current_user_id", lambda: USER)

    out = await exports.check_modal_status("job-1")

    assert out["status"] == "complete"
    assert out["working_video_id"] == 7
    assert finalized['job'] == "job-1"


@pytest.mark.asyncio
async def test_modal_status_reports_running_for_unknown_and_never_fails_it(monkeypatch):
    """UNKNOWN must not reach the user as a failure: only cleanup_stale_exports'
    age backstop may end an unknowable job, and it refunds when it does."""
    from app.routers import exports

    failed = []
    monkeypatch.setattr(exports, "get_export_job", lambda _id: {
        "id": "job-1", "status": "processing", "modal_call_id": "fc-abc",
        "output_key": None, "project_id": 42,
    })
    monkeypatch.setattr(exports, "reconcile_dispatched_export", lambda _job: "unknown")
    monkeypatch.setattr(exports, "update_job_error", lambda jid, msg: failed.append(jid))

    out = await exports.check_modal_status("job-1")

    assert out["status"] == "running"
    assert failed == [], "an unknowable job must not be failed here"


def test_stale_sweep_survives_a_below_head_db(monkeypatch):
    """`output_key` is v028 and the sweep runs on GET /api/exports/active, a hot
    read. A DB one migration behind (rolling-deploy skew) must not 500 the whole
    endpoint -- caught by Branch CI via
    test_t6030_migration_window_structural_guard::test_exports_lists."""
    from app.routers import exports
    from app.services import export_job_repository

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(_EXPORT_JOBS_DDL.replace(", output_key TEXT", ""))
    conn.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, input_data, modal_call_id, created_at) "
        "VALUES ('job-1', 42, 'framing', 'processing', ?, 'fc-abc', datetime('now', '-120 minutes'))",
        (b"{}",),
    )
    conn.commit()

    cur = conn.cursor()
    rows = export_job_repository.get_stale_candidates(cur, 60)
    assert len(rows) == 1
    assert rows[0]["output_key"] is None, "must read NULL, not raise"

    # And with no key to probe, a terminal Modal status must not read as 'dead'.
    monkeypatch.setattr(exports, "check_modal_job_running", lambda _id: False)
    assert exports.reconcile_dispatched_export(dict(rows[0])) == "unknown"
