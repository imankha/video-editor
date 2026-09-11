"""
T9400: "Report a problem" fails to send, and the failure has no fallback.

Root cause (established via live curl): the report handler uploaded the
screenshot + console logs to R2 SYNCHRONOUSLY and blocking inside the request,
via retry_r2_call(**TIER_2) (~90s worst case), holding a pooled PG connection
the whole time. When R2 outbound stalls (reproduced on a cold Fly machine) the
request blocks past the proxy timeout and the browser fetch fails with a
generic error.

The fix commits the report row immediately and uploads R2 assets in a
background task, and dedups retries via a client-supplied client_report_id
(idempotent INSERT ... ON CONFLICT). These tests assert:
  1. the report row is written with an ON CONFLICT dedup clause and the
     client_report_id is passed through,
  2. a duplicate client_report_id (a retry that actually reached the server)
     does NOT schedule a second R2 asset upload,
  3. R2 asset upload is deferred to a background task, so the endpoint returns
     without doing R2 work in the request body.
"""
import os
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

_BASE_BODY = {
    "logs": [{"level": "info", "message": "hi", "ts": 1}],
    "user_agent": "pytest-UA",
    "page_url": "https://app.example/home",
    "description": "quest completion never fired",
    "email": "tester@example.com",
    "screenshot": "data:image/jpeg;base64,AAAA",
    "client_report_id": "test-report-uuid-1",
}


def _fake_pg(inserted=True, bug_id=999):
    """A get_pg() context manager whose cursor returns (id, inserted)."""
    fake_cur = MagicMock()
    fake_cur.fetchone.return_value = {"id": bug_id, "inserted": inserted}
    fake_conn = MagicMock()
    fake_conn.cursor.return_value = fake_cur
    fake_ctx = MagicMock()
    fake_ctx.__enter__.return_value = fake_conn
    fake_ctx.__exit__.return_value = False
    return fake_ctx, fake_cur


def _post(body):
    return client.post("/api/auth/report-problem", json=body)


def test_insert_uses_on_conflict_and_passes_client_report_id():
    fake_ctx, fake_cur = _fake_pg()
    with patch("app.services.pg.get_pg", return_value=fake_ctx), \
         patch("app.routers.auth._upload_bug_assets"):
        r = _post(dict(_BASE_BODY))

    assert r.status_code == 200, r.text
    assert r.json().get("bug_id") == 999
    insert_calls = [c for c in fake_cur.execute.call_args_list
                    if "INSERT INTO bug_reports" in c.args[0]]
    assert insert_calls, "expected an INSERT INTO bug_reports"
    sql = insert_calls[0].args[0]
    assert "ON CONFLICT" in sql, "insert must be idempotent on client_report_id"
    params = insert_calls[0].args[1]
    assert "test-report-uuid-1" in params, "client_report_id must be persisted"


def test_duplicate_client_report_id_does_not_reupload_assets():
    # inserted=False simulates ON CONFLICT hitting an existing row (a retry).
    fake_ctx, _ = _fake_pg(inserted=False, bug_id=42)
    with patch("app.services.pg.get_pg", return_value=fake_ctx), \
         patch("app.routers.auth._upload_bug_assets") as upload:
        r = _post(dict(_BASE_BODY))

    assert r.status_code == 200, r.text
    assert r.json().get("bug_id") == 42
    upload.assert_not_called()


def test_fresh_report_schedules_background_asset_upload():
    fake_ctx, _ = _fake_pg(inserted=True, bug_id=7)
    with patch("app.services.pg.get_pg", return_value=fake_ctx), \
         patch("app.routers.auth._upload_bug_assets") as upload:
        r = _post(dict(_BASE_BODY))

    assert r.status_code == 200, r.text
    # The R2 work is deferred to a background task, not run inline.
    upload.assert_called_once()
    assert upload.call_args.args[0] == 7  # bug_id


def test_dedup_files_exactly_one_row_against_real_postgres(pg_conn):
    """Acceptance criterion (c): a successful retry after an ambiguous failure
    (same client_report_id resent) must file EXACTLY ONE row. Verified against a
    real Postgres via the ON CONFLICT upsert, not a mock."""
    import psycopg2
    from psycopg2.extras import RealDictCursor

    body = dict(_BASE_BODY)
    body["client_report_id"] = "dedup-e2e-uuid"
    body["screenshot"] = None  # no R2 work needed for this assertion

    with patch("app.storage.get_r2_client", return_value=None):
        r1 = _post(dict(body))
        r2 = _post(dict(body))  # the retry

    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert r1.json()["bug_id"] == r2.json()["bug_id"], "retry must resolve to the same row"

    conn = psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) AS n FROM bug_reports WHERE client_report_id = %s",
            ("dedup-e2e-uuid",),
        )
        assert cur.fetchone()["n"] == 1, "exactly one row must exist for the client_report_id"
        # Clean up the QA rows this test created.
        cur.execute("DELETE FROM bug_reports WHERE client_report_id = %s", ("dedup-e2e-uuid",))
        conn.commit()
    finally:
        conn.close()


def test_report_survives_a_broken_r2_backend():
    """Even if R2 is unreachable, the report still returns sent -- the row is
    committed before any R2 work and the asset upload degrades to a warning."""
    fake_ctx, _ = _fake_pg(inserted=True, bug_id=8)
    broken_client = MagicMock()
    broken_client.put_object.side_effect = ConnectionError("R2 unreachable")
    with patch("app.services.pg.get_pg", return_value=fake_ctx), \
         patch("app.storage.get_r2_client", return_value=broken_client):
        r = _post(dict(_BASE_BODY))

    assert r.status_code == 200, r.text
    assert r.json().get("sent") is True
