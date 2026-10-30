"""T12610: every brand-new signup gets one welcome email (tutorial + socials + Discord).

Driven through the real login handlers (Google and email-code) down to the Resend HTTP
call; only the network transport, Postgres, and the identity lookups are faked.
"""
import asyncio
import re
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.routers import auth
from app.services import email as email_service


class _FakeResp:
    status_code = 200
    text = "ok"


class _FakeResend:
    """Stands in for httpx.AsyncClient inside app.services.email; records every POST."""

    def __init__(self, behaviour="ok"):
        self.posts = []
        self.behaviour = behaviour

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        self.posts.append({"url": url, "headers": headers, "json": json})
        if self.behaviour == "raise":
            raise RuntimeError("resend down")
        if self.behaviour == "hang":
            await asyncio.sleep(30)
        return _FakeResp()


@pytest.fixture
def resend(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    fake = _FakeResend()
    monkeypatch.setattr(email_service.httpx, "AsyncClient", fake)
    return fake


def _request():
    return type("R", (), {"headers": {}})()


def _google_login(is_new, user_id="u1", address="new@parent.com"):
    body = auth.GoogleAuthRequest(token="t")
    with patch.object(auth, "_verify_google_token", return_value={"email": address, "sub": "g1"}), \
         patch.object(auth, "_find_or_create_user", return_value=(user_id, is_new)), \
         patch.object(auth, "_determine_origin", return_value=("organic", None)), \
         patch.object(auth, "create_user_segment"), \
         patch.object(auth, "get_user_by_id", return_value={"google_id": "g1"}), \
         patch.object(auth, "update_picture_url"), \
         patch.object(auth, "_issue_session_cookie", side_effect=lambda uid, payload: payload):
        return asyncio.run(auth.google_auth(body, _request()))


class _FakeCursor:
    def execute(self, *a, **k):
        pass

    def fetchone(self):
        return {"id": 1, "code": "123456", "expires_at": datetime.now(UTC) + timedelta(minutes=5), "attempts": 0}


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return _FakeCursor()


def _otp_login(is_new, user_id="u2", address="code@parent.com"):
    body = auth.VerifyOtpRequest(email=address, code="123456")
    with patch.object(auth, "get_auth_db", return_value=_FakeConn()), \
         patch.object(auth, "_find_or_create_user", return_value=(user_id, is_new)), \
         patch.object(auth, "_determine_origin", return_value=("organic", None)), \
         patch.object(auth, "create_user_segment"), \
         patch.object(auth, "get_user_by_id", return_value={"google_id": None}), \
         patch.object(auth, "_issue_session_cookie", side_effect=lambda uid, payload: payload):
        return asyncio.run(auth.verify_otp(body, _request()))


def _assert_is_welcome(post, to, user_id):
    payload = post["json"]
    assert payload["to"] == [to]
    assert "hello@reelballers.com" in payload["from"]
    html = payload["html"]
    assert email_service.TUTORIAL_URL in html
    for _label, url in email_service.SOCIAL_LINKS:
        assert url in html
    assert "thank you for signing up" in html.lower()
    # Exactly-once identity: the same signup:{user_id} key the signup bonus uses.
    assert post["headers"]["Idempotency-Key"] == f"welcome-email:signup:{user_id}"


def test_new_google_signup_sends_one_welcome_email(resend):
    _google_login(is_new=True)
    assert len(resend.posts) == 1
    _assert_is_welcome(resend.posts[0], "new@parent.com", "u1")


def test_new_email_code_signup_sends_one_welcome_email(resend):
    _otp_login(is_new=True)
    assert len(resend.posts) == 1
    _assert_is_welcome(resend.posts[0], "code@parent.com", "u2")


def test_returning_login_sends_no_welcome_email(resend):
    _google_login(is_new=False)
    _otp_login(is_new=False)
    assert resend.posts == []


def test_send_failure_does_not_fail_sign_in(resend):
    resend.behaviour = "raise"
    result = _google_login(is_new=True)
    assert result["user_id"] == "u1"


def test_hung_send_does_not_hold_sign_in(resend, monkeypatch):
    resend.behaviour = "hang"
    monkeypatch.setattr(auth, "WELCOME_EMAIL_TIMEOUT_SECONDS", 0.05, raising=False)
    started = time.monotonic()
    result = _otp_login(is_new=True)
    assert result["user_id"] == "u2"
    assert time.monotonic() - started < 5


def test_welcome_copy_follows_outreach_rules(resend):
    _google_login(is_new=True)
    payload = resend.posts[0]["json"]
    assert payload["html"].isascii()  # no em dashes or smart quotes anywhere
    # Copy rules apply to the email's own words; the shared shell's "Reel / Ballers"
    # logo wordmark is branding, so drop it before checking.
    html = payload["html"].replace(email_service._BRAND_LOGO_HTML, "")
    text = re.sub(r"<[^>]+>", " ", payload["subject"] + " " + html)
    assert "Iman" in text
    assert not re.search(r"\breels?\b", text, re.IGNORECASE)  # "highlight", never "reel"
    assert not re.search(r"automatic", text, re.IGNORECASE)
    assert not re.search(r"\d+\s*credits", text, re.IGNORECASE)  # credits stay generic
