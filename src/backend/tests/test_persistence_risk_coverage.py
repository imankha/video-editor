"""Coverage for the two integration points the 2026-07-24 durability fixes ADDED
but only tested at the edges:

1. The middleware actually SYNCS the foreign databases that TrackedConnection
   recorded (test_cross_user_write_tracking.py proved the recording; this proves
   the upload). This is the mechanism that makes an admin credit grant to another
   user durable — the exact hole that lost 400 credits.

2. `_refresh_target_user_db` reads the authoritative copy before a grant mutates
   it (the admin tests stub it inert; this exercises its real behavior). Without
   the refresh, a grant force-pushes a stale snapshot over the grantee's newer
   state.

Both are pure unit tests: no R2, no network, all boundaries monkeypatched.
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


# ---------------------------------------------------------------------------
# 2. _refresh_target_user_db real behavior
# ---------------------------------------------------------------------------

@pytest.fixture
def refresh_env(monkeypatch, tmp_path):
    """Patch the boundaries _refresh_target_user_db imports locally."""
    from app import database as db
    from app import storage
    from app.services import user_db

    calls = {"ensured": [], "set_version": []}
    monkeypatch.setattr(db, "USER_DATA_BASE", tmp_path)
    # T4315 round 2 (test gap e): user_db.py has its OWN USER_DATA_BASE
    # constant, separate from database.py's -- ensure_user_database_fresh's
    # _get_user_db_path (and clear_stale_wal_sidecars) resolve through THIS
    # one. Without patching it too, a "downloaded" scenario would reach the
    # real repo user_data/ directory instead of tmp_path.
    monkeypatch.setattr(user_db, "USER_DATA_BASE", tmp_path)
    monkeypatch.setattr(user_db, "ensure_user_database", lambda uid: calls["ensured"].append(uid))
    monkeypatch.setattr(db, "get_local_user_db_version", lambda uid: 3)
    monkeypatch.setattr(db, "set_local_user_db_version",
                        lambda uid, v: calls["set_version"].append((uid, v)))
    monkeypatch.setattr(storage, "R2_ENABLED", True)
    return monkeypatch, storage, calls


class TestRefreshTargetUserDb:

    def test_pulls_newer_copy_and_records_version(self, refresh_env):
        """R2 has a newer copy -> download it and update the local version, so the
        grant that follows is a real read-modify-write, not a stale overwrite."""
        monkeypatch, storage, calls = refresh_env
        monkeypatch.setattr(storage, "sync_user_db_from_r2_if_newer",
                            lambda uid, path, v: (True, 7, False))
        from app.routers import admin
        admin._refresh_target_user_db(GRANTEE)
        assert calls["ensured"] == [GRANTEE]
        assert calls["set_version"] == [(GRANTEE, 7)]

    def test_r2_error_does_not_raise_and_does_not_bump_version(self, refresh_env):
        """A transient R2 error is best-effort: log + proceed (the grant still
        applies), never raise, never record a version we did not download."""
        monkeypatch, storage, calls = refresh_env
        monkeypatch.setattr(storage, "sync_user_db_from_r2_if_newer",
                            lambda uid, path, v: (False, None, True))
        from app.routers import admin
        admin._refresh_target_user_db(GRANTEE)  # must not raise
        assert calls["set_version"] == []

    def test_up_to_date_is_a_noop(self, refresh_env):
        """T4315: _refresh_target_user_db now delegates to the shared
        confirm_current_before_write -> ensure_user_database_fresh, which
        follows the design's own confirm_current_before_write pseudocode
        literally: record whatever version R2 confirms, downloaded or not
        (a harmless re-write of the same in-memory value -- no disk I/O,
        see set_local_user_db_version). The meaningful invariant (no version
        recorded on an unconfirmed/error read) is covered by
        test_r2_error_does_not_raise_and_does_not_bump_version below."""
        monkeypatch, storage, calls = refresh_env
        monkeypatch.setattr(storage, "sync_user_db_from_r2_if_newer",
                            lambda uid, path, v: (False, 3, False))
        from app.routers import admin
        admin._refresh_target_user_db(GRANTEE)
        assert calls["set_version"] == [(GRANTEE, 3)]

    def test_r2_disabled_skips_entirely(self, refresh_env):
        """No R2 -> nothing to SYNC (never a network call, never records a
        version). T4315: the shared helper's write-path entry point
        (ensure_user_database_fresh) always ensures the local schema first
        -- cheap and purely local, unconditionally on the R2 flag, mirroring
        ensure_user_database's own unconditional table-creation step -- then
        exits before touching R2."""
        monkeypatch, storage, calls = refresh_env
        monkeypatch.setattr(storage, "R2_ENABLED", False)
        # If sync were called it would explode (not patched to succeed meaningfully)
        monkeypatch.setattr(storage, "sync_user_db_from_r2_if_newer",
                            lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not sync")))
        from app.routers import admin
        admin._refresh_target_user_db(GRANTEE)
        assert calls["ensured"] == [GRANTEE]
        assert calls["set_version"] == []
