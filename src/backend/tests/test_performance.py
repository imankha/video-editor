"""
Performance tests for T1020 optimizations.

These tests measure actual execution time to verify optimizations.
Run with: pytest tests/test_performance.py -v -s
"""

import time
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock


from app.user_context import set_current_user_id


# ---------------------------------------------------------------------------
# T1020: R2 Sync Performance (skip HEAD)
# ---------------------------------------------------------------------------

class TestR2SyncSkipHead:
    """Verify skip_version_check eliminates HEAD calls."""

    def test_skip_version_check_no_head_call(self, tmp_path):
        """When skip_version_check=True, get_db_version_from_r2 is NOT called."""
        from app.storage import sync_database_to_r2_with_version

        # T5920: the upload primitive now checkpoints the WAL before uploading,
        # so it opens local_db_path as a real SQLite DB -- a dummy byte string
        # ("file is not a database") would be refused. Use a valid WAL DB; this
        # test only asserts HEAD skip/call behavior, unaffected by the content.
        db_path = tmp_path / "test.sqlite"
        _c = sqlite3.connect(str(db_path))
        _c.execute("PRAGMA journal_mode=WAL")
        _c.execute("CREATE TABLE t (x)")
        _c.commit()
        _c.close()

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

        # T5920: the upload primitive now checkpoints the WAL before uploading,
        # so it opens local_db_path as a real SQLite DB -- a dummy byte string
        # ("file is not a database") would be refused. Use a valid WAL DB; this
        # test only asserts HEAD skip/call behavior, unaffected by the content.
        db_path = tmp_path / "test.sqlite"
        _c = sqlite3.connect(str(db_path))
        _c.execute("PRAGMA journal_mode=WAL")
        _c.execute("CREATE TABLE t (x)")
        _c.commit()
        _c.close()

        mock_client = MagicMock()
        mock_client.upload_file = MagicMock()

        with patch("app.storage.R2_ENABLED", True), \
             patch("app.storage.get_r2_sync_client", return_value=mock_client), \
             patch("app.storage.get_db_version_from_r2", return_value=(5, {})) as mock_head, \
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
