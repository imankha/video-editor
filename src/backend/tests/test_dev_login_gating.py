"""T3980: dev-login faithful-impersonation gating + init-path tests.

TARGETED unit tests for the /api/auth/dev-login handler. We call the handler
coroutine directly with a fake Request (no ASGI stack, no middleware) and mock the
Postgres user lookups, session-init, and cookie issuance -- so NOTHING touches the
shared dev Postgres or R2 (the full backend suite truncates the Postgres it points
at; this file must never do that).

We assert:
  - prod  -> 404 (never mint a session in production)
  - staging (non-dev) -> 403 without X-Test-Mode, 200 with it
  - local dev -> works WITHOUT X-Test-Mode (back-compat for dev-verify.sh / realAuth)
  - resolves by email OR user_id, and ALWAYS runs user_session_init with the
    profile_id hint (the faithfulness guarantee: real R2 data loads)
  - unknown user -> 404, missing identifier -> 400
"""
import asyncio
import json

import pytest
import app.routers.auth as auth_mod
from fastapi import HTTPException
from fastapi.responses import JSONResponse


class FakeRequest:
    """Minimal stand-in for starlette Request: case-insensitive headers + json()."""

    def __init__(self, body=None, headers=None):
        self._body = body if body is not None else {}
        self._headers = {k.lower(): v for k, v in (headers or {}).items()}

    @property
    def headers(self):
        return self._headers

    async def json(self):
        return self._body


def _patch_common(monkeypatch, calls):
    """Patch cookie issuance + session-init; record init calls into `calls`."""
    monkeypatch.setattr(auth_mod, "_issue_session_cookie",
                        lambda user_id, payload: JSONResponse(content=payload))
    monkeypatch.setattr(auth_mod, "set_current_user_id", lambda uid: None)

    def fake_init(user_id, hint_profile_id=None):
        calls.append({"user_id": user_id, "hint_profile_id": hint_profile_id})
        return {"profile_id": hint_profile_id or "def01234", "is_new_user": False}

    monkeypatch.setattr(auth_mod, "user_session_init", fake_init)


def _run(body=None, headers=None):
    return asyncio.run(auth_mod.dev_login(FakeRequest(body=body, headers=headers)))


def _payload(response):
    return json.loads(bytes(response.body))


def test_dev_login_404_in_production(monkeypatch):
    monkeypatch.setattr(auth_mod, "APP_ENV", "production")
    with pytest.raises(HTTPException) as exc:
        _run(body={"email": "imankh@gmail.com"})
    assert exc.value.status_code == 404


def test_dev_login_staging_requires_test_mode(monkeypatch):
    monkeypatch.setattr(auth_mod, "APP_ENV", "staging")
    calls = []
    _patch_common(monkeypatch, calls)
    monkeypatch.setattr(auth_mod, "get_user_by_email",
                        lambda e: {"user_id": "u_real", "email": e})
    with pytest.raises(HTTPException) as exc:  # no X-Test-Mode on staging
        _run(body={"email": "imankh@gmail.com"})
    assert exc.value.status_code == 403
    assert calls == []  # never reached init


def test_dev_login_staging_with_test_mode_runs_init(monkeypatch):
    monkeypatch.setattr(auth_mod, "APP_ENV", "staging")
    calls = []
    _patch_common(monkeypatch, calls)
    monkeypatch.setattr(auth_mod, "get_user_by_email",
                        lambda e: {"user_id": "u_real", "email": e})
    resp = _run(
        body={"email": "imankh@gmail.com", "profile_id": "9fa7378c"},
        headers={"X-Test-Mode": "true"},
    )
    # Faithfulness: init ran with the profile hint.
    assert calls == [{"user_id": "u_real", "hint_profile_id": "9fa7378c"}]
    body = _payload(resp)
    assert body["user_id"] == "u_real"
    assert body["profile_id"] == "9fa7378c"
    assert body["dev_login"] is True


def test_dev_login_dev_no_test_mode_ok(monkeypatch):
    # Back-compat: local dev must work WITHOUT X-Test-Mode (dev-verify.sh / realAuth).
    monkeypatch.setattr(auth_mod, "APP_ENV", "dev")
    calls = []
    _patch_common(monkeypatch, calls)
    monkeypatch.setattr(auth_mod, "get_user_by_email",
                        lambda e: {"user_id": "u_real", "email": e})
    resp = _run(body={"email": "imankh@gmail.com"})
    assert calls == [{"user_id": "u_real", "hint_profile_id": None}]
    assert _payload(resp)["user_id"] == "u_real"


def test_dev_login_by_user_id_runs_init(monkeypatch):
    monkeypatch.setattr(auth_mod, "APP_ENV", "dev")
    calls = []
    _patch_common(monkeypatch, calls)
    monkeypatch.setattr(auth_mod, "get_user_by_id",
                        lambda uid: {"user_id": uid, "email": "found@x.com"})
    resp = _run(body={"user_id": "u_by_id", "profile_id": "abcd1234"})
    assert calls == [{"user_id": "u_by_id", "hint_profile_id": "abcd1234"}]
    assert _payload(resp)["email"] == "found@x.com"


def test_dev_login_unknown_user_404(monkeypatch):
    monkeypatch.setattr(auth_mod, "APP_ENV", "dev")
    calls = []
    _patch_common(monkeypatch, calls)
    monkeypatch.setattr(auth_mod, "get_user_by_email", lambda e: None)
    with pytest.raises(HTTPException) as exc:
        _run(body={"email": "nobody@x.com"})
    assert exc.value.status_code == 404
    assert calls == []


def test_dev_login_missing_identifier_400(monkeypatch):
    monkeypatch.setattr(auth_mod, "APP_ENV", "dev")
    calls = []
    _patch_common(monkeypatch, calls)
    with pytest.raises(HTTPException) as exc:
        _run(body={})
    assert exc.value.status_code == 400
    assert calls == []
