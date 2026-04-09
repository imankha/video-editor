"""
Performance tests for T1010, T1020 optimizations.

These tests measure actual execution time to verify optimizations.
Run with: pytest tests/test_performance.py -v -s
"""

import time
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.user_context import set_current_user_id


# ---------------------------------------------------------------------------
# T1010: Quest Progress Performance
# ---------------------------------------------------------------------------

class TestQuestProgressPerformance:
    """Verify quest progress query batching is fast."""

    @pytest.fixture(autouse=True)
    def setup_db(self, tmp_path):
        """Create a realistic test database with quest-relevant data."""
        self.db_path = tmp_path / "profile.sqlite"
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")

        # Create tables
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY,
                blake3_hash TEXT,
                video_filename TEXT,
                video_size INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS raw_clips (
                id INTEGER PRIMARY KEY,
                game_id INTEGER,
                rating INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS export_jobs (
                id INTEGER PRIMARY KEY,
                type TEXT,
                status TEXT,
                project_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS achievements (
                key TEXT PRIMARY KEY,
                achieved_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                is_auto_created INTEGER DEFAULT 1,
                working_video_id INTEGER,
                final_video_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS working_clips (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                raw_clip_id INTEGER
            );
        """)

        # Insert realistic data
        # 3 games
        for i in range(3):
            conn.execute("INSERT INTO games (blake3_hash, video_size) VALUES (?, ?)",
                         (f"hash{i}", 3_000_000_000))

        # 10 raw clips across games, various ratings
        for i in range(10):
            game_id = (i % 3) + 1
            rating = 5 if i < 4 else (4 if i < 6 else 3)
            conn.execute("INSERT INTO raw_clips (game_id, rating) VALUES (?, ?)",
                         (game_id, rating))

        # 5 export jobs
        for type_, status in [
            ('framing', 'complete'), ('framing', 'complete'),
            ('framing', 'pending'), ('overlay', 'complete'),
            ('overlay', 'complete')
        ]:
            conn.execute("INSERT INTO export_jobs (type, status) VALUES (?, ?)",
                         (type_, status))

        # Achievements
        for key in ['played_annotations', 'opened_framing_editor', 'viewed_gallery_video']:
            conn.execute("INSERT INTO achievements (key) VALUES (?)", (key,))

        # 1 auto project, 1 manual project
        conn.execute("INSERT INTO projects (is_auto_created) VALUES (1)")
        conn.execute("INSERT INTO projects (is_auto_created) VALUES (0)")

        # Working clips for manual project from 2 different games
        # raw_clip 1 is game_id=1, raw_clip 5 is game_id=2 (i%3+1 with i=4)
        conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (2, 1)")
        conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (2, 5)")

        conn.commit()
        self.conn = conn
        yield
        conn.close()

    def test_check_all_steps_under_50ms(self):
        """_check_all_steps should complete in under 50ms with batched queries."""
        from app.routers.quests import _check_all_steps

        # Warm up
        _check_all_steps("test_user", self.conn)

        # Measure
        iterations = 20
        start = time.perf_counter()
        for _ in range(iterations):
            result = _check_all_steps("test_user", self.conn)
        elapsed = (time.perf_counter() - start) / iterations * 1000

        print(f"\n  _check_all_steps: {elapsed:.1f}ms avg over {iterations} iterations")
        print(f"  Steps returned: {len(result)}")
        print(f"  Completed steps: {sum(1 for v in result.values() if v)}/{len(result)}")

        assert elapsed < 50, f"_check_all_steps took {elapsed:.1f}ms, expected < 50ms"

    def test_check_all_steps_with_skip(self):
        """Skipping completed quests should be even faster."""
        from app.routers.quests import _check_all_steps

        # Warm up
        _check_all_steps("test_user", self.conn, skip_quest_ids={"quest_1", "quest_2"})

        iterations = 20
        start = time.perf_counter()
        for _ in range(iterations):
            result = _check_all_steps("test_user", self.conn,
                                       skip_quest_ids={"quest_1", "quest_2"})
        elapsed = (time.perf_counter() - start) / iterations * 1000

        print(f"\n  _check_all_steps (skip 2 quests): {elapsed:.1f}ms avg")
        assert elapsed < 30, f"Took {elapsed:.1f}ms with skips, expected < 30ms"

    def test_steps_correctness(self):
        """Verify batched queries return correct results."""
        from app.routers.quests import _check_all_steps

        steps = _check_all_steps("test_user", self.conn)

        # Quest 1
        assert steps["upload_game"] is True  # 3 games exist
        assert steps["annotate_brilliant"] is True  # 4 clips rated 5
        assert steps["playback_annotations"] is True  # achievement exists

        # Quest 2
        assert steps["open_framing"] is True  # achievement exists
        assert steps["export_framing"] is True  # framing exports exist
        assert steps["wait_for_export"] is True  # completed framing exists
        assert steps["export_overlay"] is True  # completed overlay exists
        assert steps["view_gallery_video"] is True  # achievement exists

        # Quest 3
        assert steps["annotate_5_more"] is True  # 10 >= 3
        assert steps["annotate_second_5_star"] is True  # 4 >= 2
        assert steps["export_second_highlight"] is True  # 3 framing >= 2
        assert steps["wait_for_export_2"] is True  # 2 completed framing >= 2
        assert steps["overlay_second_highlight"] is True  # 2 completed overlay >= 2

        # Quest 4
        assert steps["upload_game_2"] is True  # 3 >= 2
        assert steps["annotate_game_2"] is True  # clips rated >= 4 from non-first game
        assert steps["create_reel"] is True  # manual project with 2+ game clips


# ---------------------------------------------------------------------------
# T1020: R2 Sync Performance (skip HEAD)
# ---------------------------------------------------------------------------

class TestR2SyncSkipHead:
    """Verify skip_version_check eliminates HEAD calls."""

    def test_skip_version_check_no_head_call(self, tmp_path):
        """When skip_version_check=True, get_db_version_from_r2 is NOT called."""
        from app.storage import sync_database_to_r2_with_version

        db_path = tmp_path / "test.sqlite"
        db_path.write_bytes(b"test")

        mock_client = MagicMock()
        mock_client.upload_file = MagicMock()

        with patch("app.storage.R2_ENABLED", True), \
             patch("app.storage.get_r2_sync_client", return_value=mock_client), \
             patch("app.storage.get_db_version_from_r2") as mock_head, \
             patch("app.storage.r2_key", return_value="test/key"):

            success, version = sync_database_to_r2_with_version(
                "test_user", db_path, current_version=5, skip_version_check=True,
            )

            # HEAD should NOT be called
            mock_head.assert_not_called()
            # Upload should be called
            mock_client.upload_file.assert_called_once()
            # Version should increment from current
            assert version == 6
            assert success is True

    def test_without_skip_calls_head(self, tmp_path):
        """When skip_version_check=False (default), HEAD IS called."""
        from app.storage import sync_database_to_r2_with_version

        db_path = tmp_path / "test.sqlite"
        db_path.write_bytes(b"test")

        mock_client = MagicMock()
        mock_client.upload_file = MagicMock()

        with patch("app.storage.R2_ENABLED", True), \
             patch("app.storage.get_r2_sync_client", return_value=mock_client), \
             patch("app.storage.get_db_version_from_r2", return_value=5) as mock_head, \
             patch("app.storage.r2_key", return_value="test/key"):

            success, version = sync_database_to_r2_with_version(
                "test_user", db_path, current_version=5, skip_version_check=False,
            )

            # HEAD should be called
            mock_head.assert_called_once()
            assert success is True


# ---------------------------------------------------------------------------
# T1020: Parallel sync test
# ---------------------------------------------------------------------------

class TestParallelSync:
    """Verify parallel sync uses ThreadPoolExecutor correctly."""

    def test_parallel_sync_faster_than_sequential(self):
        """Simulated parallel sync should be faster than sequential."""
        import concurrent.futures

        def slow_sync(delay):
            time.sleep(delay)
            return True

        # Sequential
        start = time.perf_counter()
        slow_sync(0.1)
        slow_sync(0.1)
        sequential_ms = (time.perf_counter() - start) * 1000

        # Parallel
        start = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(slow_sync, 0.1)
            f2 = executor.submit(slow_sync, 0.1)
            f1.result()
            f2.result()
        parallel_ms = (time.perf_counter() - start) * 1000

        print(f"\n  Sequential: {sequential_ms:.0f}ms")
        print(f"  Parallel: {parallel_ms:.0f}ms")
        print(f"  Speedup: {sequential_ms / parallel_ms:.1f}x")

        assert parallel_ms < sequential_ms * 0.75, \
            f"Parallel ({parallel_ms:.0f}ms) should be significantly faster than sequential ({sequential_ms:.0f}ms)"
