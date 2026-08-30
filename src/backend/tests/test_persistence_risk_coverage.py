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
    # T5081: mark_sync_pending requires an explicit scope now (no more
    # scope=None default) — the real foreign-db loops always pass one
    # (USER_DB_SCOPE or the foreign profile_id).
    monkeypatch.setattr(m, "mark_sync_pending", lambda uid, scope: calls["pending"].append((uid, scope)))
    # T5081: clear_sync_pending is no longer imported into db_sync.py at all —
    # the sync_*_explicit primitives (mocked above) own that clear internally.
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
        from app.database import USER_DB_SCOPE
        assert calls["pending"] == [(GRANTEE, USER_DB_SCOPE)], \
            "the GRANTEE (not the admin) must be marked pending, scoped to their user.sqlite"
        assert not any(uid == SESSION_USER for uid, _ in calls["pending"])

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


# ---------------------------------------------------------------------------
# 2. Foreign scopes are marked pending BEFORE the response returns (T5081
#    review round 3, MAJOR): before this fix, a foreign DB's marker was
#    written only in _background_sync's FAILURE branch, so for the whole
#    upload window (and permanently if the machine died mid-upload) it held a
#    committed write with no durability record at all.
# ---------------------------------------------------------------------------

class TestForeignDbCrashSafetyMarking:

    @pytest.mark.asyncio
    async def test_foreign_profile_write_is_marked_pending_before_background_task(self, tmp_path, monkeypatch):
        """A request that writes to a DIFFERENT user's profile.sqlite (e.g. a
        teammate-share materialization) must have that scope's .sync_pending
        marker on disk the instant _sync_aware_flow returns — BEFORE the
        fire-and-forget background upload even starts — so a machine death in
        that window still leaves a durability record."""
        from unittest.mock import MagicMock

        import app.database as db_module
        from app.database import has_sync_pending_scope
        from app.middleware import db_sync as m

        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        monkeypatch.setattr(m, "sync_user_db_to_r2_explicit", lambda uid, lock_timeout=None: True)
        monkeypatch.setattr(m, "sync_db_to_r2_explicit", lambda uid, pid=None, lock_timeout=None: True)
        # Never let the real background upload run in this test — only the
        # synchronous pre-marking (before asyncio.create_task) is under test.
        monkeypatch.setattr(m.asyncio, "create_task", lambda coro: coro.close())

        foreign_uid, foreign_pid = "grantee-2", "abcd9999"
        monkeypatch.setattr(m, "get_request_has_writes", lambda: False)
        monkeypatch.setattr(m, "get_request_has_user_db_writes", lambda: False)
        monkeypatch.setattr(m, "get_request_written_profile_dbs", lambda: {(foreign_uid, foreign_pid)})
        monkeypatch.setattr(m, "get_request_written_user_dbs", lambda: set())

        mock_request = MagicMock()
        mock_request.method = "POST"
        mock_request.url.path = "/api/test"
        mock_request.headers = {"X-Request-ID": "test-fg", "X-Profile-Request": ""}

        async def fake_call_next(req):
            return MagicMock(headers={})

        inst = m.RequestContextMiddleware.__new__(m.RequestContextMiddleware)
        meta = {"sync_duration": 0.0, "handler_duration": 0.0,
                "user_id": "session-user", "inflight_entry": 0, "inflight_exit": 0}
        await inst._sync_aware_flow(mock_request, fake_call_next, meta, "session-user", "test-fg")

        assert has_sync_pending_scope(foreign_uid, foreign_pid), \
            "a foreign profile write must be marked pending before the background task fires"

    @pytest.mark.asyncio
    async def test_foreign_mark_precedes_create_task_call(self, tmp_path, monkeypatch):
        """T5081 review round 4 (MINOR): the previous test's `create_task`
        stub was never reached (own_profile_written/own_user_written were both
        False, so `_sync_aware_flow`'s `if had_writes or had_user_db_writes:`
        gate never ran) — it proved the marker exists on disk AFTER the whole
        call, not that it precedes create_task specifically. This variant
        forces the session's OWN write too, so the gate (and its
        `asyncio.create_task` call) genuinely fires, and the stub asserts the
        foreign marker's presence AT THE MOMENT create_task is invoked — the
        actual "before the background task starts" claim."""
        from unittest.mock import MagicMock

        import app.database as db_module
        from app.database import has_sync_pending_scope
        from app.middleware import db_sync as m

        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        monkeypatch.setattr(m, "sync_user_db_to_r2_explicit", lambda uid, lock_timeout=None: True)
        monkeypatch.setattr(m, "sync_db_to_r2_explicit", lambda uid, pid=None, lock_timeout=None: True)

        foreign_uid, foreign_pid = "grantee-3", "abcd8888"
        own_profile_id = "abcd7777"
        marked_at_task_time = {}

        def _create_task_stub(coro):
            marked_at_task_time["foreign"] = has_sync_pending_scope(foreign_uid, foreign_pid)
            coro.close()
            return MagicMock()

        monkeypatch.setattr(m.asyncio, "create_task", _create_task_stub)
        monkeypatch.setattr(m, "get_request_has_writes", lambda: True)
        monkeypatch.setattr(m, "get_request_has_user_db_writes", lambda: False)
        monkeypatch.setattr(
            m, "get_request_written_profile_dbs",
            lambda: {("session-user", own_profile_id), (foreign_uid, foreign_pid)},
        )
        monkeypatch.setattr(m, "get_request_written_user_dbs", lambda: set())

        mock_request = MagicMock()
        mock_request.method = "POST"
        mock_request.url.path = "/api/test"
        mock_request.headers = {"X-Request-ID": "test-fg2", "X-Profile-Request": ""}
        # A bare MagicMock auto-creates request.state.durable_sync as a truthy
        # Mock, which would route this into the AWAITED durable branch instead
        # of the fire-and-forget asyncio.create_task branch under test.
        mock_request.state.durable_sync = False

        async def fake_call_next(req):
            return MagicMock(headers={})

        inst = m.RequestContextMiddleware.__new__(m.RequestContextMiddleware)
        meta = {"sync_duration": 0.0, "handler_duration": 0.0,
                "user_id": "session-user", "inflight_entry": 0, "inflight_exit": 0}
        await inst._sync_aware_flow(mock_request, fake_call_next, meta, "session-user", "test-fg2",
                                     profile_id=own_profile_id)

        assert marked_at_task_time.get("foreign") is True, \
            "the foreign scope must already be marked pending WHEN create_task fires, not merely by the time the whole flow returns"
