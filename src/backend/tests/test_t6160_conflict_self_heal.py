"""T6160 — a CAS conflict now self-heals, so recovery no longer needs a restart.

The dead-end (confirmed on staging 2026-07-27): ensure_database /
ensure_user_database restore from R2 on FIRST ACCESS only. Once a running machine
has a version cached, it never notices R2 moving ahead out-of-band, so every write
hits the T4310 upload-side CAS guard, is (correctly) refused, and the offered
Retry re-runs the same stale write forever. Only a process restart escaped it.

T6160 keeps the CAS refusal exactly as-is (it protects newer state) and adds the
missing RECOVERY: on a conflict, the loaded-from version is invalidated so the
NEXT request's first-access path re-pulls R2's newer copy. The refused in-flight
edit is DISCARDED by that re-pull (see T6160-design.md decision 2 — never merged,
never force-pushed).

Covers:
1. The trap that makes the naive one-liner insufficient: set_local_db_version(
   ..., None) alone does NOT self-heal because get_local_db_version resurrects the
   version from the persisted db_version row in the file.
2. profile.sqlite: a conflict invalidates the version (memory AND file row); the
   next ensure_database re-pulls R2's newer copy; a subsequent write then lands
   (recovery) instead of conflicting identically forever.
3. user.sqlite: same shape (decision 4) — conflict invalidates version + init
   flag so the next ensure_user_database re-pulls.
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.database import SyncResult
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER = "u_t6160"
PROFILE = "beef1234"


def _write_marker_db(path, marker):
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE IF NOT EXISTS marker (who TEXT)")
    conn.execute("DELETE FROM marker")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    # T5083: stamp a sentinel PRAGMA user_version far above any registered
    # migration so the JIT load-seam (now firing on every ensure_database/
    # ensure_user_database first access) treats this minimal marker-only
    # fixture as already-at-head and no-ops, instead of trying to run the
    # full migration history against a DB that never had the real base
    # schema (unrepresentative of any real production DB, which always gets
    # its base schema created before it can go below-head). This file's
    # tests are about INV-P/self-heal version-cache mechanics, not migration.
    conn.execute("PRAGMA user_version = 999999")
    conn.commit()
    # Checkpoint + close so the file is a self-contained snapshot (no sidecars)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    for suffix in ("-wal", "-shm"):
        p = path.parent / (path.name + suffix)
        if p.exists():
            p.unlink()


def _read_marker(path):
    conn = sqlite3.connect(str(path))
    try:
        row = conn.execute("SELECT who FROM marker").fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def _newer_r2_bytes(tmp_path, marker="newer_r2"):
    """Build a valid, self-contained sqlite snapshot to stand in as R2's newer copy."""
    src = tmp_path / "_r2_seed" / "profile.sqlite"
    _write_marker_db(src, marker)
    return src.read_bytes()


@pytest.fixture()
def ctx():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(USER)
    set_current_profile_id(PROFILE)
    yield


# ---------------------------------------------------------------------------
# 1. The trap: clearing only the in-memory cache does NOT self-heal.
# ---------------------------------------------------------------------------

def test_set_version_none_alone_is_resurrected_from_file(tmp_path):
    """set_local_db_version(..., None) pops only the in-memory cache; the
    persisted db_version row survives and get_local_db_version reads it back.
    This is WHY the self-heal must clear the file row too (design decision 1)."""
    from app.database import get_local_db_version, set_local_db_version

    with patch("app.database.USER_DATA_BASE", tmp_path):
        db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
        _write_marker_db(db_path, "local")
        set_local_db_version(USER, PROFILE, 3)  # writes db_version row into the file

        set_local_db_version(USER, PROFILE, None)  # pops memory only

        # The trap: the version is resurrected from the file's db_version row.
        assert get_local_db_version(USER, PROFILE) == 3


# ---------------------------------------------------------------------------
# 2. profile.sqlite conflict self-heals on the next request.
# ---------------------------------------------------------------------------

class TestProfileSelfHeal:

    def test_conflict_invalidates_then_next_access_repulls_and_write_lands(self, tmp_path, ctx):
        from app.database import (
            ensure_database,
            get_local_db_version,
            set_local_db_version,
            sync_db_to_r2_explicit,
        )
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", set()), \
             _r2_patched(fake):
            db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
            _write_marker_db(db_path, "stale_local")
            set_local_db_version(USER, PROFILE, 3)

            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            fake._objects[key] = {"data": _newer_r2_bytes(tmp_path), "metadata": {"db-version": "9"}}

            # (a) The write conflicts and is refused — CAS intact, R2 untouched.
            assert sync_db_to_r2_explicit(USER, PROFILE) is SyncResult.CONFLICT
            assert not any(c[1] == key for c in fake.upload_calls)
            assert _read_marker(db_path) == "stale_local"  # local edit still on disk (not yet re-pulled)

            # (b) SELF-HEAL: the conflict invalidated the loaded-from version
            #     (memory AND the persisted file row), so it now reads None.
            assert get_local_db_version(USER, PROFILE) is None

            # (c) The NEXT request's first-access path re-pulls R2's newer copy.
            ensure_database()
            assert any(c[1] == key for c in fake.download_calls), "next access must re-pull from R2"
            assert _read_marker(db_path) == "newer_r2", "re-pull discards the stale local edit (decision 2)"
            assert get_local_db_version(USER, PROFILE) == 9

            # (d) RECOVERY: a subsequent write now lands instead of conflicting
            #     forever. It applies on the CURRENT (re-pulled) base, so this is
            #     NOT the clobber CAS refused — it advances R2 to v10.
            _write_marker_db(db_path, "fresh_edit_on_current_base")
            set_local_db_version(USER, PROFILE, 9)  # keep the row in sync with the re-pulled file
            assert sync_db_to_r2_explicit(USER, PROFILE) is SyncResult.OK
            assert get_local_db_version(USER, PROFILE) == 10
            assert fake._objects[key]["metadata"]["db-version"] == "10"

    def test_retry_pending_sync_conflict_also_invalidates(self, tmp_path):
        """retry_pending_sync calls the lower-level primitive directly, so it
        needs the invalidation explicitly (not via sync_db_to_r2_explicit)."""
        from app.database import get_local_db_version, mark_sync_pending, set_local_db_version
        from app.middleware.db_sync import retry_pending_sync
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
            _write_marker_db(db_path, "stale_local")
            set_local_db_version(USER, PROFILE, 3)
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            fake._objects[key] = {"data": _newer_r2_bytes(tmp_path), "metadata": {"db-version": "9"}}
            # T5081: retry_pending_sync is now gated on the scoped pending marker.
            mark_sync_pending(USER, scope=PROFILE)

            # T6390: retry_pending_sync returns the aggregate SyncResult (CONFLICT),
            # still falsy so "not ok" callers are unaffected.
            from app.database import SyncResult
            assert retry_pending_sync(USER, PROFILE) is SyncResult.CONFLICT
            assert get_local_db_version(USER, PROFILE) is None  # invalidated for re-pull


# ---------------------------------------------------------------------------
# 3. user.sqlite conflict self-heals (decision 4).
# ---------------------------------------------------------------------------

class TestUserDbSelfHeal:

    def test_conflict_invalidates_version_and_init_flag(self, tmp_path):
        from app.database import (
            get_local_user_db_version,
            set_local_user_db_version,
            sync_user_db_to_r2_explicit,
        )
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        # user_db.py keeps its OWN USER_DATA_BASE (separate from database's), so
        # both must be patched or ensure_user_database resolves the real dir.
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             _r2_patched(fake):
            import app.services.user_db as user_db_mod
            db_path = tmp_path / USER / "user.sqlite"
            _write_marker_db(db_path, "stale_user")
            set_local_user_db_version(USER, 2)
            with user_db_mod._init_lock:
                user_db_mod._initialized_user_dbs.add(USER)

            key = _user_db_r2_key(USER)
            fake._objects[key] = {"data": _newer_r2_bytes(tmp_path, "newer_user"), "metadata": {"db-version": "7"}}

            assert sync_user_db_to_r2_explicit(USER) is SyncResult.CONFLICT
            # Self-heal: version cleared AND the init flag dropped so the next
            # ensure_user_database re-pulls (it early-returns on the flag).
            assert get_local_user_db_version(USER) is None
            with user_db_mod._init_lock:
                assert USER not in user_db_mod._initialized_user_dbs

            # The next ensure_user_database re-pulls R2's newer copy (recovery).
            from app.user_context import set_current_user_id
            set_current_user_id(USER)
            user_db_mod.ensure_user_database(USER)
            assert any(c[1] == key for c in fake.download_calls), "next access must re-pull user.sqlite"
            assert _read_marker(db_path) == "newer_user", "re-pull discards the stale local edit (decision 2)"
            assert get_local_user_db_version(USER) == 7
