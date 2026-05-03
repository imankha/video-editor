"""
Tests for app.services.sweep_scheduler — background cleanup sweep loop.

Covers do_sweep, _find_games_for_hash, start/stop lifecycle,
_run_sweep_loop delay calculation, and error handling.
"""

import asyncio
import sqlite3
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, AsyncMock

M = "app.services.sweep_scheduler"

USER_ID = "test-user-1"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def isolated_profile_db(tmp_path):
    """Create isolated profile.sqlite with games + game_videos tables."""
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
            storage_expires_at TEXT,
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
    @patch(f"{M}.get_expired_refs", return_value=[])
    def test_no_expired_refs(self, mock_expired, isolated_profile_db):
        from app.services.sweep_scheduler import do_sweep

        do_sweep()
        mock_expired.assert_called_once()

    @patch(f"{M}.has_remaining_refs", return_value=False)
    @patch(f"{M}.r2_delete_object_global")
    @patch(f"{M}.delete_ref")
    @patch(f"{M}.auto_export_game", return_value="complete")
    @patch(f"{M}.ensure_database")
    @patch(f"{M}.get_expired_refs", return_value=[
        {"user_id": USER_ID, "profile_id": PROFILE_ID, "blake3_hash": "hash_abc"}
    ])
    def test_sweep_processes_ref(
        self, mock_expired, mock_ensure, mock_export,
        mock_delete_ref, mock_r2_delete, mock_has_remaining,
        isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db, blake3_hash="hash_abc")

        do_sweep()

        mock_export.assert_called_once_with(USER_ID, PROFILE_ID, game_id)
        mock_delete_ref.assert_called_once_with(USER_ID, PROFILE_ID, "hash_abc")
        mock_r2_delete.assert_called_once_with("games/hash_abc.mp4")

    @patch(f"{M}.has_remaining_refs", return_value=True)
    @patch(f"{M}.r2_delete_object_global")
    @patch(f"{M}.delete_ref")
    @patch(f"{M}.auto_export_game", return_value="complete")
    @patch(f"{M}.ensure_database")
    @patch(f"{M}.get_expired_refs", return_value=[
        {"user_id": USER_ID, "profile_id": PROFILE_ID, "blake3_hash": "hash_abc"}
    ])
    def test_sweep_skips_r2_delete_when_refs_remain(
        self, mock_expired, mock_ensure, mock_export,
        mock_delete_ref, mock_r2_delete, mock_has_remaining,
        isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep

        db = isolated_profile_db["db_path"]
        _insert_game(db, blake3_hash="hash_abc")

        do_sweep()

        mock_delete_ref.assert_called_once()
        mock_r2_delete.assert_not_called()

    @patch(f"{M}.has_remaining_refs", return_value=False)
    @patch(f"{M}.r2_delete_object_global")
    @patch(f"{M}.delete_ref")
    @patch(f"{M}.auto_export_game", side_effect=RuntimeError("boom"))
    @patch(f"{M}.ensure_database")
    @patch(f"{M}.get_expired_refs", return_value=[
        {"user_id": USER_ID, "profile_id": PROFILE_ID, "blake3_hash": "hash_abc"}
    ])
    def test_sweep_continues_on_export_failure(
        self, mock_expired, mock_ensure, mock_export,
        mock_delete_ref, mock_r2_delete, mock_has_remaining,
        isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep

        db = isolated_profile_db["db_path"]
        _insert_game(db, blake3_hash="hash_abc")

        do_sweep()

        mock_delete_ref.assert_called_once()
        mock_r2_delete.assert_called_once()

    @patch(f"{M}.has_remaining_refs", return_value=False)
    @patch(f"{M}.r2_delete_object_global")
    @patch(f"{M}.delete_ref")
    @patch(f"{M}.auto_export_game", return_value="skipped")
    @patch(f"{M}.ensure_database")
    @patch(f"{M}.get_expired_refs", return_value=[
        {"user_id": "user-a", "profile_id": "prof-a", "blake3_hash": "hash_xyz"},
        {"user_id": "user-b", "profile_id": "prof-b", "blake3_hash": "hash_xyz"},
    ])
    def test_sweep_processes_each_ref_independently(
        self, mock_expired, mock_ensure, mock_export,
        mock_delete_ref, mock_r2_delete, mock_has_remaining,
        isolated_profile_db
    ):
        from app.services.sweep_scheduler import do_sweep

        do_sweep()

        assert mock_ensure.call_count == 2
        assert mock_delete_ref.call_count == 2


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
# _run_sweep_loop delay calculation tests
# ---------------------------------------------------------------------------

class TestRunSweepLoop:
    """_run_sweep_loop catches CancelledError internally and returns.
    Tests use a mock sleep that raises CancelledError on the 2nd call
    (after startup delay) to break out of the loop, then verify the
    delay value passed to sleep."""

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
             patch("asyncio.to_thread", new_callable=AsyncMock):
            await sched._run_sweep_loop()

        assert sleep_delays[0] == sched.STARTUP_DELAY
        assert sleep_delays[1] == sched.MAX_DELAY

    @pytest.mark.asyncio
    async def test_loop_clamps_delay_to_min(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        past = datetime.utcnow() - timedelta(hours=1)
        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        with patch.object(sched, "do_sweep"), \
             patch.object(sched, "get_next_expiry", return_value=past), \
             patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", new_callable=AsyncMock):
            await sched._run_sweep_loop()

        assert sleep_delays[1] == sched.MIN_DELAY

    @pytest.mark.asyncio
    async def test_loop_clamps_delay_to_max(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        future = datetime.utcnow() + timedelta(hours=48)
        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        with patch.object(sched, "do_sweep"), \
             patch.object(sched, "get_next_expiry", return_value=future), \
             patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", new_callable=AsyncMock):
            await sched._run_sweep_loop()

        assert sleep_delays[1] == sched.MAX_DELAY

    @pytest.mark.asyncio
    async def test_loop_retries_on_exception(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                # CancelledError from the retry sleep (in except block)
                # propagates out of the function since it's not in the try
                raise asyncio.CancelledError()

        async def _mock_to_thread(fn, *args):
            raise RuntimeError("sweep failed")

        with patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", side_effect=_mock_to_thread):
            try:
                await sched._run_sweep_loop()
            except asyncio.CancelledError:
                pass

        # After exception: retry delay is 3600s
        assert sleep_delays[1] == 3600

    @pytest.mark.asyncio
    async def test_loop_normal_delay(self, isolated_profile_db):
        import app.services.sweep_scheduler as sched

        future = datetime.utcnow() + timedelta(hours=2)
        sleep_delays = []

        async def _mock_sleep(delay):
            sleep_delays.append(delay)
            if len(sleep_delays) >= 2:
                raise asyncio.CancelledError()

        with patch.object(sched, "do_sweep"), \
             patch.object(sched, "get_next_expiry", return_value=future), \
             patch("asyncio.sleep", side_effect=_mock_sleep), \
             patch("asyncio.to_thread", new_callable=AsyncMock):
            await sched._run_sweep_loop()

        # ~2 hours = ~7200s
        assert sched.MIN_DELAY <= sleep_delays[1] <= sched.MAX_DELAY
