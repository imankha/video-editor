"""T6390 — per-DB marker scoping + sync-conflict diagnostics.

Part B is a correctness fix: `.sync_conflict` / `.sync_failed` were per-USER marker
files describing per-DB, per-PROFILE state, so a success on ONE database silently
erased a live conflict on ANOTHER. These tests reproduce each stomp FIRST (they fail
on the pre-fix code) and pin the scoped behaviour.

Part A adds a JSON diag payload to the marker (was a bare `str(time.time())`); the
reader must tolerate the legacy float body written by the running deploy.

Uses the real storage.py CAS logic against the in-memory FakeR2 (same harness as
test_t4310) so nothing about the conflict guard is mocked away.
"""

import sqlite3
from unittest.mock import patch

from app.database import SyncResult
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER = "u_t6390"
PROFILE = "abcd6390"


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


def _seed_r2(fake, key, data, version):
    fake._objects[key] = {"data": data, "metadata": {"db-version": str(version)}}


# ---------------------------------------------------------------------------
# Stomp (a): retry_pending_sync self-stomp — profile CONFLICT + user OK, one call.
# ---------------------------------------------------------------------------

class TestRetryPendingSyncSelfStomp:

    def test_profile_conflict_survives_user_success(self, tmp_path):
        """A CAS conflict on profile.sqlite must NOT be erased by a healthy
        user.sqlite sync in the SAME retry_pending_sync call.

        Pre-fix: the profile branch marks the conflict, then the user branch's
        success calls clear_sync_conflict(user_id) and wipes it → has_sync_conflict
        reads False and the aggregate return is a bare False (mislabelled failed)."""
        from app.database import (
            USER_DB_SCOPE,
            has_sync_conflict,
            mark_sync_pending,
            set_local_db_version,
            set_local_user_db_version,
        )
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import _user_db_r2_key, profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             _r2_patched(fake):
            _make_profile_db(tmp_path, marker="stale_profile")
            _make_user_db(tmp_path, marker="healthy_user")

            # profile.sqlite: loaded v3, R2 at v9 → CAS conflict.
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"),
                     b"NEWER_PROFILE", 9)
            set_local_db_version(USER, PROFILE, 3)
            # user.sqlite: loaded v5, R2 at v5 → clean upload to v6.
            _seed_r2(fake, _user_db_r2_key(USER), b"USER_OLD", 5)
            set_local_user_db_version(USER, 5)
            # T5081: retry_pending_sync is now gated on the scoped pending marker.
            mark_sync_pending(USER, scope=PROFILE)
            mark_sync_pending(USER, scope=USER_DB_SCOPE)

            outcome = retry_pending_sync(USER, PROFILE)

            # The profile conflict must survive the user success.
            assert has_sync_conflict(USER), \
                "profile CAS conflict was stomped by the user.sqlite success"
            # The aggregate outcome names the conflict, not a generic failure.
            assert outcome is SyncResult.CONFLICT
            assert not outcome  # truthy-only-on-OK contract preserved


# ---------------------------------------------------------------------------
# Stomp (b): a user.sqlite-only success must not clear a live profile conflict.
# ---------------------------------------------------------------------------

class TestCrossDbClear:

    def test_user_success_keeps_profile_conflict(self, tmp_path):
        """sync_user_db_to_r2_explicit success must clear ONLY the user scope,
        never a profile-scope conflict marked moments earlier."""
        from app.database import (
            has_sync_conflict,
            mark_sync_conflict,
            set_local_user_db_version,
            sync_user_db_to_r2_explicit,
        )
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_user_db(tmp_path, marker="healthy_user")
            _seed_r2(fake, _user_db_r2_key(USER), b"USER_OLD", 5)
            set_local_user_db_version(USER, 5)

            # A live conflict on the PROFILE db (a different scope).
            mark_sync_conflict(USER, PROFILE, diag={"reason": "stale_baseline", "db": "profile"})

            result = sync_user_db_to_r2_explicit(USER)

            assert result is SyncResult.OK
            assert has_sync_conflict(USER), \
                "user.sqlite success must not clear a profile-scope conflict"

    def test_profile_success_keeps_user_conflict(self, tmp_path):
        """Symmetric: a profile.sqlite success must not clear a user-scope conflict."""
        from app.database import (
            USER_DB_SCOPE,
            has_sync_conflict,
            mark_sync_conflict,
            set_local_db_version,
            sync_db_to_r2_explicit,
        )
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, marker="healthy_profile")
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"P_OLD", 2)
            set_local_db_version(USER, PROFILE, 2)

            mark_sync_conflict(USER, USER_DB_SCOPE, diag={"reason": "stale_baseline", "db": "user"})

            result = sync_db_to_r2_explicit(USER, PROFILE)

            assert result is SyncResult.OK
            assert has_sync_conflict(USER), \
                "profile.sqlite success must not clear a user-scope conflict"


# ---------------------------------------------------------------------------
# Stomp (c): a surviving conflict is not blind-retried by the re-drain.
# ---------------------------------------------------------------------------

class TestRedrainDoesNotBlindRetryConflict:

    def test_redrain_stops_on_conflict_outcome(self, tmp_path):
        """_redrain_failed_sync must STOP the moment retry_pending_sync reports a
        CONFLICT — a CAS conflict is not blind-retryable. It must decide this from
        the RETURN VALUE, not by re-reading a marker file the self-stomp defeated."""
        import asyncio

        from app.database import has_sync_conflict, mark_sync_pending, set_local_db_version
        from app.middleware.db_sync import RequestContextMiddleware
        from app.storage import _user_db_r2_key, profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             _r2_patched(fake):
            _make_profile_db(tmp_path, marker="stale_profile")
            _make_user_db(tmp_path, marker="healthy_user")
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"NEWER", 9)
            set_local_db_version(USER, PROFILE, 3)
            _seed_r2(fake, _user_db_r2_key(USER), b"U", 5)
            from app.database import set_local_user_db_version
            set_local_user_db_version(USER, 5)
            # T5081: retry_pending_sync (which the re-drain calls) is now gated
            # on the scoped pending marker.
            mark_sync_pending(USER, scope=PROFILE)

            mw = RequestContextMiddleware.__new__(RequestContextMiddleware)

            with patch("app.middleware.db_sync._REDRAIN_BASE_BACKOFF_S", 0.0):
                healed = asyncio.run(mw._redrain_failed_sync(USER, PROFILE))

            assert healed is False, "a CAS conflict must not be reported as healed"
            assert has_sync_conflict(USER), "conflict marker must remain set"
            # Exactly one upload attempt per DB per real retry — the re-drain bailed
            # on the first conflict rather than retrying to exhaustion.
            prof_uploads = [c for c in fake.upload_calls
                            if c[1].endswith("profile.sqlite")]
            assert prof_uploads == [], "conflicting profile upload must be refused, never retried up"


# ---------------------------------------------------------------------------
# Legacy-format tolerance: a marker written as a bare float must read cleanly.
# ---------------------------------------------------------------------------

class TestLegacyMarkerTolerance:

    def test_legacy_float_marker_reads_without_raising(self, tmp_path):
        import time

        from app.database import has_sync_conflict, read_sync_diag

        with patch("app.database.USER_DATA_BASE", tmp_path):
            # A marker written by the running (pre-T6390) deploy: bare float body,
            # at the legacy unscoped path.
            legacy = tmp_path / USER
            legacy.mkdir(parents=True, exist_ok=True)
            (legacy / ".sync_conflict").write_text(str(time.time()))

            assert has_sync_conflict(USER) is True
            diag = read_sync_diag(USER)  # must NOT raise on the float body
            assert diag is not None
            assert diag.get("reason") == "legacy"


# ---------------------------------------------------------------------------
# Part A: the marker payload carries the diagnosis, exposed via read_sync_diag.
# ---------------------------------------------------------------------------

class TestDiagPayload:

    def test_conflict_marker_carries_structured_diag(self, tmp_path):
        from app.database import read_sync_diag, set_local_db_version, sync_db_to_r2_explicit
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, marker="stale")
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            # Seed R2 with a writer identity (stamped by whoever moved it ahead).
            fake._objects[key] = {
                "data": b"NEWER",
                "metadata": {"db-version": "9", "db-writer": "machineX/req9999",
                             "db-written-at": "2026-08-03T01:15:00Z"},
            }
            set_local_db_version(USER, PROFILE, 3)

            result = sync_db_to_r2_explicit(USER, PROFILE)
            assert result is SyncResult.CONFLICT

            diag = read_sync_diag(USER)
            assert diag["reason"] == "stale_baseline"
            assert diag["db"] == "profile"
            assert diag["profile_id"] == PROFILE
            assert diag["loaded"] == 3
            assert diag["r2"] == 9
            assert diag["writer"] == "machineX/req9999"
            assert diag["written_at"] == "2026-08-03T01:15:00Z"

    def test_unconfirmed_baseline_reason_is_distinct(self, tmp_path):
        """loaded=None (unconfirmed) and loaded=vN (stale) must produce DIFFERENT
        reasons — the whole point of the discrimination."""
        from app.database import read_sync_diag, set_local_db_version, sync_db_to_r2_explicit
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, marker="unconfirmed")
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"NEWER", 9)
            set_local_db_version(USER, PROFILE, None)  # never confirmed a baseline

            result = sync_db_to_r2_explicit(USER, PROFILE)
            assert result is SyncResult.CONFLICT

            diag = read_sync_diag(USER)
            assert diag["reason"] == "unconfirmed_baseline"
            assert diag["loaded"] is None
