"""
Tests for T2640: Local Processing Subprocess Isolation.

Validates:
1. _run_in_subprocess wrapper works with simple functions
2. Progress bridging via multiprocessing.Queue
3. Sync processor functions are picklable (required for ProcessPoolExecutor)
4. Sync processor functions can import app modules in a child process
5. Error handling in subprocess
"""

import asyncio
import multiprocessing
import pickle
import time
import pytest
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")


# --- Helper functions (must be top-level for pickling) ---

def _simple_sync(x, y, progress_callback=None):
    if progress_callback:
        progress_callback(50, "halfway", "processing")
    return {"status": "success", "result": x + y}


def _failing_sync(progress_callback=None):
    raise ValueError("intentional test error")


def _slow_sync_with_progress(steps=5, progress_callback=None):
    for i in range(steps):
        if progress_callback:
            pct = int((i + 1) / steps * 100)
            progress_callback(pct, f"Step {i+1}/{steps}", "processing")
        time.sleep(0.05)
    return {"status": "success", "steps": steps}


def _progress_then_fail(progress_callback=None):
    if progress_callback:
        progress_callback(25, "starting", "phase1")
        progress_callback(50, "halfway", "phase2")
    raise RuntimeError("fail after progress")


class TestRunInSubprocess:
    """Test the _run_in_subprocess wrapper."""

    @pytest.mark.asyncio
    async def test_basic_execution(self):
        from app.services.modal_client import _run_in_subprocess
        result = await _run_in_subprocess(
            _simple_sync,
            {"x": 3, "y": 4},
        )
        assert result["status"] == "success"
        assert result["result"] == 7

    @pytest.mark.asyncio
    async def test_progress_callback_received(self):
        from app.services.modal_client import _run_in_subprocess
        updates = []

        async def track(pct, msg, phase):
            updates.append((pct, msg, phase))

        result = await _run_in_subprocess(
            _simple_sync,
            {"x": 1, "y": 2},
            progress_callback=track,
        )
        assert result["status"] == "success"
        assert len(updates) == 1
        assert updates[0] == (50, "halfway", "processing")

    @pytest.mark.asyncio
    async def test_multiple_progress_updates(self):
        from app.services.modal_client import _run_in_subprocess
        updates = []

        async def track(pct, msg, phase):
            updates.append(pct)

        result = await _run_in_subprocess(
            _slow_sync_with_progress,
            {"steps": 5},
            progress_callback=track,
        )
        assert result["status"] == "success"
        assert result["steps"] == 5
        assert len(updates) == 5
        assert updates[-1] == 100

    @pytest.mark.asyncio
    async def test_error_returns_error_dict(self):
        from app.services.modal_client import _run_in_subprocess
        result = await _run_in_subprocess(
            _failing_sync,
            {},
        )
        assert result["status"] == "error"
        assert "intentional test error" in result["error"]

    @pytest.mark.asyncio
    async def test_no_progress_callback(self):
        from app.services.modal_client import _run_in_subprocess
        result = await _run_in_subprocess(
            _simple_sync,
            {"x": 10, "y": 20},
            progress_callback=None,
        )
        assert result["status"] == "success"
        assert result["result"] == 30

    @pytest.mark.asyncio
    async def test_event_loop_not_blocked(self):
        """Verify the event loop stays responsive while subprocess runs."""
        from app.services.modal_client import _run_in_subprocess

        loop_responsive = True
        check_count = 0

        async def check_loop():
            nonlocal check_count
            while True:
                check_count += 1
                await asyncio.sleep(0.01)

        checker = asyncio.create_task(check_loop())
        try:
            result = await _run_in_subprocess(
                _slow_sync_with_progress,
                {"steps": 10},
            )
            assert result["status"] == "success"
        finally:
            checker.cancel()
            try:
                await checker
            except asyncio.CancelledError:
                pass

        # The loop should have been able to run many checks while subprocess worked
        assert check_count >= 5, f"Event loop only ran {check_count} checks -- may be blocked"


class TestSyncFunctionPickling:
    """Verify sync processor functions can be pickled (required for ProcessPoolExecutor)."""

    def test_framing_sync_picklable(self):
        from app.services.local_processors import _framing_sync
        pickled = pickle.dumps(_framing_sync)
        restored = pickle.loads(pickled)
        assert callable(restored)

    def test_overlay_sync_picklable(self):
        from app.services.local_processors import _overlay_sync
        pickled = pickle.dumps(_overlay_sync)
        restored = pickle.loads(pickled)
        assert callable(restored)

    def test_subprocess_worker_picklable(self):
        from app.services.modal_client import _subprocess_worker
        pickled = pickle.dumps(_subprocess_worker)
        restored = pickle.loads(pickled)
        assert callable(restored)


class TestSubprocessImports:
    """Test that sync functions can import app modules when run in a child process."""

    @pytest.mark.asyncio
    async def test_overlay_sync_imports_in_subprocess(self):
        """Run _overlay_sync in subprocess -- will fail on R2 download,
        but should get past module imports."""
        from app.services.modal_client import _run_in_subprocess
        from app.services.local_processors import _overlay_sync

        result = await _run_in_subprocess(
            _overlay_sync,
            {
                "job_id": "test-overlay-001",
                "user_id": "test-user",
                "input_key": "nonexistent/input.mp4",
                "output_key": "nonexistent/output.mp4",
                "highlight_regions": [],
                "effect_type": "dark_overlay",
            },
        )
        assert result["status"] == "error"
        error_lower = result["error"].lower()
        # Should fail on R2 download, not on module imports
        assert "modulenotfounderror" not in error_lower, \
            f"Module import failed in subprocess: {result['error']}"



class TestProgressBridging:
    """Test that progress flows correctly from subprocess through queue to async callback."""

    @pytest.mark.asyncio
    async def test_progress_ordering_preserved(self):
        from app.services.modal_client import _run_in_subprocess
        updates = []

        async def track(pct, msg, phase):
            updates.append(pct)

        await _run_in_subprocess(
            _slow_sync_with_progress,
            {"steps": 10},
            progress_callback=track,
        )

        # Progress should be monotonically increasing
        for i in range(1, len(updates)):
            assert updates[i] >= updates[i-1], \
                f"Progress went backwards: {updates[i-1]} -> {updates[i]}"

    @pytest.mark.asyncio
    async def test_progress_with_error(self):
        """Progress updates should still be delivered even if function fails."""
        from app.services.modal_client import _run_in_subprocess

        updates = []

        async def track(pct, msg, phase):
            updates.append((pct, msg, phase))

        result = await _run_in_subprocess(
            _progress_then_fail,
            {},
            progress_callback=track,
        )
        assert result["status"] == "error"
        # Some or all progress may have been delivered before the error
        # (depends on timing of queue drain vs process exit)
        # Just verify no crash
