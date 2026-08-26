"""
T7560: the /report-problem endpoint must never persist an empty report.

Prod bug_reports row #46 landed with description=NULL and captured nothing
diagnosable. The server now rejects NULL/blank descriptions with 400
(belt-and-braces with the client gate), while a real description still flows
through to the Postgres insert.
"""
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# /api/auth/* is auth-allowlisted, so these reach the handler without a session.
_BASE_BODY = {
    "logs": [],
    "user_agent": "pytest-UA",
    "page_url": "https://app.example/home",
}


def _post(description_field):
    body = dict(_BASE_BODY)
    if description_field is not _MISSING:
        body["description"] = description_field
    return client.post("/api/auth/report-problem", json=body)


_MISSING = object()


def test_null_description_rejected():
    r = _post(None)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_missing_description_rejected():
    r = _post(_MISSING)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_empty_string_description_rejected():
    r = _post("")
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_whitespace_only_description_rejected():
    r = _post("   \n\t  ")
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_real_description_passes_validation_and_inserts():
    """A non-empty description must clear the gate and reach the Postgres insert.

    We mock get_pg so the test never touches a real database; the point is that
    validation does NOT reject a genuine report and the row is written.
    """
    fake_cur = MagicMock()
    fake_cur.fetchone.return_value = {"id": 12345}
    fake_conn = MagicMock()
    fake_conn.cursor.return_value = fake_cur
    fake_ctx = MagicMock()
    fake_ctx.__enter__.return_value = fake_conn
    fake_ctx.__exit__.return_value = False

    with patch("app.services.pg.get_pg", return_value=fake_ctx), \
         patch("app.storage.get_r2_client", return_value=None):
        r = _post("The upload button did nothing when I tapped it.")

    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
    assert r.json().get("bug_id") == 12345
    # The insert must have been issued with our real description.
    insert_calls = [c for c in fake_cur.execute.call_args_list
                    if "INSERT INTO bug_reports" in c.args[0]]
    assert insert_calls, "expected an INSERT INTO bug_reports"
    params = insert_calls[0].args[1]
    assert "The upload button did nothing" in params[1]
