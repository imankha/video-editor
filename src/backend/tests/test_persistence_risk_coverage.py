"""Coverage for the middleware foreign-DB sync path the 2026-07-24 durability
fixes ADDED but only tested at the edges:

The middleware actually SYNCS the foreign databases that TrackedConnection
recorded (test_cross_user_write_tracking.py proved the recording; this proves
the upload). This is the mechanism that makes a cross-user user.sqlite write to
another user durable.

Pure unit tests: no R2, no network, all boundaries monkeypatched.

T5840: the `_refresh_target_user_db` real-behavior section was removed. Credits
moved to Postgres, so admin credit grants no longer pull the grantee's
user.sqlite from R2, mutate it, and push it back (the read-modify-write across a
network round trip those tests protected). A grant is now a single atomic
`UPDATE credits SET balance = balance + amount` inside Postgres under a UNIQUE
idempotency key -- a stale overwrite is structurally impossible, so there is
nothing left to refresh. The admin grant landing correctly against real Postgres
is covered by test_admin_credit_idempotency.py.
"""


import pytest

SESSION_USER = "session-admin"
GRANTEE = "grantee-user"
OTHER_PROFILE_OWNER = "other-owner"


# ---------------------------------------------------------------------------
# 1. Middleware uploads foreign DBs (the b9302790 loop)
# ---------------------------------------------------------------------------

@pytest.fixture
def mw(monkeypatch):
    """A middleware instance with every R2/marker boundary recorded."""
    from app.middleware import db_sync as m

    calls = {"user_sync": [], "profile_sync": [], "pending": [], "cleared": []}

    def _user_sync(uid, lock_timeout=None):
        calls["user_sync"].append(uid)
        return uid not in calls.get("user_fail", ())

    def _profile_sync(uid, pid=None, lock_timeout=None):
        calls["profile_sync"].append((uid, pid))
        return (uid, pid) not in calls.get("profile_fail", ())

    monkeypatch.setattr(m, "sync_user_db_to_r2_explicit", _user_sync)
    monkeypatch.setattr(m, "sync_db_to_r2_explicit", _profile_sync)
    monkeypatch.setattr(m, "mark_sync_pending", lambda uid: calls["pending"].append(uid))
    monkeypatch.setattr(m, "clear_sync_pending", lambda uid: calls["cleared"].append(uid))
    # neutralise the in-flight-attempt bookkeeping (finally calls _end_sync_attempt)
    monkeypatch.setattr(m, "_end_sync_attempt", lambda uid: None)

    async def _dummy_app(scope, receive, send):  # never invoked
        pass

    instance = m.RequestContextMiddleware(_dummy_app)
    return instance, calls


class TestMiddlewareForeignDbSync:

    @pytest.mark.asyncio
    async def test_foreign_user_db_is_uploaded(self, mw):
        """A user.sqlite write for someone other than the session user must be
        pushed to R2 — this is what makes an admin grant durable."""
        instance, calls = mw
        status = await instance._background_sync(
            user_id=SESSION_USER, profile_id=None, req_id="", method="POST",
            path="/api/admin/x", had_writes=False, had_user_db_writes=True,
            do_profile=False, force_profile=False, foreign_user_dbs={GRANTEE},
        )
        assert status == "ok"
        assert GRANTEE in calls["user_sync"], "grantee's user.sqlite was never uploaded"
        # the session user is synced too (the had_user_db_writes else-branch)
        assert SESSION_USER in calls["user_sync"]

    @pytest.mark.asyncio
    async def test_foreign_profile_db_is_uploaded(self, mw):
        instance, calls = mw
        status = await instance._background_sync(
            user_id=SESSION_USER, profile_id=None, req_id="", method="POST",
            path="/api/downloads/move", had_writes=False, had_user_db_writes=True,
            do_profile=False, force_profile=False,
            foreign_profile_dbs={(OTHER_PROFILE_OWNER, "abcd1234")},
        )
        assert status == "ok"
        assert (OTHER_PROFILE_OWNER, "abcd1234") in calls["profile_sync"]

    @pytest.mark.asyncio
    async def test_foreign_sync_failure_marks_that_owner_pending(self, mw):
        """A failed foreign upload must be attributed to the foreign owner
        (its own sync-pending marker) and turn the overall status failed —
        never silently reported ok."""
        instance, calls = mw
        calls["user_fail"] = {GRANTEE}
        status = await instance._background_sync(
            user_id=SESSION_USER, profile_id=None, req_id="", method="POST",
            path="/api/admin/x", had_writes=False, had_user_db_writes=True,
            do_profile=False, force_profile=False, foreign_user_dbs={GRANTEE},
        )
        assert status == "failed"
        assert calls["pending"] == [GRANTEE], "the GRANTEE (not the admin) must be marked pending"
        assert SESSION_USER not in calls["pending"]

    @pytest.mark.asyncio
    async def test_no_foreign_dbs_is_a_plain_session_sync(self, mw):
        """The common case (session user only) must not touch the foreign path."""
        instance, calls = mw
        status = await instance._background_sync(
            user_id=SESSION_USER, profile_id=None, req_id="", method="POST",
            path="/api/x", had_writes=False, had_user_db_writes=True,
            do_profile=False, force_profile=False,
        )
        assert status == "ok"
        assert calls["user_sync"] == [SESSION_USER]
        assert calls["pending"] == []
