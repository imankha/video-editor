"""
Tests for T2930: Postgres Data Locality Audit migrations.

Covers:
- Postgres v002: game_ref_counts table creation, data population, deprecated column removal
- Profile v002: game_storage table creation, data copy from Postgres
- run_all_migrations() orchestration
- GREATEST logic for latest_expiry updates
- Ref count atomicity (new vs existing hash)
"""

import sqlite3
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.migrations.postgres.v002_game_ref_counts import V002GameRefCounts
from app.migrations.profile_db.v002_game_storage import V002GameStorage


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def pg_with_seed_data(pg_conn):
    """Postgres with schema + seed data in game_storage_refs for migration testing.

    Inserts test data THEN runs the v002 migration so game_ref_counts is populated.
    """
    from app.services.pg import get_pg
    from app.services.auth_db import create_user

    create_user("user-1", email="user1@example.com")
    create_user("user-2", email="user2@example.com")

    future_1 = datetime.now(timezone.utc) + timedelta(days=30)
    future_2 = datetime.now(timezone.utc) + timedelta(days=60)
    future_3 = datetime.now(timezone.utc) + timedelta(days=45)

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (%s, %s, %s, %s, %s)""",
            ("user-1", "prof-1", "hash_a", 1000, future_1),
        )
        cur.execute(
            """INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (%s, %s, %s, %s, %s)""",
            ("user-1", "prof-1", "hash_b", 2000, future_2),
        )
        cur.execute(
            """INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (%s, %s, %s, %s, %s)""",
            ("user-2", "prof-2", "hash_a", 1000, future_3),
        )

    # Run v002 migration to populate game_ref_counts from seed data
    with get_pg() as conn:
        migration = V002GameRefCounts()
        migration.up(conn)

    yield {
        "future_1": future_1,
        "future_2": future_2,
        "future_3": future_3,
    }


@pytest.fixture
def profile_db(tmp_path):
    """Isolated profile.sqlite with game_storage table for integration tests."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

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
        yield {"db_path": db_path, "tmp_path": tmp_path}


# ---------------------------------------------------------------------------
# Postgres v002: game_ref_counts creation
# ---------------------------------------------------------------------------

class TestPostgresV002:
    def test_creates_game_ref_counts_table(self, pg_with_seed_data):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_ref_counts')"
            )
            assert cur.fetchone()["exists"] is True

    def test_populates_ref_counts_from_existing_data(self, pg_with_seed_data):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            # hash_a has 2 refs (user-1 and user-2)
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_a",))
            row = cur.fetchone()
            assert row is not None
            assert row["ref_count"] == 2

            # hash_b has 1 ref (user-1 only)
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_b",))
            row = cur.fetchone()
            assert row is not None
            assert row["ref_count"] == 1

    def test_latest_expiry_is_max_of_all_users(self, pg_with_seed_data):
        from app.services.pg import get_pg

        data = pg_with_seed_data
        with get_pg() as conn:
            cur = conn.cursor()
            # hash_a: max(future_1=30d, future_3=45d) = future_3
            cur.execute("SELECT latest_expiry FROM game_ref_counts WHERE blake3_hash = %s", ("hash_a",))
            row = cur.fetchone()
            assert row is not None
            assert abs((row["latest_expiry"] - data["future_3"]).total_seconds()) < 2

            # hash_b: only future_2=60d
            cur.execute("SELECT latest_expiry FROM game_ref_counts WHERE blake3_hash = %s", ("hash_b",))
            row = cur.fetchone()
            assert row is not None
            assert abs((row["latest_expiry"] - data["future_2"]).total_seconds()) < 2

    def test_credit_summary_column_dropped(self, pg_with_seed_data):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_name = 'users' AND column_name = 'credit_summary'"""
            )
            assert cur.fetchone() is None

    def test_watched_at_column_dropped(self, pg_with_seed_data):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_name = 'shares' AND column_name = 'watched_at'"""
            )
            assert cur.fetchone() is None

    def test_migration_is_idempotent(self, pg_with_seed_data):
        from app.services.pg import get_pg

        # Running again should not fail or change counts
        with get_pg() as conn:
            migration = V002GameRefCounts()
            migration.up(conn)

            cur = conn.cursor()
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_a",))
            assert cur.fetchone()["ref_count"] == 2


# ---------------------------------------------------------------------------
# Profile v002: game_storage table creation + data copy
# ---------------------------------------------------------------------------

class TestProfileV002:
    def test_creates_game_storage_table(self, pg_with_seed_data, profile_db):
        """Migration creates game_storage table in a fresh profile DB."""
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        set_current_user_id("user-1")
        set_current_profile_id("prof-1")

        # Create a fresh DB without game_storage
        tmp_path = profile_db["tmp_path"]
        db_dir = tmp_path / "user-1" / "profiles" / "fresh"
        db_dir.mkdir(parents=True, exist_ok=True)
        fresh_path = db_dir / "profile.sqlite"
        conn = sqlite3.connect(str(fresh_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.commit()

        migration = V002GameStorage()
        migration.up(conn)
        conn.commit()

        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        conn.close()
        assert "game_storage" in tables

    def test_copies_user_data_from_postgres(self, pg_with_seed_data, profile_db):
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        set_current_user_id("user-1")
        set_current_profile_id("prof-1")

        # Fresh DB to run migration against
        tmp_path = profile_db["tmp_path"]
        db_dir = tmp_path / "user-1" / "profiles" / "copy-test"
        db_dir.mkdir(parents=True, exist_ok=True)
        fresh_path = db_dir / "profile.sqlite"
        conn = sqlite3.connect(str(fresh_path))
        conn.row_factory = sqlite3.Row

        migration = V002GameStorage()
        migration.up(conn)
        conn.commit()

        rows = conn.execute("SELECT * FROM game_storage ORDER BY blake3_hash").fetchall()
        conn.close()

        # user-1/prof-1 has hash_a and hash_b
        assert len(rows) == 2
        hashes = {r["blake3_hash"] for r in rows}
        assert hashes == {"hash_a", "hash_b"}

    def test_does_not_copy_other_users_data(self, pg_with_seed_data, profile_db):
        """user-2's data should NOT appear in user-1's profile.sqlite."""
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        set_current_user_id("user-2")
        set_current_profile_id("prof-2")

        tmp_path = profile_db["tmp_path"]
        db_dir = tmp_path / "user-2" / "profiles" / "prof-2"
        db_dir.mkdir(parents=True, exist_ok=True)
        db_path_2 = db_dir / "profile.sqlite"

        conn2 = sqlite3.connect(str(db_path_2))
        conn2.row_factory = sqlite3.Row

        migration = V002GameStorage()
        migration.up(conn2)
        conn2.commit()

        rows = conn2.execute("SELECT * FROM game_storage").fetchall()
        conn2.close()

        # user-2/prof-2 should only have hash_a (their ref)
        assert len(rows) == 1
        assert rows[0]["blake3_hash"] == "hash_a"

    def test_preserves_size_and_expiry(self, pg_with_seed_data, profile_db):
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        set_current_user_id("user-1")
        set_current_profile_id("prof-1")

        tmp_path = profile_db["tmp_path"]
        db_dir = tmp_path / "user-1" / "profiles" / "size-test"
        db_dir.mkdir(parents=True, exist_ok=True)
        fresh_path = db_dir / "profile.sqlite"
        conn = sqlite3.connect(str(fresh_path))
        conn.row_factory = sqlite3.Row

        migration = V002GameStorage()
        migration.up(conn)
        conn.commit()

        row = conn.execute(
            "SELECT game_size_bytes, storage_expires_at FROM game_storage WHERE blake3_hash = ?",
            ("hash_a",),
        ).fetchone()
        conn.close()

        assert row["game_size_bytes"] == 1000
        assert "T" in row["storage_expires_at"] or "-" in row["storage_expires_at"]

    def test_insert_or_ignore_prevents_duplicates(self, pg_with_seed_data, profile_db):
        """Running migration twice should not fail or create duplicate rows."""
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        set_current_user_id("user-1")
        set_current_profile_id("prof-1")

        tmp_path = profile_db["tmp_path"]
        db_dir = tmp_path / "user-1" / "profiles" / "dup-test"
        db_dir.mkdir(parents=True, exist_ok=True)
        fresh_path = db_dir / "profile.sqlite"
        conn = sqlite3.connect(str(fresh_path))
        conn.row_factory = sqlite3.Row

        migration = V002GameStorage()
        migration.up(conn)
        conn.commit()
        migration.up(conn)
        conn.commit()

        rows = conn.execute("SELECT * FROM game_storage").fetchall()
        conn.close()
        assert len(rows) == 2


# ---------------------------------------------------------------------------
# run_all_migrations orchestration
# ---------------------------------------------------------------------------

class TestRunAllMigrations:
    def test_postgres_migration_applied_via_runner(self, pg_with_seed_data, profile_db):
        """_migrate_postgres applies v002 via the MigrationRunner and records it."""
        from app.migrations import _migrate_postgres
        from app.services.pg import get_pg

        # Clear v002 so it re-applies
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM schema_migrations WHERE version >= 2")
            cur.execute("DROP TABLE IF EXISTS game_ref_counts")

        results = {"postgres": {"applied": [], "error": None}}
        _migrate_postgres(results)

        assert results["postgres"]["error"] is None
        applied_versions = [m["version"] for m in results["postgres"]["applied"]]
        assert 2 in applied_versions

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM schema_migrations WHERE version = 2")
            row = cur.fetchone()
            assert row is not None
            assert "game_ref_counts" in row["description"]

    def test_postgres_migration_skipped_when_already_applied(self, pg_with_seed_data, profile_db):
        """If v002 already applied, _migrate_postgres does not re-apply."""
        from app.migrations import _migrate_postgres
        from app.services.pg import get_pg

        # v002 was already applied by pg_with_seed_data fixture
        # Record it in schema_migrations so the runner considers it done
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO schema_migrations (version, description) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (2, "game_ref_counts"),
            )

        results = {"postgres": {"applied": [], "error": None}}
        _migrate_postgres(results)

        assert results["postgres"]["error"] is None
        assert results["postgres"]["applied"] == []


# ---------------------------------------------------------------------------
# Integration: insert_game_storage_ref atomicity
# ---------------------------------------------------------------------------

class TestRefCountAtomicity:
    def test_new_hash_increments_ref_count(self, pg_with_seed_data, profile_db):
        """First insert for a hash should set ref_count = 1."""
        from app.services.auth_db import insert_game_storage_ref
        from app.services.pg import get_pg

        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        insert_game_storage_ref("user-1", "prof-1", "hash_new", 5000, future)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_new",))
            row = cur.fetchone()
        assert row["ref_count"] == 1

    def test_existing_hash_does_not_increment(self, pg_with_seed_data, profile_db):
        """Re-inserting same user+profile+hash should NOT increment ref_count."""
        from app.services.auth_db import insert_game_storage_ref
        from app.services.pg import get_pg

        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        insert_game_storage_ref("user-1", "prof-1", "hash_reinsert", 5000, future)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_reinsert",))
            initial = cur.fetchone()["ref_count"]

        # Re-insert same hash for same user
        future2 = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()
        insert_game_storage_ref("user-1", "prof-1", "hash_reinsert", 5000, future2)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_reinsert",))
            after = cur.fetchone()["ref_count"]

        assert after == initial

    def test_different_user_same_hash_increments(self, pg_with_seed_data, profile_db):
        """Different user inserting same hash should increment ref_count."""
        from app.services.auth_db import insert_game_storage_ref
        from app.services.pg import get_pg
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id

        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

        # User 1 inserts
        set_current_user_id("user-1")
        set_current_profile_id("prof-1")
        insert_game_storage_ref("user-1", "prof-1", "hash_shared", 5000, future)

        # Set up user-2's profile.sqlite with game_storage table
        set_current_user_id("user-2")
        set_current_profile_id("prof-2")

        tmp_path = profile_db["tmp_path"]
        db_dir2 = tmp_path / "user-2" / "profiles" / "prof-2"
        db_dir2.mkdir(parents=True, exist_ok=True)
        db_path2 = db_dir2 / "profile.sqlite"
        conn2 = sqlite3.connect(str(db_path2))
        conn2.execute("PRAGMA journal_mode=WAL")
        conn2.execute("""
            CREATE TABLE IF NOT EXISTS game_storage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blake3_hash TEXT NOT NULL UNIQUE,
                game_size_bytes INTEGER NOT NULL,
                storage_expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn2.commit()
        conn2.close()

        insert_game_storage_ref("user-2", "prof-2", "hash_shared", 5000, future)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_shared",))
            row = cur.fetchone()
        assert row["ref_count"] == 2


# ---------------------------------------------------------------------------
# Integration: GREATEST logic for latest_expiry
# ---------------------------------------------------------------------------

class TestLatestExpiryGreatest:
    def test_later_expiry_updates_latest(self, pg_with_seed_data, profile_db):
        """Extending expiry with a later date should update latest_expiry."""
        from app.services.auth_db import insert_game_storage_ref
        from app.services.pg import get_pg

        early = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        late = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()

        insert_game_storage_ref("user-1", "prof-1", "hash_greatest", 1000, early)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT latest_expiry FROM game_ref_counts WHERE blake3_hash = %s", ("hash_greatest",))
            first_expiry = cur.fetchone()["latest_expiry"]

        # Re-insert with later expiry
        insert_game_storage_ref("user-1", "prof-1", "hash_greatest", 1000, late)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT latest_expiry FROM game_ref_counts WHERE blake3_hash = %s", ("hash_greatest",))
            updated_expiry = cur.fetchone()["latest_expiry"]

        assert updated_expiry > first_expiry

    def test_earlier_expiry_does_not_decrease_latest(self, pg_with_seed_data, profile_db):
        """Re-inserting with an earlier date should NOT decrease latest_expiry."""
        from app.services.auth_db import insert_game_storage_ref
        from app.services.pg import get_pg

        late = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
        early = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()

        insert_game_storage_ref("user-1", "prof-1", "hash_no_decrease", 1000, late)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT latest_expiry FROM game_ref_counts WHERE blake3_hash = %s", ("hash_no_decrease",))
            original = cur.fetchone()["latest_expiry"]

        # Re-insert with earlier expiry
        insert_game_storage_ref("user-1", "prof-1", "hash_no_decrease", 1000, early)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT latest_expiry FROM game_ref_counts WHERE blake3_hash = %s", ("hash_no_decrease",))
            after = cur.fetchone()["latest_expiry"]

        assert abs((after - original).total_seconds()) < 2


# ---------------------------------------------------------------------------
# Integration: delete_ref decrements ref_count
# ---------------------------------------------------------------------------

class TestDeleteRefIntegration:
    def test_delete_decrements_ref_count(self, pg_with_seed_data, profile_db):
        from app.services.auth_db import insert_game_storage_ref, delete_ref
        from app.services.pg import get_pg

        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        insert_game_storage_ref("user-1", "prof-1", "hash_del", 1000, future)

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_del",))
            assert cur.fetchone()["ref_count"] == 1

        delete_ref("user-1", "prof-1", "hash_del")

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s", ("hash_del",))
            assert cur.fetchone()["ref_count"] == 0

    def test_delete_removes_from_sqlite(self, pg_with_seed_data, profile_db):
        from app.services.auth_db import insert_game_storage_ref, delete_ref, get_game_storage_ref

        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        insert_game_storage_ref("user-1", "prof-1", "hash_del2", 1000, future)
        assert get_game_storage_ref("user-1", "prof-1", "hash_del2") is not None

        delete_ref("user-1", "prof-1", "hash_del2")
        assert get_game_storage_ref("user-1", "prof-1", "hash_del2") is None


# ---------------------------------------------------------------------------
# Integration: get_next_expiry uses game_ref_counts
# ---------------------------------------------------------------------------

class TestGetNextExpiryIntegration:
    def test_returns_earliest_from_ref_counts(self, pg_with_seed_data, profile_db):
        """get_next_expiry returns MIN(latest_expiry) from game_ref_counts WHERE ref_count > 0."""
        from app.services.auth_db import get_next_expiry
        from app.services.pg import get_pg

        # Clean slate: remove any pre-existing rows from dev DB
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM game_ref_counts")
            cur.execute("DELETE FROM r2_grace_deletions")
            # Insert controlled test data
            future_30d = datetime.now(timezone.utc) + timedelta(days=30)
            future_60d = datetime.now(timezone.utc) + timedelta(days=60)
            cur.execute(
                "INSERT INTO game_ref_counts (blake3_hash, ref_count, latest_expiry) VALUES (%s, %s, %s)",
                ("test_hash_a", 1, future_30d),
            )
            cur.execute(
                "INSERT INTO game_ref_counts (blake3_hash, ref_count, latest_expiry) VALUES (%s, %s, %s)",
                ("test_hash_b", 2, future_60d),
            )

        result = get_next_expiry()
        assert result is not None
        # Should return the earlier of the two (30d)
        assert abs((result - future_30d).total_seconds()) < 2

    def test_returns_none_when_all_ref_counts_zero(self, pg_conn):
        from app.services.auth_db import get_next_expiry, create_user
        from app.services.pg import get_pg

        create_user("user-1", email="user1@example.com")

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM game_ref_counts")
            cur.execute("DELETE FROM r2_grace_deletions")

        result = get_next_expiry()
        assert result is None

    def test_considers_grace_deletions(self, pg_with_seed_data, profile_db):
        from app.services.auth_db import get_next_expiry, insert_grace_deletion
        from app.services.pg import get_pg

        # Set all ref_counts to 0 so grace deletion is the only source
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE game_ref_counts SET ref_count = 0")

        insert_grace_deletion("hash_grace", grace_days=1)

        result = get_next_expiry()
        assert result is not None
        expected = datetime.now(timezone.utc) + timedelta(days=1)
        assert abs((result - expected).total_seconds()) < 5


# ---------------------------------------------------------------------------
# Integration: has_remaining_refs
# ---------------------------------------------------------------------------

class TestHasRemainingRefsIntegration:
    def test_true_when_ref_count_positive(self, pg_with_seed_data, profile_db):
        from app.services.auth_db import has_remaining_refs
        # hash_a has ref_count = 2 from seed data migration
        assert has_remaining_refs("hash_a") is True

    def test_false_when_ref_count_zero(self, pg_with_seed_data, profile_db):
        from app.services.auth_db import has_remaining_refs
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE game_ref_counts SET ref_count = 0 WHERE blake3_hash = %s", ("hash_a",))

        assert has_remaining_refs("hash_a") is False

    def test_false_when_hash_not_in_table(self, pg_with_seed_data, profile_db):
        from app.services.auth_db import has_remaining_refs
        assert has_remaining_refs("nonexistent_hash") is False
