"""
T16490: a new sign-in signs the old device out at once.

T16380 remembers a valid session in process memory for up to a minute. A new
sign-in, an account reset and an account delete each end every session the
account had; the old device's cookie must be refused on its very next request,
not up to a minute later from the remembered copy.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.services import auth_db

USER_ID = "t16490-user"
EMAIL = "t16490@example.com"


@pytest.fixture()
def client(pg_conn, tmp_path, monkeypatch):
    from tests.conftest import register_test_user_ids
    register_test_user_ids(USER_ID)
    auth_db.create_user(USER_ID, email=EMAIL)
    base = tmp_path / "user_data"
    base.mkdir()
    for target in ("app.database", "app.services.user_db", "app.routers.auth", "app.routers.privacy"):
        monkeypatch.setattr(f"{target}.USER_DATA_BASE", base)
    for target in ("app.database", "app.storage", "app.routers.auth"):
        monkeypatch.setattr(f"{target}.R2_ENABLED", False)
    from app.main import app
    yield TestClient(app, raise_server_exceptions=True)
    auth_db.clear_session_cache()


def _old_device(client) -> str:
    """The first device: signed in, and its session now remembered in memory."""
    sid = auth_db.create_session(USER_ID)
    assert _me(client, sid) == 200
    assert auth_db.remembered_session(sid) is not None, "precondition: session not remembered"
    return sid


def _me(client, sid) -> int:
    client.cookies.clear()
    client.cookies.set("rb_session", sid)
    return client.get("/api/auth/me").status_code


def _sign_in_with_code(client) -> str:
    """Sign in on a second device the way a user does: email code -> verify-otp."""
    with auth_db.get_auth_db() as conn:
        conn.cursor().execute(
            "INSERT INTO otp_codes (email, code, expires_at) VALUES (%s, %s, %s)",
            (EMAIL, "123456", datetime.now(UTC) + timedelta(minutes=10)),
        )
    client.cookies.clear()
    r = client.post("/api/auth/verify-otp", json={"email": EMAIL, "code": "123456"})
    assert r.status_code == 200, r.text
    return r.cookies["rb_session"]


def test_c1_second_sign_in_refuses_first_device_at_once(client):
    old = _old_device(client)

    new = _sign_in_with_code(client)

    assert new != old
    assert _me(client, old) == 401, "the first device still works after a second sign-in"
    assert _me(client, new) == 200


def test_c2_account_reset_refuses_old_device_at_once(client):
    from app.routers.auth import _reset_test_account
    old = _old_device(client)

    _reset_test_account(USER_ID, EMAIL)

    assert _me(client, old) == 401, "the old device still works after an account reset"


@pytest.mark.parametrize("delete_path", ["/api/auth/user", "/api/privacy/delete-account"])
def test_c2_account_delete_refuses_old_device_at_once(client, delete_path):
    old = _old_device(client)
    other = auth_db.create_session(USER_ID)  # the device that deletes the account
    client.cookies.clear()
    client.cookies.set("rb_session", other)

    with patch.object(auth_db, "update_last_seen"):
        r = client.delete(delete_path)
    assert r.status_code == 200, r.text

    assert _me(client, old) == 401, f"the old device still works after {delete_path}"
