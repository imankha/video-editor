"""T9690 — Failure-path regression coverage for problem-report submission.

Durable net for the B3 class of bug fixed by T9400: *a report send failed
ambiguously (row committed, response lost) and a retry filed a DUPLICATE.* The
happy path (send once, succeed) never exercises the dedup, so only an explicit
retry-after-ambiguous-failure test keeps the exactly-once guarantee from
regressing.

INJECTED FAILURE: the first response is "lost" — the client cannot tell whether
the row committed, so it retries with the SAME client_report_id. The backend must
file exactly one row (INSERT ... ON CONFLICT), preserving the original content,
and never a second copy.

Real Postgres via the `pg_conn` fixture (the bug_reports unique index lives in the
schema); the endpoint is driven directly, not through a stubbed DB, so the dedup
is exercised for real.

Reverting the ON CONFLICT dedup in auth.report_problem (a plain INSERT ...
RETURNING) turns these red: the retry files a second bug_reports row.
"""

import asyncio
import types
import uuid

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.routers import auth as auth_mod
from app.routers.auth import ProblemReportRequest, report_problem


def _fake_request():
    """report_problem only reads request.headers.get('x-request-id', ...)."""
    return types.SimpleNamespace(headers={})


def _submit(body: ProblemReportRequest):
    """Drive the endpoint directly. BackgroundTasks is collected but never run
    (the R2 asset upload it schedules is irrelevant to the dedup under test)."""
    return asyncio.run(report_problem(body, _fake_request(), BackgroundTasks()))


def _row_count(dsn, client_report_id):
    import psycopg2
    from psycopg2.extras import RealDictCursor
    conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, description FROM bug_reports WHERE client_report_id = %s ORDER BY id",
            (client_report_id,),
        )
        return cur.fetchall()
    finally:
        conn.close()


def _cleanup(dsn, client_report_id):
    import psycopg2
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        conn.cursor().execute(
            "DELETE FROM bug_reports WHERE client_report_id = %s", (client_report_id,)
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Scope 3 + Scope 4 (report path): a retry after a lost response files exactly
# one row; content is preserved.
# ---------------------------------------------------------------------------

def test_retry_after_lost_response_files_exactly_one_report(pg_conn):
    """INJECTED FAILURE: the first submit's response is lost, so the client resends
    the SAME client_report_id. Exactly one bug_reports row must exist, carrying the
    original description.

    Reverting the ON CONFLICT dedup turns this red (two rows).
    """
    crid = f"t9690-{uuid.uuid4()}"
    body = ProblemReportRequest(
        logs=[{"level": "error", "message": "quest completion never fired", "ts": 1}],
        user_agent="pytest-agent",
        page_url="https://app.example/annotate",
        email="t9690@test.local",
        description="5/5 shown but claim rejected",
        client_report_id=crid,
    )
    try:
        first = _submit(body)
        # The response was "lost" in transit -> the client cannot know it committed
        # and retries with the identical composed report (same client_report_id).
        second = _submit(body)

        assert first["sent"] is True and second["sent"] is True
        assert first["bug_id"] == second["bug_id"], "retry must resolve to the same row"

        rows = _row_count(pg_conn, crid)
        assert len(rows) == 1, "exactly one report may be filed across the retry"
        assert rows[0]["description"] == "5/5 shown but claim rejected", "content preserved"
    finally:
        _cleanup(pg_conn, crid)


def test_distinct_reports_are_not_collapsed(pg_conn):
    """Guard against the dedup over-collapsing: two genuinely different reports
    (distinct client_report_ids) file two rows. Proves the exactly-once test above
    is asserting real dedup, not a table that simply never inserts twice."""
    crid_a = f"t9690a-{uuid.uuid4()}"
    crid_b = f"t9690b-{uuid.uuid4()}"
    base = dict(
        logs=[{"level": "info", "message": "x", "ts": 1}],
        user_agent="pytest-agent",
        page_url="https://app.example/annotate",
        email="t9690@test.local",
    )
    try:
        _submit(ProblemReportRequest(description="first distinct report", client_report_id=crid_a, **base))
        _submit(ProblemReportRequest(description="second distinct report", client_report_id=crid_b, **base))

        assert len(_row_count(pg_conn, crid_a)) == 1
        assert len(_row_count(pg_conn, crid_b)) == 1
    finally:
        _cleanup(pg_conn, crid_a)
        _cleanup(pg_conn, crid_b)


def test_blank_report_is_rejected_and_files_nothing(pg_conn):
    """A blank description is rejected server-side (never trust the client-only
    gate) and no row is filed — the failure path files nothing rather than a NULL
    report (prod row #46)."""
    crid = f"t9690blank-{uuid.uuid4()}"
    body = ProblemReportRequest(
        logs=[],
        user_agent="pytest-agent",
        page_url="https://app.example/annotate",
        description="   ",
        client_report_id=crid,
    )
    try:
        with pytest.raises(HTTPException) as ei:
            _submit(body)
        assert ei.value.status_code == 400
        assert _row_count(pg_conn, crid) == []
    finally:
        _cleanup(pg_conn, crid)
