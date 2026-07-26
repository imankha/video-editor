"""
T4315 — Restore-on-staleness: the local copy is no longer authoritative
forever. Sibling of T4310 (upload-side CAS, test_t4310_r2_cas_conflict.py):
CAS refuses a stale UPLOAD; this task's confirm_current_before_write
(app/services/db_refresh.py) refuses a stale WRITE by pulling R2's newer
copy first, or raising RefreshFailed when R2 can't be confirmed -- never
silently building on (and then force-pushing) an unconfirmed snapshot.

Covers:
1. user.sqlite write path: R2 newer than local -> restore happens BEFORE
   the caller can mutate it (ensure_user_database_fresh).
2. R2 restore error -> the writer refuses loudly (RefreshFailed); the local
   file is left untouched, never a silent empty-DB/no-op that lets a caller
   write on an unconfirmed copy.
3. Machine-swap simulation (fresh volume, no local file, no cached version)
   -> current R2 data is served, so a committed write survives the swap.
4. confirm_current_before_write dispatches user.sqlite (profile_id=None) vs
   profile.sqlite (profile_id given) to the right underlying primitive.
5. require_fresh generalization: not just move_reels (test_move_reels_
   stale_target.py) -- materialize_game_share's recipient resolution (a
   raw, R2-oblivious _open_profile_db read reused for a WRITE) must also
   refuse on an unconfirmed copy.
6. WAL safety: a restore-if-newer download clears stale -wal/-shm sidecars
   left over from the file it replaced (the hazard T4310 dropped its own
   post-conflict re-download over -- see storage.py's conflict branch).
"""

import sqlite3
from unittest.mock import MagicMock, patch

import pytest

from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER = "u_t4315"
OTHER_USER = "u_t4315_other"
PROFILE = "abcd1234"


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


def _make_profile_db(base, user_id, profile_id, marker="v0"):
    d = base / user_id / "profiles" / profile_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "profile.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    conn.commit()
    conn.close()
    return p


def _read_marker(path):
    conn = sqlite3.connect(str(path))
    row = conn.execute("SELECT who FROM marker").fetchone()
    conn.close()
    return row[0] if row else None


@pytest.fixture(autouse=True)
def _isolate_caches(monkeypatch):
    """Clean in-process caches per test -- these module-level dicts persist
    across tests otherwise (same pattern as test_r2_restore_retry.py)."""
    import app.database as db_module
    import app.services.user_db as user_db_module

    monkeypatch.setattr(user_db_module, "_initialized_user_dbs", set())
    monkeypatch.setattr(user_db_module, "_r2_user_restore_cooldowns", {})
    monkeypatch.setattr(db_module, "_user_sqlite_versions", {})
    monkeypatch.setattr(db_module, "_user_db_versions", {})


# ---------------------------------------------------------------------------
# 1-3. user.sqlite write-path restore-if-newer
# ---------------------------------------------------------------------------

class TestUserDbWritePathRestoreIfNewer:

    def test_r2_newer_restores_before_write(self, tmp_path):
        """A machine holding a stale local user.sqlite must pull R2's newer
        copy when a WRITE path confirms freshness -- this is what makes an
        out-of-band R2 edit (or a write that landed on another machine)
        visible instead of being silently reverted on the next write."""
        from app.database import get_local_user_db_version, set_local_user_db_version
        from app.services.user_db import ensure_user_database_fresh
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            local_path = _make_user_db(tmp_path, marker="stale_local")

            newer_path = tmp_path / "newer_user.sqlite"
            conn = sqlite3.connect(str(newer_path))
            conn.execute("CREATE TABLE marker (who TEXT)")
            conn.execute("INSERT INTO marker (who) VALUES ('r2_newer')")
            conn.commit()
            conn.close()
            key = _user_db_r2_key(USER)
            fake._objects[key] = {"data": newer_path.read_bytes(), "metadata": {"db-version": "5"}}

            # This machine last saw v2 (not None) -- ensure_user_database's
            # own first-access gate is a no-op here; only the NEW write-path
            # check below should perform the pull.
            set_local_user_db_version(USER, 2)

            ensure_user_database_fresh(USER)

            assert _read_marker(local_path) == "r2_newer", \
                "write path must pull R2's newer copy before the caller mutates it"
            assert get_local_user_db_version(USER) == 5

    def test_r2_error_raises_refresh_failed_no_silent_write(self, tmp_path):
        """R2 unreachable -> the writer must refuse loudly, never proceed on
        an unconfirmed copy (never a silent no-op that lets the caller mutate
        stale data, and never a force-created empty DB)."""
        from app.database import get_local_user_db_version, set_local_user_db_version
        from app.services.db_refresh import RefreshFailed
        from app.services.user_db import ensure_user_database_fresh

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch("app.storage.R2_ENABLED", True), \
             patch("app.storage.sync_user_db_from_r2_if_newer", return_value=(False, None, True)):
            _make_user_db(tmp_path, marker="local_v2")
            set_local_user_db_version(USER, 2)

            with pytest.raises(RefreshFailed):
                ensure_user_database_fresh(USER)

            assert _read_marker(tmp_path / USER / "user.sqlite") == "local_v2", \
                "local file must be untouched when freshness cannot be confirmed"
            assert get_local_user_db_version(USER) == 2, \
                "version cache must stay frozen at the last confirmed value, never bumped on a refusal"

    def test_machine_swap_fresh_volume_serves_current_r2_data(self, tmp_path):
        """A brand-new machine (no local file, no cached version) must serve
        R2's CURRENT data -- a committed write (e.g. an admin credit grant)
        must survive a machine replacement. Exercises the public
        confirm_current_before_write(profile_id=None) entry point end to end."""
        from app.database import get_local_user_db_version
        from app.services.db_refresh import confirm_current_before_write
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            seed_path = tmp_path / "seed_user.sqlite"
            conn = sqlite3.connect(str(seed_path))
            conn.execute("CREATE TABLE marker (who TEXT)")
            conn.execute("INSERT INTO marker (who) VALUES ('committed_grant')")
            conn.commit()
            conn.close()
            key = _user_db_r2_key(USER)
            fake._objects[key] = {"data": seed_path.read_bytes(), "metadata": {"db-version": "9"}}

            confirm_current_before_write(USER)

            local_path = tmp_path / USER / "user.sqlite"
            assert _read_marker(local_path) == "committed_grant"
            assert get_local_user_db_version(USER) == 9


# ---------------------------------------------------------------------------
# 4. confirm_current_before_write dispatch
# ---------------------------------------------------------------------------

class TestConfirmCurrentBeforeWriteDispatch:

    def test_profile_id_none_dispatches_to_user_db(self, monkeypatch):
        from app.services import db_refresh

        called = []
        monkeypatch.setattr(
            "app.services.user_db.ensure_user_database_fresh",
            lambda uid: called.append(("user", uid)),
        )
        db_refresh.confirm_current_before_write(USER)
        assert called == [("user", USER)]

    def test_profile_id_given_dispatches_to_profile_db(self, monkeypatch):
        from app.services import db_refresh

        called = []
        monkeypatch.setattr(
            "app.services.materialization.ensure_profile_db_local",
            lambda uid, pid, require_fresh=False: called.append((uid, pid, require_fresh)),
        )
        db_refresh.confirm_current_before_write(USER, PROFILE)
        assert called == [(USER, PROFILE, True)]


# ---------------------------------------------------------------------------
# 5. require_fresh generalization beyond move_reels
# ---------------------------------------------------------------------------

class TestMaterializeGameShareRequiresFresh:
    """require_fresh is now the shared rule, not a move_reels-only guard
    (test_move_reels_stale_target.py already covers move_reels itself)."""

    def test_recipient_r2_error_aborts_instead_of_writing_stale(self, tmp_path):
        """materialize_game_share's recipient_conn used to come straight from
        the raw, R2-oblivious _open_profile_db -- a WRITE (it inserts games/
        clips and commits) with zero freshness confirmation. It must now
        refuse instead of materializing a share on top of an unconfirmed
        recipient snapshot."""
        from app.database import get_local_db_version
        from app.services.materialization import ProfileDBRefreshFailed, materialize_game_share

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.storage.sync_database_from_r2_if_newer", return_value=(False, None, True)):
            _make_profile_db(tmp_path, USER, PROFILE, marker="sharer")
            recipient_profile = "ffff0000"
            _make_profile_db(tmp_path, OTHER_USER, recipient_profile, marker="stale_recipient")

            with pytest.raises(ProfileDBRefreshFailed):
                materialize_game_share(
                    sharer_user_id=USER,
                    sharer_profile_id=PROFILE,
                    recipient_user_id=OTHER_USER,
                    recipient_profile_id=recipient_profile,
                    game_id=1,
                    tag_name="tag",
                    share_id=1,
                    clip_data=[],
                )

            # Recipient DB must be untouched -- no rows written on an
            # unconfirmed copy.
            recipient_path = tmp_path / OTHER_USER / "profiles" / recipient_profile / "profile.sqlite"
            conn = sqlite3.connect(str(recipient_path))
            count = conn.execute("SELECT COUNT(*) FROM marker").fetchone()[0]
            conn.close()
            assert count == 1
            assert get_local_db_version(OTHER_USER, recipient_profile) is None, \
                "version cache must not be bumped when the download never happened"


# ---------------------------------------------------------------------------
# 6. WAL safety on restore
# ---------------------------------------------------------------------------

class TestWalSafetyOnRestore:
    """T4310 dropped its post-conflict re-download specifically because
    swapping profile.sqlite/user.sqlite's main file while a stale -wal from
    the OLD content sits beside it lets a later connection replay unrelated
    frames onto the new file (cross-DB page mixing). T4315's restore-if-
    newer must not reintroduce that hazard.

    T4315 round 2 (MAJOR-3): SQLite deletes -wal/-shm when the LAST
    connection to the database closes cleanly -- ensure_user_database's own
    schema-apply open/close cycle (which runs first, inside
    ensure_user_database_fresh) already clears ordinary leftover sidecars by
    itself, so "write garbage bytes to -wal/-shm with no connection open"
    does NOT exercise the hazard this class is named for (verified below).
    The only way sidecars genuinely survive to the restore's own pre-check
    is a connection ACTUALLY open concurrently -- that is the scenario that
    must refuse, not silently swap.
    """

    def test_ordinary_leftover_sidecars_do_not_block_restore(self, tmp_path):
        """No connection open -> ensure_user_database's own open/close cycle
        naturally clears plain leftover sidecars before the write-path check
        even runs, so the restore proceeds and picks up R2's newer content."""
        from app.database import set_local_user_db_version
        from app.services.user_db import ensure_user_database_fresh
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            local_path = _make_user_db(tmp_path, marker="old_content")
            wal_path = local_path.parent / "user.sqlite-wal"
            shm_path = local_path.parent / "user.sqlite-shm"
            wal_path.write_bytes(b"stale wal frames from old content")
            shm_path.write_bytes(b"stale shm index")

            newer_path = tmp_path / "newer_user.sqlite"
            conn = sqlite3.connect(str(newer_path))
            conn.execute("CREATE TABLE marker (who TEXT)")
            conn.execute("INSERT INTO marker (who) VALUES ('r2_newer')")
            conn.commit()
            conn.close()
            key = _user_db_r2_key(USER)
            fake._objects[key] = {"data": newer_path.read_bytes(), "metadata": {"db-version": "3"}}

            set_local_user_db_version(USER, 1)

            ensure_user_database_fresh(USER)

            assert not wal_path.exists()
            assert not shm_path.exists()
            assert _read_marker(local_path) == "r2_newer"

    def test_refuses_swap_when_a_connection_is_genuinely_open(self, tmp_path):
        """The real hazard: another connection is concurrently open on this
        exact user.sqlite (e.g. the user's own active session while an admin
        grant's confirm_current_before_write runs on another thread). The
        restore must refuse instead of swapping the main file out from under
        it -- silently discarding that connection's committed-but-not-yet-
        uploaded work."""
        from app.database import set_local_user_db_version
        from app.services.db_refresh import RefreshFailed
        from app.services.user_db import ensure_user_database_fresh
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            local_path = _make_user_db(tmp_path, marker="old_content")

            # A genuinely open connection in WAL mode is what keeps the
            # sidecars alive across ensure_user_database's own open/close.
            live_conn = sqlite3.connect(str(local_path), timeout=30)
            live_conn.execute("PRAGMA journal_mode=WAL")
            live_conn.execute("INSERT INTO marker (who) VALUES ('committed_by_other_writer')")
            live_conn.commit()

            newer_path = tmp_path / "newer_user.sqlite"
            conn = sqlite3.connect(str(newer_path))
            conn.execute("CREATE TABLE marker (who TEXT)")
            conn.execute("INSERT INTO marker (who) VALUES ('r2_newer')")
            conn.commit()
            conn.close()
            key = _user_db_r2_key(USER)
            fake._objects[key] = {"data": newer_path.read_bytes(), "metadata": {"db-version": "3"}}

            set_local_user_db_version(USER, 1)

            try:
                with pytest.raises(RefreshFailed):
                    ensure_user_database_fresh(USER)

                assert not fake.download_calls, \
                    "must not download/swap while a connection is open on this file"
            finally:
                live_conn.close()

    def test_clear_stale_wal_sidecars_is_a_noop_when_absent(self, tmp_path):
        """The common case (no sidecars present) must not raise."""
        from app.services.db_refresh import clear_stale_wal_sidecars

        clear_stale_wal_sidecars(tmp_path / "does_not_exist.sqlite")


# ---------------------------------------------------------------------------
# MAJOR-4: structural refresh-or-fail for the foreign-user case, not a
# per-caller guard -- get_user_db_connection(other_user) must confirm even
# if the caller forgot to call confirm_current_before_write itself.
# ---------------------------------------------------------------------------

class TestGetUserDbConnectionStructuralGuard:

    def test_foreign_user_id_triggers_confirm_when_not_recently_confirmed(self, monkeypatch):
        from app.services import user_db as user_db_module
        from app.user_context import set_current_user_id

        set_current_user_id("session-user")
        calls = []
        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write",
            lambda uid, profile_id=None: calls.append(uid),
        )
        monkeypatch.setattr(
            "app.services.db_refresh.user_db_was_recently_confirmed",
            lambda uid: False,
        )
        monkeypatch.setattr(user_db_module, "ensure_user_database", lambda uid: None)
        monkeypatch.setattr(user_db_module, "_get_user_db_path", lambda uid: __import__("pathlib").Path("/dev/null"))
        monkeypatch.setattr("app.database.TrackedConnection", lambda *a, **k: MagicMock())
        monkeypatch.setattr(user_db_module.sqlite3, "connect", lambda *a, **k: MagicMock())

        with user_db_module.get_user_db_connection("other-user"):
            pass

        assert calls == ["other-user"], \
            "a foreign user_id (differs from the ambient session) must confirm freshness"

    def test_foreign_user_id_skips_redundant_confirm_when_recently_confirmed(self, monkeypatch):
        """A caller that already called confirm_current_before_write itself
        (admin.py, payments.py) moments ago must not pay a second HEAD."""
        from app.services import user_db as user_db_module
        from app.user_context import set_current_user_id

        set_current_user_id("session-user")
        confirm_calls = []
        ensure_calls = []
        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write",
            lambda uid, profile_id=None: confirm_calls.append(uid),
        )
        monkeypatch.setattr(
            "app.services.db_refresh.user_db_was_recently_confirmed",
            lambda uid: True,
        )
        monkeypatch.setattr(
            user_db_module, "ensure_user_database", lambda uid: ensure_calls.append(uid)
        )
        monkeypatch.setattr(user_db_module, "_get_user_db_path", lambda uid: __import__("pathlib").Path("/dev/null"))
        monkeypatch.setattr("app.database.TrackedConnection", lambda *a, **k: MagicMock())
        monkeypatch.setattr(user_db_module.sqlite3, "connect", lambda *a, **k: MagicMock())

        with user_db_module.get_user_db_connection("other-user"):
            pass

        assert confirm_calls == [], "must not re-confirm a user just confirmed on this call chain"
        assert ensure_calls == ["other-user"]

    def test_same_session_user_stays_lenient(self, monkeypatch):
        """The ambient session's own user_id (explicit or defaulted) must
        never pay the foreign-user confirm -- this is the hot/lenient path."""
        from app.services import user_db as user_db_module
        from app.user_context import set_current_user_id

        set_current_user_id("session-user")
        confirm_calls = []
        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write",
            lambda uid, profile_id=None: confirm_calls.append(uid),
        )
        monkeypatch.setattr(user_db_module, "ensure_user_database", lambda uid: None)
        monkeypatch.setattr(user_db_module, "_get_user_db_path", lambda uid: __import__("pathlib").Path("/dev/null"))
        monkeypatch.setattr("app.database.TrackedConnection", lambda *a, **k: MagicMock())
        monkeypatch.setattr(user_db_module.sqlite3, "connect", lambda *a, **k: MagicMock())

        with user_db_module.get_user_db_connection("session-user"):
            pass

        assert confirm_calls == []

    def test_no_session_context_falls_back_to_lenient(self, monkeypatch):
        """Background workers (no request/session context) must not be
        treated as a foreign-write case -- get_current_user_id() raises
        RuntimeError there, and the existing lenient behavior is preserved."""
        from app.services import user_db as user_db_module

        def _raise():
            raise RuntimeError("no user context set")

        # get_user_db_connection does a deferred `from ..user_context import
        # get_current_user_id` inside the function body -- patch it at the
        # source module so that fresh import picks up the fake.
        monkeypatch.setattr("app.user_context.get_current_user_id", _raise)
        confirm_calls = []
        monkeypatch.setattr(
            "app.services.db_refresh.confirm_current_before_write",
            lambda uid, profile_id=None: confirm_calls.append(uid),
        )
        monkeypatch.setattr(user_db_module, "ensure_user_database", lambda uid: None)
        monkeypatch.setattr(user_db_module, "_get_user_db_path", lambda uid: __import__("pathlib").Path("/dev/null"))
        monkeypatch.setattr("app.database.TrackedConnection", lambda *a, **k: MagicMock())
        monkeypatch.setattr(user_db_module.sqlite3, "connect", lambda *a, **k: MagicMock())

        with user_db_module.get_user_db_connection("worker-target-user"):
            pass

        assert confirm_calls == [], "no session context must fall back to the existing lenient path"


# ---------------------------------------------------------------------------
# BLOCKING-2: current_version is None (e.g. a fresh machine whose first-
# access R2 restore errored and ensure_user_database created an empty
# schema'd DB anyway) must never force-push over real R2 content.
# ---------------------------------------------------------------------------

class TestEmptyDbAfterR2ErrorNeverForcePushed:

    def test_first_access_r2_error_then_write_refuses_to_clobber_real_data(self, tmp_path):
        """End-to-end: ensure_user_database's EXISTING (unchanged, lenient)
        first-access behavior creates an empty local user.sqlite when R2
        errors on a brand-new machine -- that part is by design (reads must
        stay lenient) and out of this task's scope to change. What T4315
        must guarantee is that the SUBSEQUENT upload attempt, now armed with
        an unconfirmed (None) baseline, refuses instead of silently pushing
        the empty DB over the user's real credits/profiles/quests in R2."""
        from app.database import get_local_user_db_version, sync_user_db_to_r2_explicit
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), _r2_patched(fake), \
             patch("app.storage.sync_user_db_from_r2_if_newer", return_value=(False, None, True)):
            # Real R2 content this user actually has (never seen by this
            # fresh machine, since its restore attempt below fails).
            real_path = tmp_path / "real_user.sqlite"
            conn = sqlite3.connect(str(real_path))
            conn.execute("CREATE TABLE marker (who TEXT)")
            conn.execute("INSERT INTO marker (who) VALUES ('real_400_credits')")
            conn.commit()
            conn.close()
            key = _user_db_r2_key(USER)
            fake._objects[key] = {"data": real_path.read_bytes(), "metadata": {"db-version": "12"}}

            from app.services.user_db import ensure_user_database
            ensure_user_database(USER)  # first access, R2 HEAD errors (mocked above)

            assert get_local_user_db_version(USER) is None, \
                "an R2 error on first access must not lock in a fabricated version"

            result = sync_user_db_to_r2_explicit(USER)

        assert not result, "an unconfirmed (None) baseline must never upload over real R2 content"
        assert fake._objects[key]["data"] == real_path.read_bytes(), \
            "the user's real R2 data must survive untouched"
        assert fake._objects[key]["metadata"]["db-version"] == "12"
