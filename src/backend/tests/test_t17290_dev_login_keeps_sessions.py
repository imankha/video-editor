"""T17290: a dev-login must not sign out the account's other sessions.

The staging checks of several merged groups run at once, all as the one seeded
account (e2e-gate@test.local). Every login used to delete all of that user's
sessions, so one check's dev-login signed the others out mid-run: the app saw
401 "Your session ended" on /auth/me and showed the sign-in screen until the
check timed out. A real sign-in (Google, email code) still ends other sessions.

The handler and _issue_session_cookie are called directly; Postgres session
writes are replaced by recorders, so nothing touches a shared database.
"""
import asyncio

import app.routers.auth as auth_mod


class FakeRequest:
    def __init__(self, body, headers):
        self._body = body
        self._headers = {k.lower(): v for k, v in headers.items()}

    @property
    def headers(self):
        return self._headers

    async def json(self):
        return self._body


def _record_session_writes(monkeypatch):
    calls = []
    monkeypatch.setattr(auth_mod, "invalidate_user_sessions", lambda uid: calls.append(("revoke", uid)))
    monkeypatch.setattr(auth_mod, "create_session", lambda uid: calls.append(("create", uid)) or "sid-new")
    return calls


def test_dev_login_keeps_the_accounts_other_sessions(monkeypatch):
    monkeypatch.setattr(auth_mod, "APP_ENV", "staging")
    monkeypatch.setattr(auth_mod, "set_current_user_id", lambda uid: None)
    monkeypatch.setattr(auth_mod, "invalidate_user_cache", lambda uid: None)
    monkeypatch.setattr(auth_mod, "user_session_init",
                        lambda uid, hint_profile_id=None: {"profile_id": "p1", "is_new_user": False})
    monkeypatch.setattr(auth_mod, "get_user_by_email", lambda e: {"user_id": "u_gate", "email": e})
    calls = _record_session_writes(monkeypatch)

    request = FakeRequest({"email": "e2e-gate@test.local"}, {"X-Test-Mode": "true"})
    response = asyncio.run(auth_mod.dev_login(request))

    assert response.status_code == 200
    assert calls == [("create", "u_gate")], "dev-login must add a session, not revoke the others"


def test_a_real_sign_in_still_ends_other_sessions(monkeypatch):
    calls = _record_session_writes(monkeypatch)
    auth_mod._issue_session_cookie("u_real", {"user_id": "u_real"})
    assert calls == [("revoke", "u_real"), ("create", "u_real")]
