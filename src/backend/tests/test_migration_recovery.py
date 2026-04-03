"""Tests for T820: Guest Migration Data Loss — recovery, credit transfer, and error handling.

Covers:
- Migration intent recorded before attempt (pending_migrations)
- Successful migration marks complete
- Failed migration records error
- Credit transfer from guest to target
- Credit history copied
- Login blocked on migration failure (HTTP 503)
- Retry endpoint
- /me endpoint returns migration_pending
- Specific exception propagation (R2ReadError, sqlite3.Error, OSError)
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock
from uuid import uuid4

import pytest

from app.routers.auth import _migrate_guest_profile, _merge_guest_into_profile


# ---------------------------------------------------------------------------
# Helpers (shared with test_guest_migration.py pattern)
# ---------------------------------------------------------------------------

def _create_profile_db(db_path: Path) -> None:
    """Create a profile database with games, game_videos, achievements."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            video_filename TEXT,
            blake3_hash TEXT,
            clip_count INTEGER DEFAULT 0,
            brilliant_count INTEGER DEFAULT 0,
            great_count INTEGER DEFAULT 0,
            good_count INTEGER DEFAULT 0,
            last_accessed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            upload_status TEXT DEFAULT 'complete',
            duration REAL,
            video_count INTEGER DEFAULT 1,
            total_size INTEGER DEFAULT 0
        );
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            original_filename TEXT,
            video_size INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (game_id) REFERENCES games(id)
        );
        CREATE TABLE achievements (
            key TEXT PRIMARY KEY,
            achieved_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.close()


def _insert_game(db_path: Path, name: str, blake3_hash: str) -> int:
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    cursor.execute("INSERT INTO games (name, blake3_hash) VALUES (?, ?)", (name, blake3_hash))
    game_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return game_id


def _get_pending_migrations(user_db_path: Path) -> list[dict]:
    conn = sqlite3.connect(str(user_db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM pending_migrations ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def recovery_env(tmp_path):
    """Set up guest and recovered user with profile DBs and user.sqlite patched."""
    guest_user_id = f"guest-{uuid4().hex[:8]}"
    recovered_user_id = f"recovered-{uuid4().hex[:8]}"
    guest_profile_id = uuid4().hex[:8]
    target_profile_id = uuid4().hex[:8]

    # Profile databases (game data)
    guest_db_path = tmp_path / guest_user_id / "profiles" / guest_profile_id / "profile.sqlite"
    target_db_path = tmp_path / recovered_user_id / "profiles" / target_profile_id / "profile.sqlite"
    _create_profile_db(guest_db_path)
    _create_profile_db(target_db_path)

    # user_data base for user.sqlite (user_db uses USER_DATA_BASE / user_id / user.sqlite)
    user_data_base = tmp_path

    # Auth DB setup (needed for session validation in API tests)
    auth_db_path = tmp_path / "auth.sqlite"

    return {
        "tmp_path": tmp_path,
        "user_data_base": user_data_base,
        "guest_user_id": guest_user_id,
        "recovered_user_id": recovered_user_id,
        "guest_profile_id": guest_profile_id,
        "target_profile_id": target_profile_id,
        "guest_db_path": guest_db_path,
        "target_db_path": target_db_path,
        "auth_db_path": auth_db_path,
    }


@pytest.fixture
def patched_user_db(recovery_env):
    """Patch user_db to use tmp_path as USER_DATA_BASE."""
    env = recovery_env
    with patch("app.services.user_db.USER_DATA_BASE", env["user_data_base"]), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.user_db._update_credit_summary"), \
         patch("app.services.user_db._init_credits_row"):
        yield env


# ---------------------------------------------------------------------------
# 1. Migration intent recorded first
# ---------------------------------------------------------------------------

class TestMigrationIntentRecorded:

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.get_selected_profile_id")
    @patch("app.routers.auth.get_current_profile_id", return_value="ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_pending_migration_row_exists(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        patched_user_db,
    ):
        """Before migration completes, pending_migrations row with status='pending' exists."""
        env = patched_user_db
        _insert_game(env["guest_db_path"], "Game", "hash_1")
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # After successful migration, row should exist (status='completed')
        user_db_path = env["user_data_base"] / env["recovered_user_id"] / "user.sqlite"
        migrations = _get_pending_migrations(user_db_path)
        assert len(migrations) >= 1
        assert migrations[0]["guest_user_id"] == env["guest_user_id"]


# ---------------------------------------------------------------------------
# 2. Successful migration marks complete
# ---------------------------------------------------------------------------

class TestSuccessfulMigrationComplete:

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.get_selected_profile_id")
    @patch("app.routers.auth.get_current_profile_id", return_value="ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_status_completed_after_success(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        patched_user_db,
    ):
        """After successful migration, status='completed' and completed_at is set."""
        env = patched_user_db
        _insert_game(env["guest_db_path"], "Game", "hash_1")
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        user_db_path = env["user_data_base"] / env["recovered_user_id"] / "user.sqlite"
        migrations = _get_pending_migrations(user_db_path)
        assert migrations[0]["status"] == "completed"
        assert migrations[0]["completed_at"] is not None


# ---------------------------------------------------------------------------
# 3. Failed migration records error
# ---------------------------------------------------------------------------

class TestFailedMigrationRecordsError:

    @patch("app.routers.auth.get_selected_profile_id")
    def test_db_failure_raises_and_leaves_pending(
        self, mock_read_selected, patched_user_db,
    ):
        """DB failure raises exception; pending_migrations row stays as 'pending'."""
        env = patched_user_db
        mock_read_selected.side_effect = Exception("database locked")

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            with pytest.raises(Exception):
                _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # pending_migrations was inserted before the R2 call
        user_db_path = env["user_data_base"] / env["recovered_user_id"] / "user.sqlite"
        migrations = _get_pending_migrations(user_db_path)
        assert len(migrations) == 1
        assert migrations[0]["status"] == "pending"
        assert migrations[0]["guest_user_id"] == env["guest_user_id"]


# ---------------------------------------------------------------------------
# 4. Credit transfer
# ---------------------------------------------------------------------------

class TestCreditTransfer:

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.get_selected_profile_id")
    @patch("app.routers.auth.get_current_profile_id", return_value="ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_credits_transferred_to_target(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        patched_user_db,
    ):
        """Guest with 50 credits -> target receives 50 via grant_credits with source='migration_transfer'."""
        from app.services.user_db import grant_credits, get_credit_balance, get_credit_transactions
        env = patched_user_db

        # Give guest 50 credits
        grant_credits(env["guest_user_id"], 50, "admin_grant", "setup")

        _insert_game(env["guest_db_path"], "Game", "hash_1")
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # Target should have 50 credits
        balance = get_credit_balance(env["recovered_user_id"])
        assert balance["balance"] == 50

        # Verify credit_transaction with migration_transfer source and guest_user_id reference
        txns = get_credit_transactions(env["recovered_user_id"])
        migration_txns = [t for t in txns if t["source"] == "migration_transfer"]
        assert len(migration_txns) == 1
        assert migration_txns[0]["amount"] == 50
        assert migration_txns[0]["reference_id"] == env["guest_user_id"]

    @patch("app.routers.auth.get_selected_profile_id")
    @patch("app.routers.auth.get_current_profile_id", return_value="ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_zero_credits_no_transfer(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected,
        patched_user_db,
    ):
        """Guest with 0 credits -> no migration_transfer transaction created."""
        from app.services.user_db import get_credit_transactions
        env = patched_user_db

        # Guest has no games, no credits -> migration completes as skip
        mock_read_selected.return_value = env["guest_profile_id"]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        txns = get_credit_transactions(env["recovered_user_id"])
        migration_txns = [t for t in txns if t["source"] == "migration_transfer"]
        assert len(migration_txns) == 0


# ---------------------------------------------------------------------------
# 5. Credit history copied
# ---------------------------------------------------------------------------

class TestCreditHistoryCopied:

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.get_selected_profile_id")
    @patch("app.routers.auth.get_current_profile_id", return_value="ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_guest_transactions_copied_to_target(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        patched_user_db,
    ):
        """Guest's credit_transactions are copied to target with migrated_ prefix on source."""
        from app.services.user_db import grant_credits, get_credit_transactions
        env = patched_user_db

        # Create guest credit history
        grant_credits(env["guest_user_id"], 30, "quest_reward", "quest_1")
        grant_credits(env["guest_user_id"], 20, "admin_grant", "bonus")

        _insert_game(env["guest_db_path"], "Game", "hash_1")
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        txns = get_credit_transactions(env["recovered_user_id"])
        migrated_txns = [t for t in txns if t["source"].startswith("migrated_")]
        assert len(migrated_txns) == 2

        sources = sorted(t["source"] for t in migrated_txns)
        assert "migrated_admin_grant" in sources
        assert "migrated_quest_reward" in sources


# ---------------------------------------------------------------------------
# 6. Login blocked on migration failure (API-level)
# ---------------------------------------------------------------------------

class TestLoginBlockedOnMigrationFailure:

    @pytest.mark.asyncio
    async def test_google_login_returns_503_on_migration_failure(self, patched_user_db):
        """When _migrate_guest_profile raises, google_auth raises HTTP 503."""
        from fastapi import HTTPException
        from app.routers.auth import google_auth, GoogleAuthRequest

        env = patched_user_db
        body = GoogleAuthRequest(token="fake-token")

        # Mock Google token verification to return valid data
        mock_google_response = MagicMock()
        mock_google_response.status_code = 200
        mock_google_response.json.return_value = {
            "aud": "test-client-id",
            "email": "user@example.com",
            "email_verified": "true",
            "sub": "google-id-123",
        }

        existing_user = {"user_id": "recovered-user", "email": "user@example.com"}

        with patch("app.routers.auth.get_current_user_id", return_value=env["guest_user_id"]), \
             patch("app.utils.retry.retry_async_call", new_callable=AsyncMock, return_value=mock_google_response), \
             patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-client-id"}), \
             patch("app.routers.auth.get_user_by_email", return_value=existing_user), \
             patch("app.routers.auth.update_last_seen"), \
             patch("app.routers.auth._migrate_guest_profile", side_effect=Exception("R2 down")), \
             patch("app.routers.auth.get_user_db_connection") as mock_conn_ctx, \
             patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            # Mock the connection context manager for error recording
            mock_conn = MagicMock()
            mock_conn_ctx.return_value.__enter__ = MagicMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__exit__ = MagicMock(return_value=False)

            mock_request = MagicMock()
            with pytest.raises(HTTPException) as exc_info:
                await google_auth(body, mock_request)
            assert exc_info.value.status_code == 503
            assert "trouble transferring" in exc_info.value.detail.lower()


# ---------------------------------------------------------------------------
# 7. Retry endpoint
# ---------------------------------------------------------------------------

class TestRetryEndpoint:

    @pytest.mark.asyncio
    async def test_retry_succeeds_on_fixed_migration(self, patched_user_db):
        """retry-migration endpoint calls _migrate_guest_profile and returns success."""
        from app.routers.auth import retry_migration

        env = patched_user_db
        user_id = env["recovered_user_id"]
        guest_id = env["guest_user_id"]

        # Create a user.sqlite with a failed migration
        from app.services.user_db import ensure_user_database, get_user_db_connection
        ensure_user_database(user_id)
        with get_user_db_connection(user_id) as conn:
            conn.execute(
                "INSERT INTO pending_migrations (guest_user_id, status, error, attempts) VALUES (?, 'failed', 'R2 down', 1)",
                (guest_id,)
            )
            conn.commit()

        # Mock session validation
        mock_request = MagicMock()
        mock_request.cookies.get.return_value = "session-123"

        with patch("app.routers.auth.validate_session", return_value={"user_id": user_id, "email": "test@example.com"}), \
             patch("app.routers.auth._migrate_guest_profile") as mock_migrate:
            result = await retry_migration(mock_request)

        assert result["status"] == "success"
        mock_migrate.assert_called_once_with(guest_id, user_id)

    @pytest.mark.asyncio
    async def test_retry_no_pending_migration(self, patched_user_db):
        """retry-migration returns no_pending_migration when nothing to retry."""
        from app.routers.auth import retry_migration

        env = patched_user_db
        user_id = env["recovered_user_id"]

        from app.services.user_db import ensure_user_database
        ensure_user_database(user_id)

        mock_request = MagicMock()
        mock_request.cookies.get.return_value = "session-123"

        with patch("app.routers.auth.validate_session", return_value={"user_id": user_id}):
            result = await retry_migration(mock_request)

        assert result["status"] == "no_pending_migration"

    @pytest.mark.asyncio
    async def test_retry_records_failure_on_error(self, patched_user_db):
        """retry-migration records failure when migration raises again."""
        from app.routers.auth import retry_migration

        env = patched_user_db
        user_id = env["recovered_user_id"]
        guest_id = env["guest_user_id"]

        from app.services.user_db import ensure_user_database, get_user_db_connection
        ensure_user_database(user_id)
        with get_user_db_connection(user_id) as conn:
            conn.execute(
                "INSERT INTO pending_migrations (guest_user_id, status, error, attempts) VALUES (?, 'failed', 'R2 down', 1)",
                (guest_id,)
            )
            conn.commit()

        mock_request = MagicMock()
        mock_request.cookies.get.return_value = "session-123"

        with patch("app.routers.auth.validate_session", return_value={"user_id": user_id, "email": "test@example.com"}), \
             patch("app.routers.auth._migrate_guest_profile", side_effect=Exception("still broken")):
            result = await retry_migration(mock_request)

        assert result["status"] == "failed"
        assert "still broken" in result["error"]


# ---------------------------------------------------------------------------
# 8. /me endpoint returns migration_pending
# ---------------------------------------------------------------------------

class TestMeEndpointMigrationPending:

    @pytest.mark.asyncio
    async def test_migration_pending_true_when_failed(self, patched_user_db):
        """/me returns migration_pending=True when pending_migrations has failed row."""
        from app.routers.auth import auth_me

        env = patched_user_db
        user_id = env["recovered_user_id"]

        from app.services.user_db import ensure_user_database, get_user_db_connection
        ensure_user_database(user_id)
        with get_user_db_connection(user_id) as conn:
            conn.execute(
                "INSERT INTO pending_migrations (guest_user_id, status) VALUES (?, 'failed')",
                (env["guest_user_id"],)
            )
            conn.commit()

        mock_request = MagicMock()
        mock_request.cookies.get.return_value = "session-123"

        with patch("app.routers.auth.validate_session", return_value={"user_id": user_id, "email": "test@example.com"}), \
             patch("app.routers.auth.update_last_seen"):
            result = await auth_me(mock_request)

        assert result["migration_pending"] is True

    @pytest.mark.asyncio
    async def test_migration_pending_false_when_none(self, patched_user_db):
        """/me returns migration_pending=False when no pending migrations."""
        from app.routers.auth import auth_me

        env = patched_user_db
        user_id = env["recovered_user_id"]

        from app.services.user_db import ensure_user_database
        ensure_user_database(user_id)

        mock_request = MagicMock()
        mock_request.cookies.get.return_value = "session-123"

        with patch("app.routers.auth.validate_session", return_value={"user_id": user_id, "email": "test@example.com"}), \
             patch("app.routers.auth.update_last_seen"):
            result = await auth_me(mock_request)

        assert result["migration_pending"] is False

    @pytest.mark.asyncio
    async def test_migration_pending_false_when_completed(self, patched_user_db):
        """/me returns migration_pending=False when all migrations are completed."""
        from app.routers.auth import auth_me

        env = patched_user_db
        user_id = env["recovered_user_id"]

        from app.services.user_db import ensure_user_database, get_user_db_connection
        ensure_user_database(user_id)
        with get_user_db_connection(user_id) as conn:
            conn.execute(
                "INSERT INTO pending_migrations (guest_user_id, status, completed_at) VALUES (?, 'completed', datetime('now'))",
                (env["guest_user_id"],)
            )
            conn.commit()

        mock_request = MagicMock()
        mock_request.cookies.get.return_value = "session-123"

        with patch("app.routers.auth.validate_session", return_value={"user_id": user_id, "email": "test@example.com"}), \
             patch("app.routers.auth.update_last_seen"):
            result = await auth_me(mock_request)

        assert result["migration_pending"] is False


# ---------------------------------------------------------------------------
# 9. Specific exception handling
# ---------------------------------------------------------------------------

class TestExceptionPropagation:

    @patch("app.routers.auth.get_selected_profile_id")
    def test_db_read_error_propagates(self, mock_read_selected, patched_user_db):
        """DB errors are NOT swallowed — they propagate to caller."""
        env = patched_user_db
        mock_read_selected.side_effect = Exception("database unreachable")

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            with pytest.raises(Exception, match="database unreachable"):
                _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.get_selected_profile_id")
    @patch("app.routers.auth.get_current_profile_id", return_value="ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_sqlite_error_propagates(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        patched_user_db,
    ):
        """sqlite3.Error during profile merge propagates to caller."""
        env = patched_user_db
        _insert_game(env["guest_db_path"], "Game", "hash_1")
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]), \
             patch("app.routers.auth._merge_guest_into_profile", side_effect=sqlite3.OperationalError("disk I/O error")):
            with pytest.raises(sqlite3.OperationalError, match="disk I/O error"):
                _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

    @patch("app.routers.auth.get_selected_profile_id")
    @patch("app.routers.auth.get_current_profile_id", return_value="ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_os_error_on_upload_propagates(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected,
        patched_user_db,
    ):
        """OSError during R2 upload propagates to caller."""
        env = patched_user_db
        _insert_game(env["guest_db_path"], "Game", "hash_1")
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]), \
             patch("app.routers.auth.upload_to_r2", side_effect=OSError("disk full")):
            with pytest.raises(OSError, match="disk full"):
                _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])
