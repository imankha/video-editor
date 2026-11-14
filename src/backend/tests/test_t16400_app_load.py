"""T16400:C6: each app load records how long it took to become usable.

The app posts its own load timings once it is usable (POST /api/telemetry/app-load).
The row lands in the user's own ``user_action_log`` (user.sqlite, synced to R2), so
the next slow load can be explained a day later; Fly's log buffer held under four
minutes when the owner hit the slow load on 2026-11-13.
"""

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

USER_ID = "t16400-load-user"


@pytest.fixture
def client(tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _app_load_rows():
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(USER_ID) as conn:
        rows = conn.execute(
            "SELECT context, created_at FROM user_action_log WHERE action = 'app_load'"
        ).fetchall()
    return [(json.loads(r[0]), r[1]) for r in rows]


def test_c6_app_load_timing_is_recorded_in_user_action_log(client):
    resp = client.post(
        "/api/telemetry/app-load",
        headers={"X-User-ID": USER_ID},
        json={"ready_ms": 12345, "first_answer_ms": 9100, "me_attempts": 2, "retries": 1},
    )
    assert resp.status_code == 204
    rows = _app_load_rows()
    assert len(rows) == 1, f"expected one app_load row, got {rows}"
    ctx, created_at = rows[0]
    assert ctx == {"ready_ms": 12345, "first_answer_ms": 9100, "me_attempts": 2, "retries": 1}
    assert created_at


def test_c6_impossible_timings_are_not_recorded(client):
    resp = client.post(
        "/api/telemetry/app-load",
        headers={"X-User-ID": USER_ID},
        json={"ready_ms": -5, "first_answer_ms": 10**9, "me_attempts": 1, "retries": 0},
    )
    assert resp.status_code == 204
    assert _app_load_rows() == []
