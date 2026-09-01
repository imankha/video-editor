"""
T8170 — GET /api/admin/users/{user_id}/stuck-uploads 500s on every call.

Reproduced live 2026-08-31 against bknoto@gmail.com's real prod account (the
bug 47p reporter): `sqlite3.ProgrammingError: SQLite objects created in a
thread can only be used in that same thread`. Root cause: the handler opened
the profile.sqlite connection inside one `asyncio.to_thread(open_profile_db_
readonly, ...)` call, then read (`cur.execute`/`fetchall`) and closed it back
on the EVENT LOOP thread — sqlite3.Connection defaults to
`check_same_thread=True`, tied to whichever worker thread actually ran
`sqlite3.connect()`.

Fix: open, read, AND close the connection inside ONE function, itself run via
a single `to_thread` call, so every operation touching the connection stays
on the same thread. This test builds a REAL local profile.sqlite (no R2) with
a genuine `pending_uploads` row and drives the actual endpoint through
TestClient + the real asyncio.to_thread machinery (not a mocked thread), so
a regression to the pre-fix shape would reproduce the exact 500.
"""

import sys
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.auth_db import create_user

USER_ID = f"u_t8170_{uuid.uuid4().hex[:8]}"
ADMIN_ID = f"admin_t8170_{uuid.uuid4().hex[:8]}"
PROFILE_ID = "8170prof"


@pytest.fixture()
def stuck_uploads_setup(pg_conn, tmp_path):
    # Dynamic per-run ids (never a fixed name): the pg_conn fixture only cleans
    # up a fixed _TEST_USER_IDS allowlist, so a hardcoded id would collide with
    # a leftover row from a prior interrupted run.
    create_user(ADMIN_ID, email=f"{ADMIN_ID}@test.local")
    create_user(USER_ID, email=f"{USER_ID}@test.local")

    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING",
            (f"{ADMIN_ID}@test.local",),
        )

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.database import ensure_database
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        ensure_database()  # real head-schema profile.sqlite, local only (no R2)

        from app.database import get_db_connection
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO pending_uploads
                   (id, blake3_hash, file_size, original_filename, r2_upload_id, label)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    "sess-" + uuid.uuid4().hex[:8],
                    "b" * 64,
                    12 * 1024 * 1024,
                    "clip.mp4",
                    "fake-upload-id",
                    None,
                ),
            )
            conn.commit()

        # Register the profile so get_profiles(USER_ID) (a real Postgres-backed
        # lookup the endpoint calls) finds it — mirrors real account registration.
        from app.services.user_db import create_profile
        create_profile(USER_ID, PROFILE_ID, "Test Profile", "#000000", is_default=True)

    yield


def _client():
    from fastapi.testclient import TestClient

    from app.main import app
    return TestClient(app, raise_server_exceptions=True)


def test_stuck_uploads_returns_200_not_500_cross_thread(stuck_uploads_setup, tmp_path):
    """RED on pre-T8170 code with this exact reproduction shape (real
    to_thread, real sqlite3.Connection, real pending_uploads row): 500
    ProgrammingError. Must return 200 with the row surfaced."""
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.storage.r2_is_multipart_upload_valid", return_value=False), \
         _client() as client:
        resp = client.get(
            f"/api/admin/users/{USER_ID}/stuck-uploads",
            headers={"X-User-ID": ADMIN_ID},
        )

    assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data["user_id"] == USER_ID
    assert len(data["stuck_uploads"]) == 1
    row = data["stuck_uploads"][0]
    assert row["profile_id"] == PROFILE_ID
    assert row["blake3_hash"] == "b" * 64
    assert row["r2_multipart_valid"] is False


def test_stuck_uploads_no_pending_rows_returns_200_empty(pg_conn, tmp_path):
    """A profile with zero pending_uploads rows must also return 200 (the
    cross-thread bug fired unconditionally, even with nothing to report)."""
    admin_id = f"admin_t8170b_{uuid.uuid4().hex[:8]}"
    create_user(admin_id, email=f"{admin_id}@test.local")
    empty_user_id = f"u_t8170empty_{uuid.uuid4().hex[:8]}"
    create_user(empty_user_id, email=f"{empty_user_id}@test.local")

    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING",
            (f"{admin_id}@test.local",),
        )

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.database import ensure_database
        from app.profile_context import set_current_profile_id
        from app.services.user_db import create_profile
        from app.user_context import set_current_user_id

        set_current_user_id(empty_user_id)
        set_current_profile_id(PROFILE_ID)
        ensure_database()
        create_profile(empty_user_id, PROFILE_ID, "Empty Profile", "#000000", is_default=True)

        with _client() as client:
            resp = client.get(
                f"/api/admin/users/{empty_user_id}/stuck-uploads",
                headers={"X-User-ID": admin_id},
            )

    assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
    assert resp.json()["stuck_uploads"] == []
