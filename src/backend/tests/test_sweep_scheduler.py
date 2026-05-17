"""
Tests for app.services.sweep_scheduler — background cleanup sweep loop.

Covers do_sweep, _find_games_for_hash, start/stop lifecycle,
_run_sweep_loop delay calculation, keepalive, and error handling.
"""

import asyncio
import sqlite3
import time
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock, AsyncMock

M = "app.services.sweep_scheduler"

USER_ID = "test-user-1"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def isolated_profile_db(tmp_path):
    """Create isolated profile.sqlite with games + game_videos + game_storage tables."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    db_dir = tmp_path / USER_ID / "profiles" / PROFILE_ID
    db_dir.mkdir(parents=True)
    db_path = db_dir / "profile.sqlite"

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            blake3_hash TEXT,
            auto_export_status TEXT,
            recap_video_url TEXT,
            status TEXT DEFAULT 'ready',
            video_filename TEXT,
            video_size INTEGER,
            video_duration REAL,
            video_width INTEGER,
            video_height INTEGER,
            video_fps REAL,
            opponent_name TEXT,
            game_date TEXT,
            game_type TEXT,
            tournament_name TEXT,
            viewed_duration REAL DEFAULT 0,
            clip_count INTEGER DEFAULT 0,
            brilliant_count INTEGER DEFAULT 0,
            good_count INTEGER DEFAULT 0,
            interesting_count INTEGER DEFAULT 0,
            mistake_count INTEGER DEFAULT 0,
            blunder_count INTEGER DEFAULT 0,
            aggregate_score INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            UNIQUE(game_id, sequence)
        );
        CREATE TABLE game_storage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blake3_hash TEXT NOT NULL UNIQUE,
            game_size_bytes INTEGER NOT NULL,
            storage_expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    conn.close()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", {USER_ID}), \
         patch("app.database.R2_ENABLED", False):
        yield {"db_path": db_path, "tmp_path": tmp_path}


def _insert_game(db_path, blake3_hash="abc123", status=None):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO games (name, blake3_hash, auto_export_status) VALUES ('Game', ?, ?)",
        (blake3_hash, status),
    )
    game_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    conn.close()
    return game_id


def _insert_game_video(db_path, game_id, blake3_hash, sequence):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
        (game_id, blake3_hash, sequence),
    )
    conn.commit()
    conn.close()


def _insert_expired_storage(db_path, blake3_hash):
    """Insert an expired game_storage row directly into SQLite."""
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT OR IGNORE INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, 1000, ?)",
        (blake3_hash, past),
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# _find_games_for_hash tests
# ---------------------------------------------------------------------------

class TestFindGamesForHash:
    def test_single_video_game(self, isolated_profile_db):
        from app.services.sweep_scheduler import _find_games_for_hash

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db, blake3_hash="hash_a")
        expired = {"hash_a"}

        result = _find_games_for_hash(USER_ID, PROFILE_ID, "hash_a", expired)
        assert result == {game_id}

    def test_already_exported_game_excluded(self, isolated_profile_db):
        from app.services.sweep_scheduler import _find_games_for_hash

        db = isolated_profile_db["db_path"]
        _insert_game(db, blake3_hash="hash_a", status="complete")

        result = _find_games_for_hash(USER_ID, PROFILE_ID, "hash_a", {"hash_a"})
        assert result == set()

    def test_multi_video_all_expired(self, isolated_profile_db):
        from app.services.sweep_scheduler import _find_games_for_hash

        db = isolated_profile_db["db_path"]
        # Multi-video game has NULL blake3_hash on games table
        game_id = _insert_game(db, blake3_hash=None)
        _insert_game_video(db, game_id, "hash_a", 1)
        _insert_game_video(db, game_id, "hash_b", 2)

        expired = {"hash_a", "hash_b"}
        result = _find_games_for_hash(USER_ID, PROFILE_ID, "hash_a", expired)
        assert game_id in result

    def test_multi_video_partially_expired_excluded(self, isolated_profile_db):
        from app.services.sweep_scheduler import _find_games_for_hash

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db, blake3_hash=None)
        _insert_game_video(db, game_id, "hash_a", 1)
        _insert_game_video(db, game_id, "hash_b", 2)

        expired = {"hash_a"}  # hash_b not expired
        result = _find_games_for_hash(USER_ID, PROFILE_ID, "hash_a", expired)
        assert game_id not in result

    def test_no_matching_games(self, isolated_profile_db):
        from app.services.sweep_scheduler import _find_games_for_hash

        result = _find_games_for_hash(USER_ID, PROFILE_ID, "nonexistent", {"nonexistent"})
        assert result == set()


# ---------------------------------------------------------------------------
# do_sweep tests
# ---------------------------------------------------------------------------

class TestDoSweep:
    @patch(f"{M}.get_expired_grace_deletions", return_value=[])
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}])
    def test_no_expired_refs(self, mock_users, mock_profiles, mock_expired, mock_grace, isolated_profile_db):
        from app.services.sweep_scheduler import do_sweep

        do_sweep()
        mock_expired.assert_called_once()

    @patch(f"{M}.get_expired_grace_deletions", return_value=[])
    @patch(f"{M}.insert_grace_deletion")
    @patch(f"{M}.has_remaining_refs", return_value=False)
    @patch(f"{M}.delete_ref")
    @patch(f"{M}.auto_export_game", return_value="complete")
    @patch(f"{M}.ensure_database")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[{"blake3_hash": "hash_abc"}])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}])
    def test_sweep_processes_ref(
        self, mock_users, mock_profiles, mock_expired, mock_ensure, mock_export,
        mock_delete_ref, mock_has_remaining, mock_insert_grace,
        mock_grace_expired, isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep, GRACE_PERIOD_DAYS

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db, blake3_hash="hash_abc")

        do_sweep()

        mock_export.assert_called_once_with(USER_ID, PROFILE_ID, game_id)
        mock_delete_ref.assert_called_once_with(USER_ID, PROFILE_ID, "hash_abc")
        mock_insert_grace.assert_called_once_with("hash_abc", GRACE_PERIOD_DAYS)

    @patch(f"{M}.get_expired_grace_deletions", return_value=[])
    @patch(f"{M}.insert_grace_deletion")
    @patch(f"{M}.has_remaining_refs", return_value=True)
    @patch(f"{M}.delete_ref")
    @patch(f"{M}.auto_export_game", return_value="complete")
    @patch(f"{M}.ensure_database")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[{"blake3_hash": "hash_abc"}])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}])
    def test_sweep_skips_grace_when_refs_remain(
        self, mock_users, mock_profiles, mock_expired, mock_ensure, mock_export,
        mock_delete_ref, mock_has_remaining, mock_insert_grace,
        mock_grace_expired, isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep

        db = isolated_profile_db["db_path"]
        _insert_game(db, blake3_hash="hash_abc")

        do_sweep()

        mock_delete_ref.assert_called_once()
        mock_insert_grace.assert_not_called()

    @patch(f"{M}.get_expired_grace_deletions", return_value=[])
    @patch(f"{M}.insert_grace_deletion")
    @patch(f"{M}.has_remaining_refs", return_value=False)
    @patch(f"{M}.delete_ref")
    @patch(f"{M}.auto_export_game", side_effect=RuntimeError("boom"))
    @patch(f"{M}.ensure_database")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[{"blake3_hash": "hash_abc"}])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}])
    def test_sweep_continues_on_export_failure(
        self, mock_users, mock_profiles, mock_expired, mock_ensure, mock_export,
        mock_delete_ref, mock_has_remaining, mock_insert_grace,
        mock_grace_expired, isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep

        db = isolated_profile_db["db_path"]
        _insert_game(db, blake3_hash="hash_abc")

        do_sweep()

        mock_delete_ref.assert_called_once()
        mock_insert_grace.assert_called_once()

    @patch(f"{M}.delete_grace_deletion")
    @patch(f"{M}.r2_delete_object_global")
    @patch(f"{M}.get_expired_grace_deletions", return_value=["hash_old1", "hash_old2"])
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}])
    def test_sweep_grace_phase_deletes_expired(
        self, mock_users, mock_profiles, mock_expired_refs, mock_grace_expired,
        mock_r2_delete, mock_del_grace, isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep

        do_sweep()

        assert mock_r2_delete.call_count == 2
        mock_r2_delete.assert_any_call("games/hash_old1.mp4")
        mock_r2_delete.assert_any_call("games/hash_old2.mp4")
        assert mock_del_grace.call_count == 2

    @patch(f"{M}.delete_grace_deletion")
    @patch(f"{M}.r2_delete_object_global")
    @patch(f"{M}.get_expired_grace_deletions", return_value=[])
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}])
    def test_sweep_grace_phase_empty(
        self, mock_users, mock_profiles, mock_expired_refs, mock_grace_expired,
        mock_r2_delete, mock_del_grace, isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep

        do_sweep()

        mock_r2_delete.assert_not_called()
        mock_del_grace.assert_not_called()

    @patch(f"{M}.get_expired_grace_deletions", return_value=[])
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}])
    def test_sweep_timing_logged(self, mock_users, mock_profiles, mock_expired, mock_grace, isolated_profile_db, caplog):
        import logging
        from app.services.sweep_scheduler import do_sweep

        with caplog.at_level(logging.INFO, logger="app.services.sweep_scheduler"):
            do_sweep()

        assert "Complete in" in caplog.text

    @patch(f"{M}.get_expired_grace_deletions", return_value=[])
    @patch(f"{M}.insert_grace_deletion")
    @patch(f"{M}.has_remaining_refs", return_value=False)
    @patch(f"{M}.delete_ref")
    @patch(f"{M}.auto_export_game", return_value="complete")
    @patch(f"{M}.ensure_database")
    @patch(f"{M}.get_expired_refs_for_profile", return_value=[{"blake3_hash": "hash_abc"}])
    @patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID])
    @patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}])
    def test_sweep_logs_game_count(
        self, mock_users, mock_profiles, mock_expired, mock_ensure, mock_export,
        mock_delete_ref, mock_has_remaining, mock_insert_grace,
        mock_grace_expired, isolated_profile_db, caplog
    ):
        import logging
        from app.services.sweep_scheduler import do_sweep

        db = isolated_profile_db["db_path"]
        _insert_game(db, blake3_hash="hash_abc")

        with caplog.at_level(logging.INFO, logger="app.services.sweep_scheduler"):
            do_sweep()

        assert "expired refs" in caplog.text


# ---------------------------------------------------------------------------
# start/stop sweep loop tests
# ---------------------------------------------------------------------------

class TestSweepLoopLifecycle:
    @pytest.mark.asyncio
    async def test_start_creates_task(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        with patch.object(sched, "_run_sweep_loop", new_callable=AsyncMock) as mock_loop:
            await sched.start_sweep_loop()
            assert sched._sweep_task is not None

            # Clean up
            await sched.stop_sweep_loop()
            assert sched._sweep_task is None

    @pytest.mark.asyncio
    async def test_stop_when_no_task(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        sched._sweep_task = None
        await sched.stop_sweep_loop()  # Should not raise
        assert sched._sweep_task is None

    @pytest.mark.asyncio
    async def test_stop_cancels_running_task(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        async def _fake_loop():
            await asyncio.sleep(3600)

        sched._sweep_task = asyncio.create_task(_fake_loop())
        await sched.stop_sweep_loop()
        assert sched._sweep_task is None


# ---------------------------------------------------------------------------
# _ping_health tests
# ---------------------------------------------------------------------------

class TestPingHealth:
    @pytest.mark.asyncio
    async def test_ping_health_calls_urlopen(self, isolated_profile_db):
        """Verify _ping_health pings the health endpoint."""
        import app.services.sweep_scheduler as sched

        call_count = 0

        async def _mock_sleep(delay):
            nonlocal call_count
            call_count += 1
            if call_count >= 2:
                raise asyncio.CancelledError()

        with patch("urllib.request.urlopen") as mock_urlopen, \
             patch("asyncio.sleep", side_effect=_mock_sleep):
            try:
                await sched._ping_health()
            except asyncio.CancelledError:
                pass

        mock_urlopen.assert_called_with("http://localhost:8000/api/health", timeout=5)

    @pytest.mark.asyncio
    async def test_ping_health_continues_on_exception(self, isolated_profile_db):
        """Ping health continues even if urlopen raises."""
        import app.services.sweep_scheduler as sched

        call_count = 0

        async def _mock_sleep(delay):
            nonlocal call_count
            call_count += 1
            if call_count >= 3:
                raise asyncio.CancelledError()

        with patch("urllib.request.urlopen", side_effect=ConnectionError("refused")), \
             patch("asyncio.sleep", side_effect=_mock_sleep):
            try:
                await sched._ping_health()
            except asyncio.CancelledError:
                pass

        # Should have looped multiple times despite errors
        assert call_count >= 2


# ---------------------------------------------------------------------------
# _run_sweep_loop delay calculation tests
# ---------------------------------------------------------------------------

class TestRunSweepLoop:
    @pytest.mark.asyncio
    async def test_loop_uses_max_delay_when_no_expiry(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        with patch.object(sched, "do_sweep"), \
             patch.object(sched, "get_next_expiry", return_value=None), \
             patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", new_callable=AsyncMock), \
             patch("asyncio.create_task") as mock_create_task:
            mock_task = MagicMock()
            mock_create_task.return_value = mock_task
            await sched._run_sweep_loop()

        assert sleep_delays[0] == sched.STARTUP_DELAY
        assert sleep_delays[1] == sched.MAX_DELAY

    @pytest.mark.asyncio
    async def test_loop_clamps_delay_to_min(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        past = datetime.now(timezone.utc) - timedelta(hours=1)
        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        with patch.object(sched, "do_sweep"), \
             patch.object(sched, "get_next_expiry", return_value=past), \
             patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", new_callable=AsyncMock), \
             patch("asyncio.create_task") as mock_create_task:
            mock_task = MagicMock()
            mock_create_task.return_value = mock_task
            await sched._run_sweep_loop()

        assert sleep_delays[1] == sched.MIN_DELAY

    @pytest.mark.asyncio
    async def test_loop_clamps_delay_to_max(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        future = datetime.now(timezone.utc) + timedelta(hours=48)
        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        with patch.object(sched, "do_sweep"), \
             patch.object(sched, "get_next_expiry", return_value=future), \
             patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", new_callable=AsyncMock), \
             patch("asyncio.create_task") as mock_create_task:
            mock_task = MagicMock()
            mock_create_task.return_value = mock_task
            await sched._run_sweep_loop()

        assert sleep_delays[1] == sched.MAX_DELAY

    @pytest.mark.asyncio
    async def test_loop_retries_on_exception(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        async def _mock_to_thread(fn, *args):
            raise RuntimeError("sweep failed")

        with patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", side_effect=_mock_to_thread), \
             patch("asyncio.create_task") as mock_create_task:
            mock_task = MagicMock()
            mock_create_task.return_value = mock_task
            try:
                await sched._run_sweep_loop()
            except asyncio.CancelledError:
                pass

        # After exception: retry delay is 3600s
        assert sleep_delays[1] == 3600

    @pytest.mark.asyncio
    async def test_loop_normal_delay(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        future = datetime.now(timezone.utc) + timedelta(hours=2)
        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        with patch.object(sched, "do_sweep"), \
             patch.object(sched, "get_next_expiry", return_value=future), \
             patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", new_callable=AsyncMock), \
             patch("asyncio.create_task") as mock_create_task:
            mock_task = MagicMock()
            mock_create_task.return_value = mock_task
            await sched._run_sweep_loop()

        # ~2 hours = ~7200s
        assert sched.MIN_DELAY <= sleep_delays[1] <= sched.MAX_DELAY

    @pytest.mark.asyncio
    async def test_loop_creates_and_cancels_keepalive(self, isolated_profile_db):
        """Verify the keepalive task is created before sweep and cancelled after."""
        import app.services.sweep_scheduler as sched

        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        with patch.object(sched, "do_sweep"), \
             patch.object(sched, "get_next_expiry", return_value=None), \
             patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", new_callable=AsyncMock), \
             patch("asyncio.create_task") as mock_create_task:
            mock_task = MagicMock()
            mock_create_task.return_value = mock_task
            await sched._run_sweep_loop()

        mock_create_task.assert_called()
        mock_task.cancel.assert_called()
