"""
Tests for game storage functions after the T6770 derived-ref-set rework:
- Per-user expiry in profile.sqlite (game_storage table)
- Per-(user,profile,hash) ref-set in Postgres (game_storage_refs table) --
  ref_count is DERIVED (COUNT(*) over real rows), not a hand-maintained
  integer, so it cannot drift from the rows that back it.
- Grace deletions in Postgres (r2_grace_deletions table)
"""

import sqlite3
import sys
import types
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

# Prevent cv2 import failure when app.services.__init__ loads image_extractor
if "cv2" not in sys.modules:
    sys.modules["cv2"] = types.ModuleType("cv2")

from app.services import auth_db


@pytest.fixture(autouse=True)
def temp_auth_db(pg_conn, tmp_path):
    """Clean Postgres tables + isolated profile SQLite for each test."""
    from app.services.auth_db import create_user
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    create_user("user-1", email="user1@example.com")
    create_user("user-2", email="user2@example.com")

    # Create isolated profile.sqlite with game_storage table
    set_current_user_id("user-1")
    set_current_profile_id("prof-1")

    db_dir = tmp_path / "user-1" / "profiles" / "prof-1"
    db_dir.mkdir(parents=True)
    db_path = db_dir / "profile.sqlite"

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS game_storage (
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
         patch("app.database._initialized_users", {"user-1", "user-2"}), \
         patch("app.database.R2_ENABLED", False):
        yield {"tmp_path": tmp_path}


def _setup_user2_profile(tmp_path):
    """Create a second user's profile DB for multi-user tests."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id("user-2")
    set_current_profile_id("prof-2")

    db_dir = tmp_path / "user-2" / "profiles" / "prof-2"
    db_dir.mkdir(parents=True)
    db_path = db_dir / "profile.sqlite"

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS game_storage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blake3_hash TEXT NOT NULL UNIQUE,
            game_size_bytes INTEGER NOT NULL,
            storage_expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# insert_game_storage_ref
# ---------------------------------------------------------------------------

def _pg_ref_count(blake3_hash):
    with auth_db.get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) AS n FROM game_storage_refs WHERE blake3_hash = %s",
            (blake3_hash,),
        )
        return cur.fetchone()["n"]


class TestInsertGameStorageRef:
    def test_inserts_into_sqlite_and_creates_pg_ref_row(self, temp_auth_db):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)

        ref = auth_db.get_game_storage_ref("user-1", "prof-1", "hash_a")
        assert ref is not None
        assert ref["game_size_bytes"] == 1000

        assert auth_db.has_remaining_refs("hash_a") is True
        assert _pg_ref_count("hash_a") == 1

    def test_upsert_updates_expiry_without_creating_a_second_row(self, temp_auth_db):
        future1 = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        future2 = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()

        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future1)
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future2)

        ref = auth_db.get_game_storage_ref("user-1", "prof-1", "hash_a")
        assert ref["storage_expires_at"] == future2

        # Derived count is COUNT(*) -- re-upserting the SAME (user,profile,hash)
        # must stay at 1 row, never accumulate.
        assert _pg_ref_count("hash_a") == 1

    def test_second_profile_creates_a_second_row(self, temp_auth_db):
        """Two profiles referencing the same hash are two distinct rows --
        ref_count = COUNT(*) = 2, not a shared integer either profile can
        under/over-write."""
        _setup_user2_profile(temp_auth_db["tmp_path"])
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        set_current_user_id("user-1")
        set_current_profile_id("prof-1")
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)

        set_current_user_id("user-2")
        set_current_profile_id("prof-2")
        auth_db.insert_game_storage_ref("user-2", "prof-2", "hash_a", 1000, future)

        assert _pg_ref_count("hash_a") == 2

    def test_clears_grace_deletion_on_insert(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a")

        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)

        with auth_db.get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM r2_grace_deletions WHERE blake3_hash = %s", ("hash_a",))
            assert cur.fetchone() is None

    def test_updates_expiry_via_greatest(self, temp_auth_db):
        early = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        late = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()

        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, early)

        # A later re-upsert for the SAME (user,profile,hash) must never move
        # storage_expires_at backwards.
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, late)

        with auth_db.get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT storage_expires_at FROM game_storage_refs "
                "WHERE user_id = %s AND profile_id = %s AND blake3_hash = %s",
                ("user-1", "prof-1", "hash_a"),
            )
            row = cur.fetchone()
        assert row["storage_expires_at"].isoformat() >= late[:19]

    def test_creates_pg_row_even_when_sqlite_row_already_exists(self, temp_auth_db):
        """Regression test for the 2026-08-11 missing-row finding: the OLD
        is_new-gated write skipped the Postgres mutation whenever the SQLite
        row already existed, so a PG row lost to a prior crash/purge could
        never self-heal. The new upsert is keyed on the actual pair, not
        SQLite novelty, so it must (re)create the PG row unconditionally."""
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

        # First call creates both rows normally.
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)
        assert _pg_ref_count("hash_a") == 1

        # Simulate the drift: the PG row vanishes (crash / purge / pre-backfill
        # state) while the SQLite row survives.
        with auth_db.get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM game_storage_refs WHERE blake3_hash = %s", ("hash_a",))
        assert _pg_ref_count("hash_a") == 0

        # Re-running the SAME gesture (SQLite row already exists) must still
        # (re)create the PG row -- this is the exact case the old code missed.
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)
        assert _pg_ref_count("hash_a") == 1
        assert auth_db.has_remaining_refs("hash_a") is True


# ---------------------------------------------------------------------------
# get_game_storage_ref
# ---------------------------------------------------------------------------

class TestGetGameStorageRef:
    def test_returns_none_for_nonexistent(self, temp_auth_db):
        assert auth_db.get_game_storage_ref("user-1", "prof-1", "nope") is None

    def test_returns_ref_data(self, temp_auth_db):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 2000, future)

        ref = auth_db.get_game_storage_ref("user-1", "prof-1", "hash_a")
        assert ref["game_size_bytes"] == 2000
        assert ref["storage_expires_at"] == future


# ---------------------------------------------------------------------------
# get_storage_refs_for_user
# ---------------------------------------------------------------------------

class TestGetStorageRefsForUser:
    def test_returns_all_refs(self, temp_auth_db):
        f1 = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        f2 = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, f1)
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_b", 2000, f2)

        refs = auth_db.get_storage_refs_for_user("user-1")
        assert len(refs) == 2
        hashes = {r["blake3_hash"] for r in refs}
        assert hashes == {"hash_a", "hash_b"}

    def test_returns_empty_when_none(self, temp_auth_db):
        refs = auth_db.get_storage_refs_for_user("user-1")
        assert refs == []


# ---------------------------------------------------------------------------
# delete_ref
# ---------------------------------------------------------------------------

class TestDeleteRef:
    def test_deletes_from_sqlite_and_pg_ref_row(self, temp_auth_db):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)

        auth_db.delete_ref("user-1", "prof-1", "hash_a")

        assert auth_db.get_game_storage_ref("user-1", "prof-1", "hash_a") is None
        assert auth_db.has_remaining_refs("hash_a") is False
        assert _pg_ref_count("hash_a") == 0

    def test_no_op_for_nonexistent(self, temp_auth_db):
        auth_db.delete_ref("user-1", "prof-1", "nope")

    def test_double_delete_is_a_no_op_never_undercounts(self, temp_auth_db):
        """T6770: delete_ref is a keyed DELETE, not a decrement -- a double-
        delete (or a delete racing a delete) is a zero-row no-op the second
        time, never able to drive the count below the true number of live
        refs (the old GREATEST(ref_count-1, 0) floor existed only because a
        counter COULD be decremented past zero; a derived COUNT(*) cannot)."""
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)

        auth_db.delete_ref("user-1", "prof-1", "hash_a")
        auth_db.delete_ref("user-1", "prof-1", "hash_a")  # second delete: no-op

        assert _pg_ref_count("hash_a") == 0

    def test_deleting_one_profile_leaves_the_others_live(self, temp_auth_db):
        _setup_user2_profile(temp_auth_db["tmp_path"])
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        set_current_user_id("user-1")
        set_current_profile_id("prof-1")
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)
        set_current_user_id("user-2")
        set_current_profile_id("prof-2")
        auth_db.insert_game_storage_ref("user-2", "prof-2", "hash_a", 1000, future)
        assert _pg_ref_count("hash_a") == 2

        auth_db.delete_ref("user-2", "prof-2", "hash_a")

        assert _pg_ref_count("hash_a") == 1
        assert auth_db.has_remaining_refs("hash_a") is True


# ---------------------------------------------------------------------------
# has_remaining_refs
# ---------------------------------------------------------------------------

class TestHasRemainingRefs:
    def test_true_when_refs_exist(self, temp_auth_db):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)
        assert auth_db.has_remaining_refs("hash_a") is True

    def test_false_when_no_refs(self, temp_auth_db):
        assert auth_db.has_remaining_refs("hash_a") is False

    def test_false_after_all_deleted(self, temp_auth_db):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)
        auth_db.delete_ref("user-1", "prof-1", "hash_a")
        assert auth_db.has_remaining_refs("hash_a") is False


# ---------------------------------------------------------------------------
# get_all_ref_hashes
# ---------------------------------------------------------------------------

class TestGetAllRefHashes:
    def test_returns_all_hashes(self, temp_auth_db):
        f = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, f)
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_b", 2000, f)

        result = auth_db.get_all_ref_hashes("user-1")
        assert result == {"hash_a", "hash_b"}

    def test_returns_empty_when_none(self, temp_auth_db):
        assert auth_db.get_all_ref_hashes("user-1") == set()


# ---------------------------------------------------------------------------
# get_next_expiry
# ---------------------------------------------------------------------------

class TestGetNextExpiry:
    def test_returns_none_when_no_refs(self, temp_auth_db):
        assert auth_db.get_next_expiry() is None

    def test_returns_earliest_future_expiry(self, temp_auth_db):
        soon = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        later = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, soon)
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_b", 1000, later)

        result = auth_db.get_next_expiry()
        assert result is not None
        expected = datetime.now(timezone.utc) + timedelta(hours=2)
        assert abs((result - expected).total_seconds()) < 5

    def test_returns_grace_expiry_when_earlier(self, temp_auth_db):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)
        auth_db.insert_grace_deletion("hash_b", grace_days=3)

        result = auth_db.get_next_expiry()
        assert result is not None
        grace_expected = datetime.now(timezone.utc) + timedelta(days=3)
        assert abs((result - grace_expected).total_seconds()) < 5

    def test_returns_grace_expiry_when_no_refs(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a", grace_days=7)

        result = auth_db.get_next_expiry()
        assert result is not None
        expected = datetime.now(timezone.utc) + timedelta(days=7)
        assert abs((result - expected).total_seconds()) < 5


# ---------------------------------------------------------------------------
# get_expired_refs_for_profile
# ---------------------------------------------------------------------------

class TestGetExpiredRefsForProfile:
    def test_returns_expired_refs(self, temp_auth_db):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, past)
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_b", 1000, future)

        result = auth_db.get_expired_refs_for_profile()
        assert len(result) == 1
        assert result[0]["blake3_hash"] == "hash_a"

    def test_returns_empty_when_none_expired(self, temp_auth_db):
        future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)

        result = auth_db.get_expired_refs_for_profile()
        assert result == []


# ---------------------------------------------------------------------------
# Grace deletion functions (unchanged, still Postgres)
# ---------------------------------------------------------------------------

class TestInsertGraceDeletion:
    def test_basic_insert(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a", grace_days=14)

        with auth_db.get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM r2_grace_deletions WHERE blake3_hash = %s", ("hash_a",))
            row = cur.fetchone()
        assert row is not None
        expires = row["grace_expires_at"]
        expected = datetime.now(timezone.utc) + timedelta(days=14)
        assert abs((expires - expected).total_seconds()) < 2

    def test_idempotent(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a", grace_days=14)
        auth_db.insert_grace_deletion("hash_a", grace_days=7)

        with auth_db.get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM r2_grace_deletions WHERE blake3_hash = %s", ("hash_a",))
            row = cur.fetchone()
        expires = row["grace_expires_at"]
        expected = datetime.now(timezone.utc) + timedelta(days=14)
        assert abs((expires - expected).total_seconds()) < 2


class TestGetExpiredGraceDeletions:
    def test_returns_only_past(self, temp_auth_db):
        past = datetime.now(timezone.utc) - timedelta(days=1)
        future = datetime.now(timezone.utc) + timedelta(days=7)
        with auth_db.get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO r2_grace_deletions (blake3_hash, grace_expires_at) VALUES (%s, %s)",
                ("hash_a", past),
            )
            cur.execute(
                "INSERT INTO r2_grace_deletions (blake3_hash, grace_expires_at) VALUES (%s, %s)",
                ("hash_b", future),
            )

        result = auth_db.get_expired_grace_deletions()
        assert result == ["hash_a"]


class TestDeleteGraceDeletion:
    def test_removes_row(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a")
        auth_db.delete_grace_deletion("hash_a")

        with auth_db.get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM r2_grace_deletions WHERE blake3_hash = %s", ("hash_a",))
            assert cur.fetchone() is None
