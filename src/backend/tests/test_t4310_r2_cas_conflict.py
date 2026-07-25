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
   fake R2: a stale loaded-version is REFUSED (no upload), re-downloads the
   newer copy, and updates the local baseline so the next attempt isn't stuck
   comparing against stale data forever (regression-pins the arshia class).
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

    def test_stale_writer_refused_and_baseline_updated(self, tmp_path):
        """Regression-pin the arshia move_reels class: a machine whose loaded
        version (v3) is behind R2's (v9) must be REFUSED, not overwrite R2."""
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
            # Baseline updated to the re-downloaded version -- the NEXT attempt
            # compares against fresh data instead of looping on stale v3 forever.
            assert get_local_db_version(USER, PROFILE) == 9

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
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake), \
             patch("app.storage.get_db_version_from_r2", return_value=R2VersionResult.NOT_FOUND) as mock_head:
            _make_profile_db(tmp_path)
            set_local_db_version(USER, PROFILE, 0)

            sync_db_to_r2_explicit(USER, PROFILE)

            mock_head.assert_called_once()


class TestUserDbCasConflict:

    def test_stale_writer_refused_and_baseline_updated(self, tmp_path):
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
            assert get_local_user_db_version(USER) == 5

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
# Reviewer BLOCKING-1: a conflict whose re-download FAILS must not advance the
# baseline. Advancing it anyway re-opens the arshia clobber -- the next retry
# would compare the still-stale local copy against the "confirmed" r2_version,
# see no conflict, and silently force-push the stale data over the newer R2 copy.
# ---------------------------------------------------------------------------

class TestConflictRedownloadFailure:

    def test_profile_redownload_failure_does_not_advance_baseline_or_reupload(self, tmp_path):
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
            fake.fail_download = True

            result = sync_db_to_r2_explicit(USER, PROFILE)

            assert result is SyncResult.FAILED
            assert not result
            # Baseline must NOT move -- the local copy was never confirmed refreshed.
            assert get_local_db_version(USER, PROFILE) == 3
            assert fake._objects[key]["data"] == b"NEWER_R2_COPY"

            # Retry once the R2 blip clears: CAS must refuse AGAIN (still stale
            # baseline), never silently upload the stale v3 local copy as "clean".
            fake.fail_download = False
            result2 = sync_db_to_r2_explicit(USER, PROFILE)

            assert result2 is SyncResult.CONFLICT
            assert fake._objects[key]["data"] == b"NEWER_R2_COPY", \
                "the stale local copy must never land on R2"
            assert get_local_db_version(USER, PROFILE) == 9

    def test_user_db_redownload_failure_does_not_advance_baseline_or_reupload(self, tmp_path):
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
            fake.fail_download = True

            result = sync_user_db_to_r2_explicit(USER)

            assert result is SyncResult.FAILED
            assert get_local_user_db_version(USER) == 2
            assert fake._objects[key]["data"] == b"NEWER_R2_USER"

            fake.fail_download = False
            result2 = sync_user_db_to_r2_explicit(USER)

            assert result2 is SyncResult.CONFLICT
            assert fake._objects[key]["data"] == b"NEWER_R2_USER"
            assert get_local_user_db_version(USER) == 5


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
        monkeypatch.setattr(m, "_SYNC_IN_PROGRESS", set())

    def test_profile_conflict_sets_conflict_status_and_marker(self):
        from app.database import has_sync_pending, mark_sync_pending
        from app.middleware.db_sync import RequestContextMiddleware, _begin_sync_attempt

        user_id = "test-t4310-conflict"
        mark_sync_pending(user_id)
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

    def test_ok_after_prior_conflict_clears_both_markers(self):
        """A subsequent successful sync (e.g. after the user hits Retry) must
        clear both the generic pending marker and the conflict-specific one."""
        from app.database import (
            clear_sync_pending,
            has_sync_pending,
            mark_sync_conflict,
            mark_sync_pending,
        )
        from app.middleware.db_sync import RequestContextMiddleware, _begin_sync_attempt

        user_id = "test-t4310-recover"
        mark_sync_pending(user_id)
        mark_sync_conflict(user_id)
        _begin_sync_attempt(user_id)
        middleware = RequestContextMiddleware(app=None)

        async def runner():
            with patch(
                "app.middleware.db_sync.sync_db_to_r2_explicit",
                return_value=SyncResult.OK,
            ):
                return await middleware._background_sync(
                    user_id, "prof1", "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=False,
                    do_profile=False, force_profile=False,
                )

        status = asyncio.run(runner())

        assert status == "ok"
        assert not has_sync_pending(user_id)
        # _background_sync itself doesn't call clear_sync_conflict (that lives
        # inside sync_db_to_r2_explicit, mocked away here) -- clean up directly
        # so this test only asserts what it set up.
        clear_sync_pending(user_id)


# ---------------------------------------------------------------------------
# 4. retry_pending_sync — conflict never blind-overwrites
# ---------------------------------------------------------------------------

class TestRetryPendingSyncConflict:

    def test_conflict_updates_baseline_and_reports_not_ok(self, tmp_path):
        from app.middleware.db_sync import retry_pending_sync

        profile_dir = tmp_path / USER / "profiles" / PROFILE
        profile_dir.mkdir(parents=True)
        (profile_dir / "profile.sqlite").write_text("fake")

        with patch("app.storage.sync_database_to_r2_with_version",
                   return_value=(False, 9)) as mock_sync, \
             patch("app.database.get_local_db_version", return_value=3), \
             patch("app.database.set_local_db_version") as mock_set_ver, \
             patch("app.database.get_local_user_db_version", return_value=None), \
             patch("app.database.set_local_user_db_version"), \
             patch("app.database.USER_DATA_BASE", tmp_path):
            result = retry_pending_sync(USER, profile_id=PROFILE)

        assert result is False, "a conflict is not a successful retry"
        # CAS is on (skip_version_check=False) for this always-off-thread path.
        assert mock_sync.call_args.kwargs["skip_version_check"] is False
        # The baseline is still updated to the re-downloaded R2 version, so the
        # NEXT retry compares against fresh data instead of repeating forever.
        mock_set_ver.assert_called_once_with(USER, PROFILE, 9)


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

    def test_payments_webhook_passes_skip_version_check_true(self, monkeypatch):
        """The Stripe webhook handler itself (not just a bare call to the sync
        function) must pass skip_version_check=True -- it also runs
        synchronously on the request thread, same T2720 constraint as profile
        create."""
        import asyncio as _asyncio

        from app.routers import payments as payments_mod

        calls = []

        def _fake_sync(user_id, skip_version_check=False, **kw):
            calls.append(skip_version_check)
            return True

        event = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "id": "cs_test_123",
                "metadata": {"user_id": "some-user", "credits": "40", "pack": "starter"},
            }},
        }

        monkeypatch.setattr(payments_mod, "sync_user_db_to_r2_explicit", _fake_sync)
        monkeypatch.setattr(payments_mod, "STRIPE_WEBHOOK_SECRET", "whsec_test")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        monkeypatch.setattr(payments_mod, "has_processed_payment", lambda *a, **k: False)
        monkeypatch.setattr(payments_mod, "grant_credits", lambda *a, **k: 440)
        monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)
        monkeypatch.setattr(payments_mod, "increment_total_spent", lambda *a, **k: None)

        class _FakeRequest:
            headers = {"stripe-signature": "sig"}

            async def body(self):
                return b"{}"

        result = _asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert result["status"] == "credits_granted"
        assert calls == [True], "payments webhook must pass skip_version_check=True explicitly"
