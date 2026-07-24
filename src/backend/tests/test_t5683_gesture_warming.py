"""Tests for T5683 WARM-AT-GESTURE: failure swallowing + fire-and-forget.

Gesture warming must never fail the parent operation. Failures are logged
at info level and swallowed. This also verifies the fire_and_forget helper
holds a strong reference so the task can't be GC'd before completion.
"""

import asyncio
import gc
import pytest
from unittest.mock import patch

from app.services.poster_warmer import (
    fire_and_forget,
    warm_draft_poster_background,
    warm_game_source_poster_background,
    _background_tasks,
)


@pytest.mark.asyncio
async def test_draft_warming_swallows_failures():
    """Draft warming failures don't propagate; gesture succeeds."""
    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=Exception("R2 upload failed"),
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,
    ):
        # Must not raise.
        await warm_draft_poster_background("user1", "prof1", 123)


@pytest.mark.asyncio
async def test_game_source_warming_swallows_failures():
    """Game source warming failures don't propagate; gesture succeeds."""
    with patch(
        "app.services.poster_warmer.ensure_game_source_poster",
        side_effect=Exception("FFmpeg failed"),
    ), patch(
        "app.services.poster_warmer.r2_head_object_global",
        return_value=None,
    ):
        # Must not raise.
        await warm_game_source_poster_background("user1", "prof1", 456)


@pytest.mark.asyncio
async def test_warming_logs_failures_at_info():
    """Warming failures are logged at info, not silent."""
    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=Exception("Test error"),
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,
    ), patch("app.services.poster_warmer.logger") as mock_logger:
        await warm_draft_poster_background("user1", "prof1", 123)

        mock_logger.info.assert_called()
        joined = " ".join(str(c) for c in mock_logger.info.call_args_list)
        assert "failed" in joined.lower()


@pytest.mark.asyncio
async def test_fire_and_forget_holds_strong_reference_until_done():
    """fire_and_forget() keeps the task alive across a GC pass mid-flight.

    A bare asyncio.create_task(...) whose return value is discarded is only
    weakly referenced by the event loop; a GC cycle can reap it before it
    runs (silent data loss for background warming). fire_and_forget must
    register the task in _background_tasks and only release it on completion.
    """
    ran = asyncio.Event()

    async def slow_coro():
        await asyncio.sleep(0.05)
        ran.set()

    task = fire_and_forget(slow_coro())
    assert task in _background_tasks

    # Drop all other references and force a collection cycle while the task
    # is still pending -- if fire_and_forget didn't hold a strong ref, this
    # is exactly the scenario where CPython could destroy the pending task.
    del task
    gc.collect()
    await asyncio.sleep(0)  # let the loop schedule the task

    await asyncio.wait_for(ran.wait(), timeout=1.0)
    assert ran.is_set()

    # Self-evicts from the registry once done.
    await asyncio.sleep(0)
    assert not any(t.get_name() == "slow_coro" for t in _background_tasks)


@pytest.mark.asyncio
async def test_fire_and_forget_evicts_after_completion():
    """The background-task set doesn't grow unbounded across many calls."""
    before = len(_background_tasks)

    async def quick():
        return None

    tasks = [fire_and_forget(quick()) for _ in range(5)]
    await asyncio.gather(*tasks)
    await asyncio.sleep(0)  # let done_callbacks run

    assert len(_background_tasks) == before
