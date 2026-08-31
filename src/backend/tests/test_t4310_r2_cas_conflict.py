"""T4310 — R2 version-conflict detection (CAS uploads, upload side).

Prior to this task every production R2 upload passed skip_version_check=True
(T950's conflict check, storage.py, was fully implemented but compiled out by
T1020 for latency). This let a stale writer force-push over newer R2 state —
the exact arshia move_reels clobber (single machine, R2 blip) and the
multi-machine both-live race. T4310 turns CAS back on for every async/worker/
shutdown upload path (never the request thread — that stays T1020/T2720-fast)
and gives the *_explicit sync functions a 3-state SyncResult so a genuine
conflict is distinguishable from a transient failure and the middleware's
`_background_sync` conflict arm goes live.

Covers:
1. sync_db_to_r2_explicit / sync_user_db_to_r2_explicit run real CAS against a
   fake R2: a stale loaded-version is REFUSED (no upload), and the local
   baseline stays FROZEN (regression-pins the arshia class) -- reviewer round 2
   (MAJOR-2) removed the re-download that used to run here: it was dead code
   pre-T4310 (every caller skipped the check) but went LIVE on the normal write
   path, where profile.sqlite is WAL-mode and _background_sync runs outside the
   per-user write lock, so swapping the main DB file mid-conflict risked
   cross-DB WAL page mixing. Refusing alone is safe: the same conflict is
   simply refused again on every retry until T4315's restore path heals it.
2. A matching/older loaded-version uploads normally (no false positives).
3. _background_sync routes SyncResult.CONFLICT to sync_status="conflict" and
   leaves the sync_failed marker set (surfaces via the existing X-Sync-Status
   UX) while additionally recording the distinct sync_conflict marker.
4. retry_pending_sync (the request-path retry worker, always off the event
   loop via asyncio.to_thread) handles a conflict the same way — never a
   blind re-overwrite.
5. The lone request-thread-synchronous callers (profile create, payments
   webhook) still pass skip_version_check=True, so T2720/T1020's no-HEAD-on-
   the-request-thread guarantee is not regressed by turning CAS on elsewhere.
"""

import asyncio
import sqlite3
from unittest.mock import patch

import pytest

from app.database import SyncResult
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER = "u_t4310"
PROFILE = "abcd1234"


def _make_profile_db(base, user_id=USER, profile_id=PROFILE, marker="v0"):
    d = base / user_id / "profiles" / profile_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "profile.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    conn.commit()
    conn.close()
    return p


def _make_user_db(base, user_id=USER, marker="v0"):
    d = base / user_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "user.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    conn.commit()
    conn.close()
    return p


# ---------------------------------------------------------------------------
# 1 & 2. Real CAS via sync_db_to_r2_explicit / sync_user_db_to_r2_explicit
# ---------------------------------------------------------------------------

class TestProfileDbCasConflict:

    def test_stale_writer_refused_and_baseline_frozen(self, tmp_path):
        """Regression-pin the arshia move_reels class: a machine whose loaded
        version (v3) is behind R2's (v9) must be REFUSED, not overwrite R2.

        Reviewer round 2 (MAJOR-2): storage.py no longer re-downloads on
        conflict (WAL-unsafe swap outside the write lock). The baseline must
        never ADVANCE to R2's version without a confirmed refresh (that would
        disarm CAS). T6160: on conflict it is instead INVALIDATED to None so the
        next request re-pulls — None is not an advance, the storage-side CAS still
        refuses a None baseline against real R2 content (BLOCKING-2), so a second
        attempt refuses AGAIN and the stale copy still never lands on R2."""
        from app.database import (
            get_local_db_version,
            set_local_db_version,
            sync_db_to_r2_explicit,
        )
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, marker="stale_local")
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            fake._objects[key] = {"data": b"NEWER_R2_COPY", "metadata": {"db-version": "9"}}
            set_local_db_version(USER, PROFILE, 3)

            result = sync_db_to_r2_explicit(USER, PROFILE)

            assert result is SyncResult.CONFLICT
            assert not result
            # No NEW upload landed -- R2 still holds exactly the seeded bytes.
            assert fake._objects[key]["data"] == b"NEWER_R2_COPY"
            assert not any(c[1] == key for c in fake.upload_calls), \
                "CAS must refuse the upload entirely, not upload-then-detect"
            # No re-download either -- the conflict handler itself never swaps the
            # local file (WAL-unsafe outside the write lock); the re-pull is
            # deferred to the next request's ensure_database.
            assert not fake.download_calls, "conflict must not trigger a re-download (WAL-unsafe)"
            # T6160: invalidated to None (self-heal), NOT advanced to R2's v9.
            assert get_local_db_version(USER, PROFILE) is None

            # Retry with the (now None) baseline: CAS must refuse AGAIN — a None
            # baseline against real R2 content still refuses (BLOCKING-2).
            result2 = sync_db_to_r2_explicit(USER, PROFILE)

            assert result2 is SyncResult.CONFLICT
            assert fake._objects[key]["data"] == b"NEWER_R2_COPY", \
                "the stale local copy must never land on R2"
            assert get_local_db_version(USER, PROFILE) is None

    def test_matching_version_uploads_and_bumps(self, tmp_path):
        """No false positives: a writer whose loaded version matches R2 (or R2
        has nothing yet) uploads normally."""
        from app.database import (
            get_local_db_version,
            set_local_db_version,
            sync_db_to_r2_explicit,
        )

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, marker="fresh_local")
            set_local_db_version(USER, PROFILE, 0)

            result = sync_db_to_r2_explicit(USER, PROFILE)

            assert result is SyncResult.OK
            assert get_local_db_version(USER, PROFILE) == 1

    def test_cas_is_on_by_default_head_is_called(self, tmp_path):
        """sync_db_to_r2_explicit defaults to skip_version_check=False (CAS on)
        -- background/worker callers get the HEAD for free."""
        from app.database import set_local_db_version, sync_db_to_r2_explicit
        from app.storage import R2VersionResult

        fake = FakeR2()
        # T6390: the primitive now reads the object Metadata from the SAME HEAD
        # (return_metadata=True) so a conflict can name the writer — the mock
        # returns the (result, metadata) tuple that contract now expects.
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake), \
             patch("app.storage.get_db_version_from_r2",
                   return_value=(R2VersionResult.NOT_FOUND, {})) as mock_head:
            _make_profile_db(tmp_path)
            set_local_db_version(USER, PROFILE, 0)

            sync_db_to_r2_explicit(USER, PROFILE)

            mock_head.assert_called_once()


class TestUserDbCasConflict:

    def test_stale_writer_refused_and_baseline_frozen(self, tmp_path):
        """Reviewer round 2 (MAJOR-2): no re-download, baseline never ADVANCED.
        T6160: invalidated to None on conflict (self-heal, decision 4) — still
        never a force-push of the stale copy."""
        from app.database import (
            get_local_user_db_version,
            set_local_user_db_version,
            sync_user_db_to_r2_explicit,
        )
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_user_db(tmp_path, marker="stale_local")
            key = _user_db_r2_key(USER)
            fake._objects[key] = {"data": b"NEWER_R2_USER", "metadata": {"db-version": "5"}}
            set_local_user_db_version(USER, 2)

            result = sync_user_db_to_r2_explicit(USER)

            assert result is SyncResult.CONFLICT
            assert not result
            assert fake._objects[key]["data"] == b"NEWER_R2_USER"
            assert not fake.download_calls, "conflict must not trigger a re-download (WAL-unsafe)"
            # T6160: invalidated to None (self-heal), NOT advanced to R2's v5.
            assert get_local_user_db_version(USER) is None

            result2 = sync_user_db_to_r2_explicit(USER)

            assert result2 is SyncResult.CONFLICT
            assert fake._objects[key]["data"] == b"NEWER_R2_USER"
            assert get_local_user_db_version(USER) is None

    def test_matching_version_uploads_and_bumps(self, tmp_path):
        from app.database import (
            get_local_user_db_version,
            set_local_user_db_version,
            sync_user_db_to_r2_explicit,
        )

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_user_db(tmp_path, marker="fresh_local")
            set_local_user_db_version(USER, 0)

            result = sync_user_db_to_r2_explicit(USER)

            assert result is SyncResult.OK
            assert get_local_user_db_version(USER) == 1


# ---------------------------------------------------------------------------
# 3. _background_sync routes CONFLICT distinctly from a plain failure
# ---------------------------------------------------------------------------

class TestBackgroundSyncConflictRouting:

    @pytest.fixture(autouse=True)
    def isolate(self, tmp_path, monkeypatch):
        import app.database as db_module
        from app.middleware import db_sync as m
        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        monkeypatch.setattr(m, "_USER_WRITE_LOCKS", {})
        monkeypatch.setattr(m, "_SYNC_IN_PROGRESS", {})

    def test_profile_conflict_sets_conflict_status_and_marker(self):
        from app.database import has_sync_pending, mark_sync_pending
        from app.middleware.db_sync import RequestContextMiddleware, _begin_sync_attempt

        user_id = "test-t4310-conflict"
        mark_sync_pending(user_id, scope="prof1")
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        async def runner():
            with patch(
                "app.middleware.db_sync.sync_db_to_r2_explicit",
                return_value=SyncResult.CONFLICT,
            ):
                return await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                )

        status = asyncio.run(runner())

        assert status == "conflict"
        # The existing sync_failed/X-Sync-Status UX is unaffected: the marker
        # stays set (only "ok" clears it), so a conflict still surfaces as a
        # persistent "edits aren't saving - Retry" for the user.
        assert has_sync_pending(user_id), "conflict must NOT silently clear the retry marker"

    def test_ok_status_clears_pending_marker(self, tmp_path):
        """T5081 (review round 3): clearing now lives ENTIRELY inside
        sync_db_to_r2_explicit (INV-P clear reason a) -- _background_sync
        itself clears nothing anymore. Mocking the primitive away with a bare
        SyncResult.OK would bypass that real clearing, so this drives it for
        real against FakeR2."""
        from app.database import (
            has_sync_pending,
            mark_sync_pending,
            set_local_db_version,
        )
        from app.middleware.db_sync import RequestContextMiddleware, _begin_sync_attempt
        from app.storage import profile_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        user_id = "test-t4310-recover"
        _make_profile_db(tmp_path, user_id=user_id, profile_id="prof1")
        mark_sync_pending(user_id, scope="prof1")
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            fake._objects[profile_r2_key(user_id, "prof1", "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "0"}}
            set_local_db_version(user_id, "prof1", 0)

            async def runner():
                return await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                )

            status = asyncio.run(runner())

        assert status == "ok"
        assert not has_sync_pending(user_id)


# ---------------------------------------------------------------------------
# Reviewer round 2 BLOCKING-2/MINOR: a real sync success must clear BOTH the
# pending and conflict markers, or a stale .sync_conflict sticks around and
# mislabels every later transient failure as "conflict".
# ---------------------------------------------------------------------------

class TestSetSyncFailedClearsConflictMarker:

    def test_clearing_sync_failed_also_clears_conflict_marker(self, tmp_path, monkeypatch):
        """T5081 (review round 3, Q4): set_sync_failed manages ONLY the alarm
        markers (.sync_conflict/.sync_failed) now — it must NEVER touch
        .sync_pending, a durability record only a confirmed upload, a restore,
        or the db's deletion may discharge (INV-P). The old behavior (clearing
        .sync_pending here too) let a manual-retry-adjacent call erase the
        record of a write this call never verified landed."""
        import app.database as db_module
        from app.database import (
            USER_DB_SCOPE,
            has_sync_conflict,
            has_sync_pending,
            mark_sync_conflict,
            mark_sync_pending,
        )
        from app.middleware.db_sync import set_sync_failed

        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        user_id = "test-t4310-clear-both"
        mark_sync_pending(user_id, scope=USER_DB_SCOPE)
        mark_sync_conflict(user_id)
        assert has_sync_pending(user_id) and has_sync_conflict(user_id)

        set_sync_failed(user_id, False)

        assert not has_sync_conflict(user_id), \
            "a stale conflict marker must not survive a real sync success"
        assert has_sync_pending(user_id), \
            "set_sync_failed must NOT clear .sync_pending — that's a durability " \
            "record only a confirmed upload/restore/delete may discharge"

    def test_marking_sync_failed_does_not_touch_conflict_marker(self, tmp_path, monkeypatch):
        """Marking a NEW plain failure (failed=True) must not fabricate a
        conflict marker that was never set."""
        import app.database as db_module
        from app.database import has_sync_conflict
        from app.middleware.db_sync import set_sync_failed

        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        user_id = "test-t4310-plain-failure"

        set_sync_failed(user_id, True)

        assert not has_sync_conflict(user_id)


# ---------------------------------------------------------------------------
# Reviewer round 2 MINOR: the both-DBs parallel branch runs _sync_profile and
# _sync_user CONCURRENTLY (asyncio.gather), and each independently
# mark_sync_conflict/clear_sync_conflict via database.py for the SAME per-user
# marker file -- one thread's clear can race and stomp the other's concurrent
# mark, degrading a real conflict down to a plain "failed" on the header.
# ---------------------------------------------------------------------------

class TestParallelSyncMarkerRaceFixed:

    @pytest.fixture(autouse=True)
    def isolate(self, tmp_path, monkeypatch):
        import app.database as db_module
        from app.middleware import db_sync as m
        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        monkeypatch.setattr(m, "_USER_WRITE_LOCKS", {})
        monkeypatch.setattr(m, "_SYNC_IN_PROGRESS", {})

    # T6390: the post-gather REASSERTION these tests originally pinned is DELETED.
    # It existed to survive the profile/user threads racing on ONE shared per-user
    # marker file; markers are now PER SCOPE (each thread writes only its own db's
    # scope) so the race is structurally impossible and reasserting from this
    # request's two statuses would re-introduce the cross-DB clear the task removes.
    # These tests now drive the REAL scoped sync_*_explicit against FakeR2 (no mock
    # of the marker-writing functions) so they exercise the scoping directly.

    def test_profile_ok_user_conflict_keeps_user_scope_conflict(self, tmp_path):
        """profile.sqlite syncs cleanly while user.sqlite hits a CAS conflict: the
        profile success must NOT clear the user's conflict (the cross-DB stomp), the
        header still reports "conflict", and the user-scope marker survives."""
        from app.database import (
            USER_DB_SCOPE,
            has_sync_conflict,
            mark_sync_pending,
            set_local_db_version,
            set_local_user_db_version,
        )
        from app.middleware.db_sync import RequestContextMiddleware, _begin_sync_attempt
        from app.storage import _user_db_r2_key, profile_r2_key

        user_id, profile_id = "t4310-scope-race", "prof1race"
        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, user_id=user_id, profile_id=profile_id)
            _make_user_db(tmp_path, user_id=user_id)
            # profile: local == R2 → clean upload. user: local behind R2 → conflict.
            fake._objects[profile_r2_key(user_id, profile_id, "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "2"}}
            set_local_db_version(user_id, profile_id, 2)
            fake._objects[_user_db_r2_key(user_id)] = {
                "data": b"U_NEWER", "metadata": {"db-version": "9"}}
            set_local_user_db_version(user_id, 3)

            mark_sync_pending(user_id, scope=profile_id)
            mark_sync_pending(user_id, scope=USER_DB_SCOPE)
            _begin_sync_attempt(user_id)
            middleware = RequestContextMiddleware(app=None)

            status = asyncio.run(middleware._background_sync(
                user_id, profile_id, "rid1", "POST", "/api/test",
                had_writes=True, had_user_db_writes=True,
                do_profile=False, force_profile=False,
            ))

            assert status == "conflict"
            assert has_sync_conflict(user_id), \
                "profile success must not stomp the user.sqlite conflict"

    def test_both_ok_clears_the_scope_conflict(self, tmp_path):
        """Both DBs sync cleanly: each scope's own success clears its own conflict
        marker (and the opportunistic legacy clear), so no stale conflict remains."""
        from app.database import (
            USER_DB_SCOPE,
            has_sync_conflict,
            mark_sync_conflict,
            mark_sync_pending,
            set_local_db_version,
            set_local_user_db_version,
        )
        from app.middleware.db_sync import RequestContextMiddleware, _begin_sync_attempt
        from app.storage import _user_db_r2_key, profile_r2_key

        user_id, profile_id = "t4310-scope-recover", "prof1rec"
        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, user_id=user_id, profile_id=profile_id)
            _make_user_db(tmp_path, user_id=user_id)
            fake._objects[profile_r2_key(user_id, profile_id, "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "2"}}
            set_local_db_version(user_id, profile_id, 2)
            fake._objects[_user_db_r2_key(user_id)] = {
                "data": b"U", "metadata": {"db-version": "2"}}
            set_local_user_db_version(user_id, 2)

            # Leftover conflicts on BOTH scopes from a prior attempt.
            mark_sync_conflict(user_id, scope=profile_id, diag={"reason": "stale_baseline"})
            mark_sync_conflict(user_id, scope=USER_DB_SCOPE, diag={"reason": "stale_baseline"})
            mark_sync_pending(user_id, scope=profile_id)
            mark_sync_pending(user_id, scope=USER_DB_SCOPE)
            _begin_sync_attempt(user_id)
            middleware = RequestContextMiddleware(app=None)

            status = asyncio.run(middleware._background_sync(
                user_id, profile_id, "rid1", "POST", "/api/test",
                had_writes=True, had_user_db_writes=True,
                do_profile=False, force_profile=False,
            ))

            assert status == "ok"
            assert not has_sync_conflict(user_id)


# ---------------------------------------------------------------------------
# 4. retry_pending_sync — conflict never blind-overwrites
# ---------------------------------------------------------------------------

class TestRetryPendingSyncConflict:

    def test_conflict_freezes_baseline_and_reports_not_ok(self, tmp_path):
        """Reviewer round 2 (MAJOR-2): storage.py no longer re-downloads on
        conflict, so retry_pending_sync must NOT ADVANCE the baseline to R2's
        version. T6160: it instead INVALIDATES it (schedule_profile_db_reheal ->
        set_local_db_version(..., None)) so the next request re-pulls — never a
        force-push of the stale copy. Only the conflict marker gets set.

        T5081 (review round 3): retry_pending_sync now delegates to
        sync_db_to_r2_explicit (database.py) for the actual upload/conflict
        handling, so this drives the real primitive against FakeR2 rather than
        mocking storage.py's copy of sync_database_to_r2_with_version (which
        database.py binds separately at import time — patching storage's copy
        doesn't reach a call made from inside database.py) or a
        db_sync.mark_sync_conflict name that no longer exists in that module.
        """
        from app.database import get_local_db_version, has_sync_conflict, mark_sync_pending, set_local_db_version
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import profile_r2_key
        from tests.test_t4050_durable_sync import FakeR2, _r2_patched

        _make_profile_db(tmp_path, marker="stale_local")

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            # Loaded baseline v3; R2 has genuinely moved ahead to v9.
            fake._objects[profile_r2_key(USER, PROFILE, "profile.sqlite")] = {
                "data": b"NEWER", "metadata": {"db-version": "9"}}
            set_local_db_version(USER, PROFILE, 3)
            mark_sync_pending(USER, scope=PROFILE)  # T5081: retry is now gated on this

            result = retry_pending_sync(USER, profile_id=PROFILE)

            # T6390: retry_pending_sync now returns the aggregate SyncResult
            # (CONFLICT), still falsy so legacy `if not result` callers are
            # unaffected.
            assert result is SyncResult.CONFLICT
            assert not result, "a conflict is not a successful retry"
            # T6160: the baseline is INVALIDATED (None), never ADVANCED to R2's v9.
            assert get_local_db_version(USER, PROFILE) is None
            # T6390: the conflict marker is scoped to this profile.
            assert has_sync_conflict(USER)
            assert fake.upload_calls == [], "a refused conflict must never upload"


# ---------------------------------------------------------------------------
# Reviewer MINOR: sync_export_db_to_r2 must return a real bool, never let the
# 3-state SyncResult leak through the `and`-chain (SyncResult.CONFLICT/FAILED
# are falsy, so `x and ok` short-circuits to `x` itself, not `False`).
# ---------------------------------------------------------------------------

class TestExportSyncBoolCoercion:

    def test_profile_conflict_reports_plain_false_not_the_enum(self):
        from app.services import export_helpers

        with patch("app.database.sync_db_to_r2_explicit", return_value=SyncResult.CONFLICT), \
             patch("app.database.sync_user_db_to_r2_explicit", return_value=SyncResult.OK), \
             patch("app.database.mark_sync_pending"):
            result = export_helpers.sync_export_db_to_r2(USER, PROFILE)

        assert result is False, "must coerce to a real bool, not leak the SyncResult enum"

    def test_both_ok_reports_plain_true(self):
        from app.services import export_helpers

        with patch("app.database.sync_db_to_r2_explicit", return_value=SyncResult.OK), \
             patch("app.database.sync_user_db_to_r2_explicit", return_value=SyncResult.OK):
            result = export_helpers.sync_export_db_to_r2(USER, PROFILE)

        assert result is True


# ---------------------------------------------------------------------------
# 5. Request-thread callers keep skipping the HEAD (T1020/T2720 not regressed)
# ---------------------------------------------------------------------------

class TestRequestThreadStillSkipsHead:

    def test_profile_create_passes_skip_version_check_true(self, tmp_path, monkeypatch):
        """POST /api/profiles calls sync_db_to_r2_explicit synchronously (never
        asyncio.to_thread) -- it must keep skip_version_check=True so CAS
        turning on elsewhere never adds a HEAD to this request's event-loop
        thread. `ensure_database`/`sync_db_to_r2_explicit` are imported LOCALLY
        inside create_profile (from app.database), so they must be patched on
        app.database, not on the profiles router module."""
        import asyncio as _asyncio

        import app.database as db_module
        from app.routers import profiles as profiles_mod

        calls = []

        def _fake_sync(user_id, profile_id, skip_version_check=False, **kw):
            calls.append(skip_version_check)
            return True

        monkeypatch.setattr(db_module, "sync_db_to_r2_explicit", _fake_sync)
        monkeypatch.setattr(db_module, "ensure_database", lambda: None)
        monkeypatch.setattr(profiles_mod, "get_profiles", lambda uid: [])
        monkeypatch.setattr(profiles_mod, "db_create_profile", lambda *a, **k: None)
        monkeypatch.setattr(profiles_mod, "set_selected_profile_id", lambda *a, **k: None)
        monkeypatch.setattr(profiles_mod, "invalidate_user_cache", lambda uid: None)

        from app.user_context import set_current_user_id
        set_current_user_id(USER)

        result = _asyncio.run(
            profiles_mod.create_profile(profiles_mod.CreateProfileRequest(name="Test", color="#fff"))
        )

        assert calls == [True], "profile create must pass skip_version_check=True explicitly"
        assert result["name"] == "Test"

    def test_payments_webhook_no_longer_syncs_user_sqlite(self, monkeypatch):
        """T5840: credits moved to Postgres -- the webhook's grant now commits
        durably inside credit_ledger.grant() itself, so there is no more
        user.sqlite write for it to sync. `sync_user_db_to_r2_explicit` isn't
        even imported by payments.py anymore; this pins that it's gone rather
        than silently reintroduced."""
        import asyncio as _asyncio

        from app.routers import payments as payments_mod

        assert not hasattr(payments_mod, "sync_user_db_to_r2_explicit"), (
            "payments.py must not import the R2 sync helper -- credits commit "
            "to Postgres directly now"
        )

        event = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "id": "cs_test_123",
                "metadata": {"user_id": "some-user", "credits": "40", "pack": "starter"},
            }},
        }

        monkeypatch.setattr(payments_mod, "STRIPE_WEBHOOK_SECRET", "whsec_test")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        monkeypatch.setattr(payments_mod, "has_processed_payment", lambda *a, **k: False)
        # MAJOR-1 (Slice B fix3): payments now calls credit_ledger.grant() directly
        # (returning {applied, balance}) and gates the analytics on `applied`, so
        # grant_credits is no longer imported here -- stub `grant` instead.
        monkeypatch.setattr(payments_mod, "grant", lambda *a, **k: {"applied": True, "balance": 440})
        monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)
        monkeypatch.setattr(payments_mod, "increment_total_spent", lambda *a, **k: None)

        class _FakeRequest:
            headers = {"stripe-signature": "sig"}

            async def body(self):
                return b"{}"

        result = _asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert result["status"] == "credits_granted"


# ---------------------------------------------------------------------------
# Reviewer round 2 BLOCKING-2: /api/retry-sync's underlying sync_db_to_cloud
# must run real CAS (skip_version_check=False), not force-push a stale local
# DB over a newer R2 copy. Regression-pins the manual-retry clobber + R2
# version-regression-backwards bug (9 -> 4, which would disarm CAS for every
# other machine comparing r2_version > current_version).
# ---------------------------------------------------------------------------

class TestSyncDbToCloudConflict:

    def test_conflict_refuses_upload_baseline_frozen_version_not_regressed(self, tmp_path):
        from app.database import (
            get_local_db_version,
            set_local_db_version,
            sync_db_to_cloud,
        )
        from app.profile_context import set_current_profile_id
        from app.storage import profile_r2_key
        from app.user_context import set_current_user_id

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, marker="stale_local")
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            fake._objects[key] = {"data": b"NEWER_R2_COPY", "metadata": {"db-version": "9"}}
            set_local_db_version(USER, PROFILE, 3)
            set_current_user_id(USER)
            set_current_profile_id(PROFILE)

            status = sync_db_to_cloud()

            assert status == "conflict"
            # The stale local copy must NOT land on R2, and the version must
            # NOT regress backwards (9 -> 4) -- a regression would disarm CAS
            # for every other machine, whose r2_version > current_version test
            # would then falsely read "no conflict".
            assert fake._objects[key]["data"] == b"NEWER_R2_COPY"
            assert fake._objects[key]["metadata"]["db-version"] == "9"
            assert not any(c[1] == key for c in fake.upload_calls)
            # Baseline stays frozen -- never advanced without a confirmed refresh.
            assert get_local_db_version(USER, PROFILE) == 3


class TestRetrySyncEndpointConflictMapping:
    """health.py's retry_sync() maps sync_db_to_cloud's string status to the
    JSON response. Round 2 BLOCKING-2: `if success:` treated the strings
    "conflict"/"failed" as truthy (any non-empty string is truthy in Python),
    reporting {"success": true} and clearing .sync_pending after a sync that
    was actually refused."""

    def test_conflict_that_cannot_restore_reports_failure_and_keeps_marker(self, tmp_path, monkeypatch):
        """T5870: a conflict now routes to restore-if-newer, not a blind re-push.
        When that restore cannot complete, the endpoint must STILL never lie about
        durability — success=False and the conflict marker is retained (preserving
        the round-2 BLOCKING-2 intent: a refused/unresolved sync is never reported
        as saved)."""
        import app.database as db_module
        from app.database import has_sync_conflict, mark_sync_conflict, mark_sync_pending
        from app.routers import health as health_mod
        from app.services.db_refresh import RefreshFailed
        from app.user_context import set_current_user_id

        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        user_id = "test-t4310-retry-conflict"
        monkeypatch.setattr(health_mod, "R2_ENABLED", True)
        # T5081: retry_sync() checks has_sync_conflict() BEFORE ever calling
        # drain_pending_scopes (its sync_db_to_cloud replacement) — a
        # pre-existing conflict marker routes straight to
        # _retry_resolve_conflict, so no sync_db_to_cloud stand-in is needed.

        def _boom(uid, profile_id=None):
            raise RefreshFailed("R2 unreachable")

        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write", _boom
        )
        set_current_user_id(user_id)
        mark_sync_pending(user_id, scope="prof1")
        mark_sync_conflict(user_id)

        import asyncio as _asyncio
        result = _asyncio.run(health_mod.retry_sync())

        assert result["success"] is False
        assert result.get("conflict") is True
        assert has_sync_conflict(user_id), \
            "an unresolved conflict must not clear its marker"
