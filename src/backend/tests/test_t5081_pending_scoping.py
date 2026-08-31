"""T5081 — scope `.sync_pending` per-DB, like `.sync_conflict`/`.sync_failed` (T6390).

The defect this closes: `.sync_pending` was the LAST unscoped marker in this
family. A write to ONE db (e.g. session-init's backfills touching only
user.sqlite) set a per-USER marker that `retry_pending_sync` read as "something
is pending" without knowing WHICH db — so it re-uploaded BOTH profile.sqlite and
user.sqlite on every retry, even when one of them was provably untouched. If R2
had moved ahead on the untouched db for an unrelated reason (a healed profile,
a foreign writer), that re-upload tripped a real CAS conflict against a copy
that had nothing to arbitrate. This is a genuine, separate false-conflict class
found while investigating the 2026-08-04 prod incident — it is NOT that
incident's actual cause (that was a GET request; `retry_pending_sync` only ever
runs on a WRITE, and the incident's own in-memory-baseline mechanism is
EPIC.md finding 1, unaffected by anything in this file). Two rounds of
correction on that misattribution are recorded in EPIC.md field-findings §4.

This file also covers two gaps a reviewer caught in the first scoping pass:
a pending marker on a DIFFERENT profile than the caller's own must still be
drained (not just left correctly-but-permanently pending), and a legacy
unscoped marker must be treated as "pending for every scope" rather than
invisible to the scoped gate (which would strand it forever once nothing
blanket-clears `.sync_pending` on an unrelated success).

Uses the real storage.py CAS logic against the in-memory FakeR2 (same harness
as test_t6390_marker_scoping) so nothing about the conflict guard is mocked.
"""

import asyncio
import sqlite3
from unittest.mock import patch

import pytest

from app.database import SyncResult
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER = "u_t5081"
PROFILE = "abcd5081"
OTHER_PROFILE = "ffff5081"


def _make_profile_db(base, user_id=USER, profile_id=PROFILE, marker="v0"):
    from tests.conftest import stamp_schema_head
    d = base / user_id / "profiles" / profile_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "profile.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    # T5083 (CI escalation FIX 2): stamp the REAL head version (not a
    # sentinel) so the JIT load-seam (now firing on every ensure_database
    # first access) treats this minimal marker-only fixture as already-
    # migrated — see stamp_schema_head's docstring for why a literal
    # sentinel is wrong (a future migration bump could silently leave a
    # fixture stuck below head).
    stamp_schema_head(conn, "profile_db")
    conn.commit()
    conn.close()
    return p


def _make_user_db(base, user_id=USER, marker="v0"):
    from tests.conftest import stamp_schema_head
    d = base / user_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "user.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    stamp_schema_head(conn, "user_db")
    conn.commit()
    conn.close()
    return p


def _seed_r2(fake, key, data, version):
    fake._objects[key] = {"data": data, "metadata": {"db-version": str(version)}}


# ---------------------------------------------------------------------------
# Unit-level: scope isolation + legacy back-compat on the marker helpers.
# ---------------------------------------------------------------------------

class TestScopedPendingMarker:

    def test_scopes_are_independent(self, tmp_path):
        from app.database import (
            USER_DB_SCOPE,
            has_sync_pending,
            has_sync_pending_scope,
            mark_sync_pending,
        )

        with patch("app.database.USER_DATA_BASE", tmp_path):
            mark_sync_pending(USER, scope=PROFILE)

            assert has_sync_pending_scope(USER, PROFILE) is True
            assert has_sync_pending_scope(USER, USER_DB_SCOPE) is False
            assert has_sync_pending_scope(USER, OTHER_PROFILE) is False
            # Aggregate stays True — any scope pending.
            assert has_sync_pending(USER) is True

    def test_clearing_one_scope_leaves_other_scope_pending(self, tmp_path):
        from app.database import (
            USER_DB_SCOPE,
            clear_sync_pending,
            has_sync_pending_scope,
            mark_sync_pending,
        )

        with patch("app.database.USER_DATA_BASE", tmp_path):
            mark_sync_pending(USER, scope=PROFILE)
            mark_sync_pending(USER, scope=USER_DB_SCOPE)

            clear_sync_pending(USER, scope=PROFILE)

            assert has_sync_pending_scope(USER, PROFILE) is False
            assert has_sync_pending_scope(USER, USER_DB_SCOPE) is True, \
                "clearing the profile scope must not clear the user.sqlite scope"

    def test_different_profiles_of_same_user_are_independent(self, tmp_path):
        """EPIC.md finding 4 corollary: even within one user, two profiles must
        not share pending state — a background sync of profile B must not be
        clearable/markable by an operation on profile A."""
        from app.database import clear_sync_pending, has_sync_pending_scope, mark_sync_pending

        with patch("app.database.USER_DATA_BASE", tmp_path):
            mark_sync_pending(USER, scope=PROFILE)
            mark_sync_pending(USER, scope=OTHER_PROFILE)

            clear_sync_pending(USER, scope=PROFILE)

            assert has_sync_pending_scope(USER, PROFILE) is False
            assert has_sync_pending_scope(USER, OTHER_PROFILE) is True

    def test_mark_and_clear_require_a_scope(self, tmp_path):
        """T5081 review round 3 (Q1): production has no legitimate reason to
        write a bare marker (both fly.toml files declare no [mounts], so
        USER_DATA_BASE is ephemeral and a marker from a prior deploy cannot
        survive into this one) — mark_sync_pending/clear_sync_pending now
        require an explicit scope, closing off the class of bug where a bare
        marker's meaning had to be guessed at read time (round 2's fix)."""
        from app.database import clear_sync_pending, mark_sync_pending

        with patch("app.database.USER_DATA_BASE", tmp_path):
            try:
                mark_sync_pending(USER, "")
                assert False, "expected ValueError for an empty scope"
            except ValueError:
                pass
            try:
                clear_sync_pending(USER, "")
                assert False, "expected ValueError for an empty scope"
            except ValueError:
                pass

    def test_clear_sync_pending_never_touches_the_legacy_bare_file(self, tmp_path):
        """T5081 review round 3 (Q1, reversing round 2's fix): clear_sync_pending
        must NOT sweep a legacy bare marker as a side effect of a scoped clear.
        Round 2 mirrored `.sync_conflict`'s opportunistic-legacy-sweep here,
        which is correct for ALARM state but wrong for a DURABILITY record: the
        first scope to succeed silently discarded whatever the bare marker
        might have ALSO meant for every OTHER scope (review round 2's own
        bug — see test_legacy_bare_marker_is_adopted_into_real_scopes for the
        correct handling, which is adoption at read time, not an opportunistic
        sweep at clear time)."""
        from app.database import clear_sync_pending, has_sync_pending

        with patch("app.database.USER_DATA_BASE", tmp_path):
            legacy = tmp_path / USER / ".sync_pending"
            legacy.parent.mkdir(parents=True, exist_ok=True)
            legacy.write_text("123.0")  # simulate a stray legacy marker
            assert has_sync_pending(USER) is True

            clear_sync_pending(USER, PROFILE)

            assert legacy.exists(), "a scoped clear must not touch the legacy bare file"
            assert has_sync_pending(USER) is True


# ---------------------------------------------------------------------------
# Integration: retry_pending_sync only touches a db that actually has
# something pending — the core regression fix.
# ---------------------------------------------------------------------------

class TestRetryPendingSyncScopedGate:

    def test_user_only_pending_does_not_reupload_untouched_profile(self, tmp_path):
        """The 2026-08-04 shape: only user.sqlite has a pending write. R2's
        profile.sqlite has independently moved ahead of our loaded baseline (a
        foreign heal, unrelated to this user's session). Pre-fix, retry_pending_sync
        re-attempted the profile upload anyway (unconditional file-exists check)
        and tripped a real CAS conflict against a copy with nothing to arbitrate.
        Post-fix, a db with nothing pending is never touched."""
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
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, marker="clean_profile")
            _make_user_db(tmp_path, marker="dirty_user")

            # profile.sqlite: loaded v3, R2 ALSO at v3 — nothing to arbitrate if
            # touched, but per T5081 it must not even be attempted.
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"P", 3)
            set_local_db_version(USER, PROFILE, 3)
            # Only user.sqlite is actually pending.
            _seed_r2(fake, _user_db_r2_key(USER), b"U_OLD", 5)
            set_local_user_db_version(USER, 5)
            mark_sync_pending(USER, scope=USER_DB_SCOPE)

            outcome = retry_pending_sync(USER, PROFILE)

            assert outcome is SyncResult.OK
            assert not has_sync_conflict(USER)
            prof_uploads = [c for c in fake.upload_calls if c[1].endswith("profile.sqlite")]
            assert prof_uploads == [], \
                "profile.sqlite has nothing pending and must not be re-uploaded"
            user_uploads = [c for c in fake.upload_calls if c[1].endswith("user.sqlite")]
            assert len(user_uploads) == 1, "the actually-pending user.sqlite must still sync"

    def test_profile_only_pending_does_not_reupload_untouched_user(self, tmp_path):
        """Symmetric case."""
        from app.database import (
            has_sync_conflict,
            mark_sync_pending,
            set_local_db_version,
            set_local_user_db_version,
        )
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import _user_db_r2_key, profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, marker="dirty_profile")
            _make_user_db(tmp_path, marker="clean_user")

            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"P_OLD", 2)
            set_local_db_version(USER, PROFILE, 2)
            mark_sync_pending(USER, scope=PROFILE)
            # user.sqlite: local matches R2 exactly — nothing pending.
            _seed_r2(fake, _user_db_r2_key(USER), b"U", 5)
            set_local_user_db_version(USER, 5)

            outcome = retry_pending_sync(USER, PROFILE)

            assert outcome is SyncResult.OK
            assert not has_sync_conflict(USER)
            user_uploads = [c for c in fake.upload_calls if c[1].endswith("user.sqlite")]
            assert user_uploads == [], \
                "user.sqlite has nothing pending and must not be re-uploaded"
            prof_uploads = [c for c in fake.upload_calls if c[1].endswith("profile.sqlite")]
            assert len(prof_uploads) == 1

    def test_neither_pending_uploads_nothing(self, tmp_path):
        """No pending marker on either scope: retry_pending_sync must be a no-op
        (both branches vacuously OK), even though both files exist on disk."""
        from app.database import set_local_db_version, set_local_user_db_version
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import _user_db_r2_key, profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path)
            _make_user_db(tmp_path)
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"P", 3)
            set_local_db_version(USER, PROFILE, 3)
            _seed_r2(fake, _user_db_r2_key(USER), b"U", 5)
            set_local_user_db_version(USER, 5)

            outcome = retry_pending_sync(USER, PROFILE)

            assert outcome is SyncResult.OK
            assert fake.upload_calls == []

    def test_retry_clears_only_the_scope_it_synced(self, tmp_path):
        """A successful retry of the profile scope must clear ONLY that scope's
        pending marker — a caller no longer needs to (and must not) blanket-clear.
        OTHER_PROFILE is not even in retry_pending_sync's candidate set
        (session_scopes is profile+user only, per review round 3's Q2 fix — see
        test_retry_does_not_drain_a_different_pending_profile) — its marker
        must survive untouched, which this also proves incidentally."""
        from app.database import (
            USER_DB_SCOPE,
            has_sync_pending_scope,
            mark_sync_pending,
            set_local_db_version,
            set_local_user_db_version,
        )
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import _user_db_r2_key, profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path)
            _make_user_db(tmp_path)
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"P", 3)
            set_local_db_version(USER, PROFILE, 3)
            mark_sync_pending(USER, scope=PROFILE)
            _seed_r2(fake, _user_db_r2_key(USER), b"U", 5)
            set_local_user_db_version(USER, 5)
            # A DIFFERENT profile's marker, but no db file for it exists locally —
            # nothing to sync, so it must stay pending (not silently dropped).
            mark_sync_pending(USER, scope=OTHER_PROFILE)

            outcome = retry_pending_sync(USER, PROFILE)

            assert outcome is SyncResult.OK
            assert has_sync_pending_scope(USER, PROFILE) is False
            assert has_sync_pending_scope(USER, USER_DB_SCOPE) is False
            assert has_sync_pending_scope(USER, OTHER_PROFILE) is True, \
                "a profile with no local db file has nothing to sync — its marker must survive"
            other_uploads = [c for c in fake.upload_calls if OTHER_PROFILE in c[1]]
            assert other_uploads == []

    def test_retry_does_not_drain_a_different_pending_profile(self, tmp_path):
        """T5081 review round 3 (Q2, reversing round 2's MAJOR-1 fix):
        retry_pending_sync must NOT touch a pending scope belonging to a
        DIFFERENT profile — folding a foreign profile's outcome into this
        function's return value poisoned the caller's own verdict (a session
        whose own write the in-band re-drain just healed could still report
        failure overall because of an unrelated stuck profile, and a foreign
        profile stuck in CONFLICT would make EVERY call return CONFLICT,
        permanently disabling in-band healing for this user). Cross-profile
        draining now happens via drain_pending_scopes directly (see
        test_drain_pending_scopes_handles_any_profile) or the background sweep,
        never folded into retry_pending_sync's own verdict."""
        from app.database import (
            has_sync_pending_scope,
            mark_sync_pending,
            set_local_db_version,
        )
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            # The CALLER's own profile has nothing pending.
            _make_profile_db(tmp_path, marker="clean_profile")
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"P", 3)
            set_local_db_version(USER, PROFILE, 3)

            # A DIFFERENT profile of this same user has real pending work — e.g.
            # a background export worker's sync failed there earlier.
            _make_profile_db(tmp_path, profile_id=OTHER_PROFILE, marker="dirty_other")
            _seed_r2(fake, profile_r2_key(USER, OTHER_PROFILE, "profile.sqlite"), b"OLD_OTHER", 7)
            set_local_db_version(USER, OTHER_PROFILE, 7)
            mark_sync_pending(USER, scope=OTHER_PROFILE)

            outcome = retry_pending_sync(USER, PROFILE)

            assert outcome is SyncResult.OK
            assert has_sync_pending_scope(USER, OTHER_PROFILE) is True, \
                "a different profile's marker must be untouched by retry_pending_sync"
            other_uploads = [c for c in fake.upload_calls if c[1].endswith(f"{OTHER_PROFILE}/profile.sqlite")]
            assert other_uploads == []

    def test_drain_pending_scopes_handles_any_profile(self, tmp_path):
        """T5081 review round 3 (Q2): the low-level drain_pending_scopes primitive
        (used by the foreign-scope sweep and /api/sync/flush-verify) can drain
        ANY profile's pending scope when explicitly asked, regardless of which
        profile a session is attached to — this is where MAJOR-1's cross-profile
        drain requirement is actually satisfied, just not inside
        retry_pending_sync's own verdict."""
        from app.database import has_sync_pending_scope, mark_sync_pending, set_local_db_version
        from app.middleware.db_sync import drain_pending_scopes
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path, profile_id=OTHER_PROFILE, marker="dirty_other")
            _seed_r2(fake, profile_r2_key(USER, OTHER_PROFILE, "profile.sqlite"), b"OLD_OTHER", 7)
            set_local_db_version(USER, OTHER_PROFILE, 7)
            mark_sync_pending(USER, scope=OTHER_PROFILE)

            report = drain_pending_scopes(USER, {OTHER_PROFILE})

            assert report.aggregate() is SyncResult.OK
            assert has_sync_pending_scope(USER, OTHER_PROFILE) is False
            other_uploads = [c for c in fake.upload_calls if c[1].endswith(f"{OTHER_PROFILE}/profile.sqlite")]
            assert len(other_uploads) == 1

    def test_legacy_bare_marker_is_adopted_into_real_scopes(self, tmp_path):
        """T5081 review round 3 (Q1): a stray legacy unscoped marker (should
        never happen in production — mark_sync_pending now requires a scope —
        but could exist from a bug or an old deploy) is ADOPTED into real
        per-scope markers for every db this user has locally, loudly (CRITICAL
        log), rather than being silently OR'd into has_sync_pending_scope's
        per-scope check (round 2's fix, which had its own bug: the first scope
        to succeed opportunistically swept the bare file via the shared
        conflict/failed _clear helper, silently dropping whatever the bare
        marker meant for every OTHER scope)."""
        from app.database import (
            USER_DB_SCOPE,
            has_sync_pending,
            has_sync_pending_scope,
            set_local_db_version,
        )
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _make_profile_db(tmp_path)
            _make_user_db(tmp_path)
            _seed_r2(fake, profile_r2_key(USER, PROFILE, "profile.sqlite"), b"P", 3)
            set_local_db_version(USER, PROFILE, 3)
            # Simulate a stray legacy marker directly on disk — mark_sync_pending
            # itself can no longer produce one (scope is required).
            (tmp_path / USER / ".sync_pending").parent.mkdir(parents=True, exist_ok=True)
            (tmp_path / USER / ".sync_pending").write_text("123.0")

            outcome = retry_pending_sync(USER, PROFILE)

            assert outcome is SyncResult.OK
            assert has_sync_pending_scope(USER, PROFILE) is False
            assert has_sync_pending_scope(USER, USER_DB_SCOPE) is False
            assert not has_sync_pending(USER), \
                "adoption must upgrade AND resolve every scope the bare marker could have meant"


# ---------------------------------------------------------------------------
# _background_sync's success-path clear must not stomp a foreign-profile
# marker for the same user (the T6390 self-stomp class, now closed for
# .sync_pending too).
# ---------------------------------------------------------------------------

class TestBackgroundSyncScopedClear:

    @pytest.fixture(autouse=True)
    def isolate(self, tmp_path, monkeypatch):
        import app.database as db_module
        from app.middleware import db_sync as db_sync_module
        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        monkeypatch.setattr(db_sync_module, "_USER_WRITE_LOCKS", {})
        monkeypatch.setattr(db_sync_module, "_SYNC_IN_PROGRESS", {})
        self.tmp_path = tmp_path

    def test_success_does_not_clear_a_different_profiles_pending_marker(self):
        """T5081 review round 3: the pending-clear now lives INSIDE
        sync_db_to_r2_explicit/sync_user_db_to_r2_explicit (INV-P clear reason
        a) — _background_sync itself clears nothing. Mocking those primitives
        away with a bare `return_value=True` bypasses that real clearing, so
        this drives them for real against FakeR2."""
        from app.database import (
            USER_DB_SCOPE,
            has_sync_pending_scope,
            mark_sync_pending,
            set_local_db_version,
            set_local_user_db_version,
        )
        from app.middleware.db_sync import RequestContextMiddleware, _begin_sync_attempt
        from app.storage import _user_db_r2_key, profile_r2_key

        _make_profile_db(self.tmp_path, marker="clean_profile")
        _make_user_db(self.tmp_path, marker="clean_user")
        mark_sync_pending(USER, scope=PROFILE)
        mark_sync_pending(USER, scope=USER_DB_SCOPE)
        # A background export worker's marker for a DIFFERENT profile of the
        # same user — must survive this session's own successful sync.
        mark_sync_pending(USER, scope=OTHER_PROFILE)
        _begin_sync_attempt(USER)
        middleware = RequestContextMiddleware(app=None)

        fake = FakeR2()
        with _r2_patched(fake):
            fake._objects[profile_r2_key(USER, PROFILE, "profile.sqlite")] = {
                "data": b"P", "metadata": {"db-version": "0"}}
            fake._objects[_user_db_r2_key(USER)] = {
                "data": b"U", "metadata": {"db-version": "0"}}
            set_local_db_version(USER, PROFILE, 0)
            set_local_user_db_version(USER, 0)

            async def runner():
                return await middleware._background_sync(
                    USER, PROFILE, "rid1", "POST", "/api/test",
                    had_writes=True, had_user_db_writes=True,
                    do_profile=False, force_profile=False,
                )

            status = asyncio.run(runner())

        assert status == "ok"
        assert has_sync_pending_scope(USER, PROFILE) is False
        assert has_sync_pending_scope(USER, OTHER_PROFILE) is True, \
            "a different profile's pending marker for this user must survive"


# ---------------------------------------------------------------------------
# INV-P compare-and-clear (T5081 review round 3, BLOCKING): an upload in
# flight must not discharge a marker a NEWER write re-stamped while it was
# uploading — otherwise a genuinely-outstanding write is reported as durably
# saved. Reproduces the exact race the reviewer found: request A's upload is
# slow (checkpoint+PUT commonly exceeds the 0.5s defer window); request B
# commits a newer write to the SAME scope while A is still in flight; A's
# eventual success must not silently discharge B's marker.
# ---------------------------------------------------------------------------

class TestCompareAndClearPreventsMarkerStomp:

    def test_clear_sync_pending_with_stale_token_is_a_noop(self, tmp_path):
        """Direct unit test of the primitive: clear_sync_pending(if_token=...)
        only fires when the marker's CURRENT content still matches the token
        captured before the upload started."""
        from app.database import clear_sync_pending, has_sync_pending_scope, mark_sync_pending, read_pending_token

        with patch("app.database.USER_DATA_BASE", tmp_path):
            token_a = mark_sync_pending(USER, PROFILE)
            captured = read_pending_token(USER, PROFILE)
            assert captured == token_a

            # A newer write lands WHILE the (simulated) upload is in flight —
            # re-marks the scope with a fresh token.
            token_b = mark_sync_pending(USER, PROFILE)

            # The in-flight upload's success now tries to clear using the
            # STALE token it captured before B's write — must be a no-op.
            clear_sync_pending(USER, PROFILE, if_token=captured)

            assert has_sync_pending_scope(USER, PROFILE) is True, \
                "a stale-token clear must not discharge a newer write's marker"
            # The CURRENT token can still legitimately clear it.
            clear_sync_pending(USER, PROFILE, if_token=token_b)
            assert has_sync_pending_scope(USER, PROFILE) is False

    def test_clear_sync_pending_without_if_token_is_unconditional(self, tmp_path):
        """INV-P reason (c) (clear_scope_markers, on local DB deletion) calls
        clear_sync_pending with NO if_token — deleting the scope's local DB
        invalidates any pending record for it regardless of when it was
        marked, since there is no local file left for an in-flight write to
        land in. Reasons (a) (upload) and (b) (restore) both REQUIRE
        if_token — see TestSwapSiteClearsPendingMarker for (b)."""
        from app.database import clear_sync_pending, has_sync_pending_scope, mark_sync_pending

        with patch("app.database.USER_DATA_BASE", tmp_path):
            mark_sync_pending(USER, PROFILE)
            clear_sync_pending(USER, PROFILE)
            assert has_sync_pending_scope(USER, PROFILE) is False

    def test_slow_upload_does_not_stomp_a_write_committed_during_it(self, tmp_path):
        """Integration reproduction: sync_db_to_r2_explicit's success must not
        discharge a .sync_pending marker that a DIFFERENT (newer) write
        re-stamped while this upload was in flight. Simulates the race by
        re-marking the scope from INSIDE the mocked upload primitive, between
        when sync_db_to_r2_explicit captures its token and when it clears."""
        from app.database import (
            has_sync_pending_scope,
            mark_sync_pending,
            set_local_db_version,
            sync_db_to_r2_explicit,
        )

        _make_profile_db(tmp_path, marker="v1")
        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            set_local_db_version(USER, PROFILE, 0)
            mark_sync_pending(USER, PROFILE)  # request A's write

            def _slow_upload_racing_a_newer_write(user_id, db_path, current_version, **kwargs):
                # Simulates request B committing + re-marking WHILE A's upload
                # (checkpoint+PUT) is in flight — the exact race window.
                mark_sync_pending(USER, PROFILE)
                return (True, (current_version or 0) + 1, None)

            with patch("app.database.sync_database_to_r2_with_version",
                       side_effect=_slow_upload_racing_a_newer_write):
                result = sync_db_to_r2_explicit(USER, PROFILE)

            assert bool(result) is True  # A's upload itself succeeded
            assert has_sync_pending_scope(USER, PROFILE) is True, \
                "B's newer write must still be recorded as pending — A's " \
                "success must not have silently discarded it"


# ---------------------------------------------------------------------------
# INV-P reason (b): the clear lives at the swap SITE, not at a caller.
#
# A CAS conflict schedules a reheal (schedule_profile_db_reheal /
# schedule_user_db_reheal null the cached version) but does NOT itself
# restore anything -- the restore happens on whichever request's
# ensure_database / ensure_user_database first-access branch fires NEXT,
# which is very often an ordinary read, not the conflict-retry endpoint. Two
# earlier designs tried to detect "did I just restore this scope" from the
# conflict-retry endpoint itself (a version-before/after comparison, then a
# `downloaded` boolean plumbed out of confirm_current_before_write) and both
# were wrong for the same reason: by the time the retry endpoint runs, an
# intervening ordinary request has usually already performed the actual
# restore. See the INV-P comment in database.py (round 6 review + expert
# design) for the full reasoning; these tests pin the resulting behavior.
# ---------------------------------------------------------------------------

class TestSwapSiteClearsPendingMarker:

    def test_ensure_database_clears_pending_marker_on_self_heal_repull(self, tmp_path):
        """Mirrors test_t6160_conflict_self_heal's self-heal repro, plus a
        .sync_pending marker: an ORDINARY ensure_database() call that happens
        to perform the post-conflict re-pull must discharge the marker, even
        though this call is not the conflict-retry endpoint at all — it's
        exactly the kind of request (a plain GET) that races ahead of Retry
        in production."""
        from app.database import (
            ensure_database,
            get_local_db_version,
            has_sync_pending_scope,
            mark_sync_pending,
            set_local_db_version,
        )
        from app.profile_context import set_current_profile_id
        from app.storage import profile_r2_key
        from app.user_context import set_current_user_id

        set_current_user_id(USER)
        set_current_profile_id(PROFILE)

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", set()), \
             _r2_patched(fake):
            _make_profile_db(tmp_path, marker="stale_local")
            mark_sync_pending(USER, PROFILE)  # the refused write's durability record

            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            fake._objects[key] = {
                "data": _make_profile_db(tmp_path / "_r2_seed", marker="newer_r2").read_bytes(),
                "metadata": {"db-version": "9"},
            }
            # A prior conflict already ran schedule_profile_db_reheal (nulls
            # the version) -- ensure_database's first-access branch fires on
            # THIS ordinary, unrelated call.
            set_local_db_version(USER, PROFILE, None)

            ensure_database()

            assert get_local_db_version(USER, PROFILE) == 9
            assert has_sync_pending_scope(USER, PROFILE) is False, \
                "the re-pull genuinely replaced local content with R2's copy " \
                "-- the refused write it recorded a marker for is now moot"

    def test_ensure_database_repull_does_not_stomp_a_write_committed_during_it(self, tmp_path):
        """Same shape as test_slow_upload_does_not_stomp_a_write_committed_
        during_it, mirrored for the DOWNLOAD side: a write landing on the
        SAME scope while the re-pull's R2 round trip is in flight must
        survive — the re-pull cannot know whether the marker it sees after
        completing describes the stale write it just discarded or a brand
        new one."""
        from app.database import (
            ensure_database,
            get_local_db_version,
            has_sync_pending_scope,
            mark_sync_pending,
            read_pending_token,
            set_local_db_version,
        )
        from app.profile_context import set_current_profile_id
        from app.storage import profile_r2_key
        from app.storage import sync_database_from_r2_if_newer as _real_restore
        from app.user_context import set_current_user_id

        set_current_user_id(USER)
        set_current_profile_id(PROFILE)

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", set()), \
             _r2_patched(fake):
            _make_profile_db(tmp_path, marker="stale_local")
            mark_sync_pending(USER, PROFILE)
            set_local_db_version(USER, PROFILE, None)

            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            fake._objects[key] = {
                "data": _make_profile_db(tmp_path / "_r2_seed", marker="newer_r2").read_bytes(),
                "metadata": {"db-version": "9"},
            }

            new_token = {}

            def _repull_racing_a_newer_write(user_id, db_path, current_version, before_download=None):
                result = _real_restore(user_id, db_path, current_version, before_download=before_download)
                # Simulates a DIFFERENT request committing + re-marking WHILE
                # this download was in flight — the exact race window.
                new_token["value"] = mark_sync_pending(USER, PROFILE)
                return result

            with patch("app.database.sync_database_from_r2_if_newer",
                       side_effect=_repull_racing_a_newer_write):
                ensure_database()

            assert get_local_db_version(USER, PROFILE) == 9, "the re-pull itself still succeeded"
            assert has_sync_pending_scope(USER, PROFILE) is True, \
                "the concurrent write's marker must survive the re-pull's clear"
            assert read_pending_token(USER, PROFILE) == new_token["value"], \
                "the surviving marker must be the concurrent write's own token"
