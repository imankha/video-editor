"""
Tests for auth_db storage ref functions: get_expired_refs, delete_ref,
has_remaining_refs, get_next_expiry.
"""

import sys
import types
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch

# Prevent cv2 import failure when app.services.__init__ loads image_extractor
if "cv2" not in sys.modules:
    sys.modules["cv2"] = types.ModuleType("cv2")

from app.services import auth_db


@pytest.fixture(autouse=True)
def temp_auth_db(tmp_path, monkeypatch):
    """Isolated auth DB."""
    db_path = tmp_path / "auth.sqlite"
    monkeypatch.setattr(auth_db, "AUTH_DB_PATH", db_path)
    monkeypatch.setattr(auth_db, "_r2_enabled", lambda: False)
    auth_db.init_auth_db()
    with auth_db._session_cache_lock:
        auth_db._session_cache.clear()
    yield db_path


def _insert_ref(blake3_hash, user_id, profile_id, expires_at_iso):
    with auth_db.get_auth_db() as db:
        db.execute(
            """INSERT INTO game_storage_refs
               (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (?, ?, ?, 1000, ?)""",
            (user_id, profile_id, blake3_hash, expires_at_iso),
        )
        db.commit()


# ---------------------------------------------------------------------------
# get_expired_refs
# ---------------------------------------------------------------------------

class TestGetExpiredRefs:
    def test_returns_individually_expired_refs(self, temp_auth_db):
        past = (datetime.utcnow() - timedelta(days=1)).isoformat()
        future = (datetime.utcnow() + timedelta(days=7)).isoformat()
        _insert_ref("hash_a", "user-1", "prof-1", past)
        _insert_ref("hash_a", "user-2", "prof-2", future)

        result = auth_db.get_expired_refs()
        assert len(result) == 1
        assert result[0]["user_id"] == "user-1"

    def test_returns_empty_when_none_expired(self, temp_auth_db):
        future = (datetime.utcnow() + timedelta(days=7)).isoformat()
        _insert_ref("hash_a", "user-1", "prof-1", future)

        result = auth_db.get_expired_refs()
        assert result == []

    def test_returns_all_expired_across_hashes(self, temp_auth_db):
        past = (datetime.utcnow() - timedelta(days=1)).isoformat()
        _insert_ref("hash_a", "user-1", "prof-1", past)
        _insert_ref("hash_b", "user-2", "prof-2", past)

        result = auth_db.get_expired_refs()
        assert len(result) == 2


# ---------------------------------------------------------------------------
# delete_ref
# ---------------------------------------------------------------------------

class TestDeleteRef:
    def test_deletes_single_ref(self, temp_auth_db):
        past = (datetime.utcnow() - timedelta(days=1)).isoformat()
        _insert_ref("hash_a", "user-1", "prof-1", past)
        _insert_ref("hash_a", "user-2", "prof-2", past)

        auth_db.delete_ref("user-1", "prof-1", "hash_a")

        with auth_db.get_auth_db() as db:
            rows = db.execute("SELECT user_id FROM game_storage_refs").fetchall()
        assert len(rows) == 1
        assert rows[0]["user_id"] == "user-2"

    def test_no_op_for_nonexistent_ref(self, temp_auth_db):
        auth_db.delete_ref("nobody", "noprof", "nohash")


# ---------------------------------------------------------------------------
# has_remaining_refs
# ---------------------------------------------------------------------------

class TestHasRemainingRefs:
    def test_true_when_refs_exist(self, temp_auth_db):
        future = (datetime.utcnow() + timedelta(days=7)).isoformat()
        _insert_ref("hash_a", "user-1", "prof-1", future)

        assert auth_db.has_remaining_refs("hash_a") is True

    def test_false_when_no_refs(self, temp_auth_db):
        assert auth_db.has_remaining_refs("hash_a") is False

    def test_false_after_all_deleted(self, temp_auth_db):
        past = (datetime.utcnow() - timedelta(days=1)).isoformat()
        _insert_ref("hash_a", "user-1", "prof-1", past)

        auth_db.delete_ref("user-1", "prof-1", "hash_a")
        assert auth_db.has_remaining_refs("hash_a") is False


# ---------------------------------------------------------------------------
# get_next_expiry
# ---------------------------------------------------------------------------

class TestGetNextExpiry:
    def test_returns_none_when_no_refs(self, temp_auth_db):
        result = auth_db.get_next_expiry()
        assert result is None

    def test_returns_none_when_all_expired(self, temp_auth_db):
        past = (datetime.utcnow() - timedelta(days=1)).isoformat()
        _insert_ref("hash_a", "user-1", "prof-1", past)

        result = auth_db.get_next_expiry()
        assert result is None

    def test_returns_earliest_future_expiry(self, temp_auth_db):
        soon = datetime.utcnow() + timedelta(hours=2)
        later = datetime.utcnow() + timedelta(days=7)
        _insert_ref("hash_a", "user-1", "prof-1", soon.isoformat())
        _insert_ref("hash_b", "user-2", "prof-2", later.isoformat())

        result = auth_db.get_next_expiry()
        assert result is not None
        assert abs((result - soon).total_seconds()) < 2

    def test_ignores_past_expiries(self, temp_auth_db):
        past = (datetime.utcnow() - timedelta(days=5)).isoformat()
        future = datetime.utcnow() + timedelta(days=10)
        _insert_ref("hash_a", "user-1", "prof-1", past)
        _insert_ref("hash_b", "user-2", "prof-2", future.isoformat())

        result = auth_db.get_next_expiry()
        assert result is not None
        assert abs((result - future).total_seconds()) < 2

    def test_returns_grace_expiry_when_earlier(self, temp_auth_db):
        ref_future = datetime.utcnow() + timedelta(days=30)
        _insert_ref("hash_a", "user-1", "prof-1", ref_future.isoformat())
        auth_db.insert_grace_deletion("hash_b", grace_days=3)

        result = auth_db.get_next_expiry()
        assert result is not None
        grace_expected = datetime.utcnow() + timedelta(days=3)
        assert abs((result - grace_expected).total_seconds()) < 2

    def test_returns_ref_expiry_when_earlier_than_grace(self, temp_auth_db):
        ref_soon = datetime.utcnow() + timedelta(hours=1)
        _insert_ref("hash_a", "user-1", "prof-1", ref_soon.isoformat())
        auth_db.insert_grace_deletion("hash_b", grace_days=14)

        result = auth_db.get_next_expiry()
        assert result is not None
        assert abs((result - ref_soon).total_seconds()) < 2

    def test_returns_grace_expiry_when_no_refs(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a", grace_days=7)

        result = auth_db.get_next_expiry()
        assert result is not None
        expected = datetime.utcnow() + timedelta(days=7)
        assert abs((result - expected).total_seconds()) < 2


# ---------------------------------------------------------------------------
# insert_grace_deletion
# ---------------------------------------------------------------------------

class TestInsertGraceDeletion:
    def test_basic_insert(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a", grace_days=14)

        with auth_db.get_auth_db() as db:
            row = db.execute(
                "SELECT * FROM r2_grace_deletions WHERE blake3_hash = ?",
                ("hash_a",),
            ).fetchone()
        assert row is not None
        expires = datetime.fromisoformat(row['grace_expires_at'])
        expected = datetime.utcnow() + timedelta(days=14)
        assert abs((expires - expected).total_seconds()) < 2

    def test_idempotent_insert_or_ignore(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a", grace_days=14)
        auth_db.insert_grace_deletion("hash_a", grace_days=7)

        with auth_db.get_auth_db() as db:
            row = db.execute(
                "SELECT * FROM r2_grace_deletions WHERE blake3_hash = ?",
                ("hash_a",),
            ).fetchone()
        expires = datetime.fromisoformat(row['grace_expires_at'])
        expected = datetime.utcnow() + timedelta(days=14)
        assert abs((expires - expected).total_seconds()) < 2


# ---------------------------------------------------------------------------
# get_expired_grace_deletions
# ---------------------------------------------------------------------------

class TestGetExpiredGraceDeletions:
    def test_returns_only_past_grace_rows(self, temp_auth_db):
        past = (datetime.utcnow() - timedelta(days=1)).isoformat()
        future = (datetime.utcnow() + timedelta(days=7)).isoformat()
        with auth_db.get_auth_db() as db:
            db.execute(
                "INSERT INTO r2_grace_deletions (blake3_hash, grace_expires_at) VALUES (?, ?)",
                ("hash_a", past),
            )
            db.execute(
                "INSERT INTO r2_grace_deletions (blake3_hash, grace_expires_at) VALUES (?, ?)",
                ("hash_b", future),
            )
            db.commit()

        result = auth_db.get_expired_grace_deletions()
        assert result == ["hash_a"]

    def test_returns_empty_when_none_expired(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a", grace_days=14)

        result = auth_db.get_expired_grace_deletions()
        assert result == []


# ---------------------------------------------------------------------------
# delete_grace_deletion
# ---------------------------------------------------------------------------

class TestDeleteGraceDeletion:
    def test_removes_row(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a")

        auth_db.delete_grace_deletion("hash_a")

        with auth_db.get_auth_db() as db:
            row = db.execute(
                "SELECT * FROM r2_grace_deletions WHERE blake3_hash = ?",
                ("hash_a",),
            ).fetchone()
        assert row is None

    def test_no_op_for_nonexistent(self, temp_auth_db):
        auth_db.delete_grace_deletion("nonexistent")


# ---------------------------------------------------------------------------
# insert_game_storage_ref clears grace deletion
# ---------------------------------------------------------------------------

class TestInsertRefClearsGrace:
    def test_clears_grace_on_extension(self, temp_auth_db):
        auth_db.insert_grace_deletion("hash_a")

        future = (datetime.utcnow() + timedelta(days=30)).isoformat()
        auth_db.insert_game_storage_ref("user-1", "prof-1", "hash_a", 1000, future)

        with auth_db.get_auth_db() as db:
            row = db.execute(
                "SELECT * FROM r2_grace_deletions WHERE blake3_hash = ?",
                ("hash_a",),
            ).fetchone()
        assert row is None
