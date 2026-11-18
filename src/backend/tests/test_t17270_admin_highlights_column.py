"""T17270: the admin user table counts finished highlights, not renders.

A spotlight render fires export_completed AND overlay_exported for the same
highlight, so the old Exports total read "4 exports for 3 highlights". The
Highlights column reads highlight_finished (the Finish tap, once per highlight)
and is sortable like every other column.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(pg_conn, tmp_path):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

    create_user("admin-user", email="test-admin@test.local")
    create_user("regular-user", email="other@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )
        cur.execute(
            "INSERT INTO user_segments (user_id) VALUES ('admin-user'), ('regular-user') "
            "ON CONFLICT (user_id) DO NOTHING"
        )
        # 3 highlights finished; one of them also got a spotlight render.
        for user_id, action, count in [
            ("admin-user", "framing_exported", 3),
            ("admin-user", "overlay_exported", 1),
            ("admin-user", "export_completed", 4),
            ("admin-user", "highlight_finished", 3),
        ]:
            cur.execute(
                "INSERT INTO user_actions (user_id, action, count) VALUES (%s, %s, %s)",
                (user_id, action, count),
            )
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def test_highlights_count_is_finished_highlights_not_renders(client):
    resp = client.get("/api/admin/users", headers={"X-User-ID": "admin-user"})
    assert resp.status_code == 200
    users = {u["user_id"]: u for u in resp.json()["users"]}
    assert users["admin-user"]["highlight_finished_count"] == 3
    assert users["regular-user"]["highlight_finished_count"] == 0


def test_highlights_column_is_sortable(client):
    resp = client.get(
        "/api/admin/users?sort=highlight_finished_count&sort_dir=desc",
        headers={"X-User-ID": "admin-user"},
    )
    assert resp.status_code == 200
    assert resp.json()["users"][0]["user_id"] == "admin-user"
