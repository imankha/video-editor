"""T6770: game_storage_refs is now the LIVE derived ref-set that replaces the
hand-maintained game_ref_counts counter -- ref_count = COUNT(*) over real rows,
so it cannot independently drift from the per-profile game_storage source of
truth (the bug that lost imankh games 2/3/5, and the class of bug behind both
the 2026-08-11 missing-row and 2026-08-24 dead-table findings).

Covers:
  - v025 (postgres): clears the dead pre-T2930 sediment out of game_storage_refs
  - v047 (profile_db): backfills game_storage_refs from this profile's real
    game_storage rows, idempotently
  - the account-deletion FK must-fix (R1): _purge_user_data now clears the
    user's game_storage_refs rows before the caller's DELETE FROM users
  - the derived-set invariant itself: ref_count can never disagree with real
    rows across arbitrary insert/delete/double-delete sequences, because there
    is no stored integer to disagree
"""

import sqlite3
import sys
import types
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

# Prevent cv2 import failure when app.services.__init__ loads image_extractor
if "cv2" not in sys.modules:
    sys.modules["cv2"] = types.ModuleType("cv2")

from app.migrations.postgres.v025_clear_stale_game_storage_refs import (
    V025ClearStaleGameStorageRefs,
)
from app.migrations.profile_db.v047_backfill_game_storage_refs import (
    V047BackfillGameStorageRefs,
)
from app.services import auth_db


def _future(days=30):
    return (datetime.now(UTC) + timedelta(days=days)).isoformat()


def _refset_rows(blake3_hash=None):
    with auth_db.get_pg() as conn:
        cur = conn.cursor()
        if blake3_hash:
            cur.execute(
                "SELECT * FROM game_storage_refs WHERE blake3_hash = %s ORDER BY user_id",
                (blake3_hash,),
            )
        else:
            cur.execute("SELECT * FROM game_storage_refs")
        return cur.fetchall()


# ---------------------------------------------------------------------------
# v025: clear stale pre-T2930 game_storage_refs sediment
# ---------------------------------------------------------------------------

class TestV025ClearStaleGameStorageRefs:
    def test_clears_existing_rows(self, pg_conn):
        from app.services.auth_db import create_user, get_pg

        create_user("user-1", email="user1@example.com")
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO game_storage_refs
                       (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
                   VALUES (%s, %s, %s, %s, %s)""",
                ("user-1", "prof-1", "stale_hash", 1000, _future()),
            )

        assert len(_refset_rows("stale_hash")) == 1

        with get_pg() as conn:
            V025ClearStaleGameStorageRefs().up(conn)

        assert _refset_rows("stale_hash") == []

    def test_noop_on_empty_table(self, pg_conn):
        from app.services.auth_db import get_pg

        with get_pg() as conn:
            V025ClearStaleGameStorageRefs().up(conn)  # must not raise


# ---------------------------------------------------------------------------
# v047: backfill game_storage_refs from this profile's game_storage rows
# ---------------------------------------------------------------------------

class TestV047BackfillGameStorageRefs:
    # Must be in conftest.py's _TEST_USER_IDS so pg_conn cleans it up between tests.
    USER_ID = "user-1"
    PROFILE_ID = "prof-backfill"

    @pytest.fixture
    def profile_env(self, tmp_path, pg_conn):
        from app.profile_context import set_current_profile_id
        from app.services.auth_db import create_user
        from app.user_context import set_current_user_id

        create_user(self.USER_ID, email="t6770-backfill@example.com")
        set_current_user_id(self.USER_ID)
        set_current_profile_id(self.PROFILE_ID)

        db_dir = tmp_path / self.USER_ID / "profiles" / self.PROFILE_ID
        db_dir.mkdir(parents=True)
        db_path = db_dir / "profile.sqlite"

        conn = sqlite3.connect(str(db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE game_storage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blake3_hash TEXT NOT NULL UNIQUE,
                game_size_bytes INTEGER NOT NULL,
                storage_expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
        conn.close()

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", {self.USER_ID}), \
             patch("app.database.R2_ENABLED", False):
            yield {"db_path": db_path, "tmp_path": tmp_path}

    def _insert_game_storage_row(self, db_path, blake3_hash, size, expires):
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) "
            "VALUES (?, ?, ?)",
            (blake3_hash, size, expires),
        )
        conn.commit()
        conn.close()

    def _run_up(self, db_path):
        # Migration-runner-style connection: bare sqlite3.connect, tuple row
        # factory (memory: v017 rowfactory bug bit prod when this was string-
        # indexed instead of positional).
        conn = sqlite3.connect(str(db_path))
        try:
            V047BackfillGameStorageRefs().up(conn)
            conn.commit()
        finally:
            conn.close()

    def test_backfills_pg_row_for_each_game_storage_row(self, profile_env):
        db_path = profile_env["db_path"]
        f1, f2 = _future(30), _future(60)
        self._insert_game_storage_row(db_path, "hash_a", 1000, f1)
        self._insert_game_storage_row(db_path, "hash_b", 2000, f2)

        self._run_up(db_path)

        rows_a = _refset_rows("hash_a")
        rows_b = _refset_rows("hash_b")
        assert len(rows_a) == 1
        assert len(rows_b) == 1
        assert rows_a[0]["user_id"] == self.USER_ID
        assert rows_a[0]["profile_id"] == self.PROFILE_ID
        assert rows_a[0]["game_size_bytes"] == 1000

    def test_idempotent_second_run(self, profile_env):
        db_path = profile_env["db_path"]
        self._insert_game_storage_row(db_path, "hash_a", 1000, _future(30))

        self._run_up(db_path)
        self._run_up(db_path)  # re-run: must not create a second row

        assert len(_refset_rows("hash_a")) == 1

    def test_noop_on_empty_game_storage(self, profile_env):
        self._run_up(profile_env["db_path"])  # no rows -> must not raise

    def test_noop_when_table_missing(self, tmp_path, pg_conn):
        """A profile DB below v002 has no game_storage table at all."""
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(self.USER_ID)
        set_current_profile_id(self.PROFILE_ID)
        db_dir = tmp_path / self.USER_ID / "profiles" / self.PROFILE_ID
        db_dir.mkdir(parents=True)
        db_path = db_dir / "profile.sqlite"
        sqlite3.connect(str(db_path)).close()  # empty DB, no tables

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database.R2_ENABLED", False):
            self._run_up(db_path)  # must not raise


# ---------------------------------------------------------------------------
# R1 must-fix: account deletion must clear game_storage_refs before the
# caller's DELETE FROM users (no-cascade FK), now that the table is LIVE.
# ---------------------------------------------------------------------------

class TestPurgeUserDataClearsGameStorageRefs:
    def test_purge_deletes_the_users_ref_rows(self, tmp_path, monkeypatch, pg_conn):
        from app.routers.auth import _purge_user_data
        from app.services.auth_db import create_user, get_pg

        monkeypatch.setattr("app.database.USER_DATA_BASE", tmp_path)
        monkeypatch.setattr("app.database.R2_ENABLED", False)
        monkeypatch.setattr("app.routers.auth.USER_DATA_BASE", tmp_path)
        monkeypatch.setattr("app.routers.auth.R2_ENABLED", False)

        # Not in conftest.py's _TEST_USER_IDS -> pg_conn won't auto-clean this
        # row, so guarantee removal ourselves even if an assertion fails.
        user_id = "t6770-purge-user"
        try:
            create_user(user_id, email="t6770-purge@example.com")
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO game_storage_refs
                           (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (user_id, "prof-1", "hash_owned", 1000, _future()),
                )
            assert len(_refset_rows("hash_owned")) == 1

            _purge_user_data(user_id)

            assert _refset_rows("hash_owned") == []

            # The regression this guards against: DELETE FROM users must succeed
            # afterward (game_storage_refs.user_id -> users has NO ON DELETE
            # CASCADE) now that the table is live, not the dead pre-T2930 table.
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))  # must not raise
        finally:
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM game_storage_refs WHERE user_id = %s", (user_id,))
                cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))


# ---------------------------------------------------------------------------
# The derived-set invariant itself: ref_count can never disagree with real
# rows, because it is COUNT(*), not a stored integer.
# ---------------------------------------------------------------------------

class TestDerivedRefSetInvariant:
    @pytest.fixture(autouse=True)
    def _isolated(self, tmp_path, pg_conn):
        from app.profile_context import set_current_profile_id
        from app.services.auth_db import create_user
        from app.user_context import set_current_user_id

        create_user("user-1", email="user1@example.com")
        create_user("user-2", email="user2@example.com")

        for uid, pid in (("user-1", "prof-1"), ("user-2", "prof-2")):
            set_current_user_id(uid)
            set_current_profile_id(pid)
            db_dir = tmp_path / uid / "profiles" / pid
            db_dir.mkdir(parents=True)
            conn = sqlite3.connect(str(db_dir / "profile.sqlite"))
            conn.execute("""
                CREATE TABLE game_storage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    blake3_hash TEXT NOT NULL UNIQUE,
                    game_size_bytes INTEGER NOT NULL,
                    storage_expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            conn.commit()
            conn.close()

        set_current_user_id("user-1")
        set_current_profile_id("prof-1")

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", {"user-1", "user-2"}), \
             patch("app.database.R2_ENABLED", False):
            yield

    def test_arbitrary_insert_delete_sequence_matches_true_count(self):
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        future = _future()

        # user-1/prof-1 and user-2/prof-2 both reference hash_a.
        set_current_user_id("user-1")
        set_current_profile_id("prof-1")
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)
        set_current_user_id("user-2")
        set_current_profile_id("prof-2")
        auth_db.insert_game_storage_ref("user-2", "prof-2", "hash_a", 1000, future)
        assert len(_refset_rows("hash_a")) == 2
        assert auth_db.has_remaining_refs("hash_a") is True

        # Double-delete user-2's ref: no-op the second time, never undercounts.
        auth_db.delete_ref("user-2", "prof-2", "hash_a")
        auth_db.delete_ref("user-2", "prof-2", "hash_a")
        assert len(_refset_rows("hash_a")) == 1
        assert auth_db.has_remaining_refs("hash_a") is True

        # Re-inserting user-2's ref (a re-activation) restores the row --
        # this is the exact self-heal the old is_new-gated write couldn't do.
        auth_db.insert_game_storage_ref("user-2", "prof-2", "hash_a", 1000, future)
        assert len(_refset_rows("hash_a")) == 2

        # Delete both: count truthfully reaches zero.
        auth_db.delete_ref("user-1", "prof-1", "hash_a")
        auth_db.delete_ref("user-2", "prof-2", "hash_a")
        assert len(_refset_rows("hash_a")) == 0
        assert auth_db.has_remaining_refs("hash_a") is False

    def test_no_stored_ref_count_column_exists(self):
        """Structural guard: game_storage_refs must never grow a stored count
        column -- the whole point is that ref_count is COUNT(*), never cached."""
        with auth_db.get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'game_storage_refs'"
            )
            columns = {r["column_name"] for r in cur.fetchall()}
        assert "ref_count" not in columns
