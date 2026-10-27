"""T13410: the Google login response reports google_linked from the account's stored google_id,
the same source as /api/auth/me, so the label does not flip after a reload."""
import asyncio
from unittest.mock import patch

from app.routers import auth


def _login(user_row):
    body = auth.GoogleAuthRequest(token="t")
    with patch.object(auth, "_verify_google_token", return_value={"email": "a@b.com", "sub": "g1"}), \
         patch.object(auth, "_find_or_create_user", return_value=("u1", False)), \
         patch.object(auth, "get_user_by_id", return_value=user_row), \
         patch.object(auth, "update_picture_url"), \
         patch.object(auth, "_issue_session_cookie", side_effect=lambda uid, payload: payload):
        req = type("R", (), {"headers": {}})()
        return asyncio.run(auth.google_auth(body, req))


def test_existing_email_code_account_signing_in_with_google_is_not_reported_linked():
    # google_id stays NULL for an account created by email code (/me reports false too).
    assert _login({"google_id": None})["google_linked"] is False


def test_account_with_a_google_id_is_reported_linked():
    assert _login({"google_id": "g1"})["google_linked"] is True
