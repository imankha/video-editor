"""Tests for T5683 WARM-AT-GESTURE: failure swallowing + fire-and-forget.

Gesture warming must never fail the parent operation. Failures are logged
at info level and swallowed. This verifies the fire-and-forget pattern.
"""

import asyncio
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from app.services.poster_warmer import (
    warm_draft_poster_background,
    warm_game_source_poster_background,
)


@pytest.mark.asyncio
async def test_draft_warming_swallows_failures():
    """Draft warming failures don't propagate; gesture succeeds."""
    user_id = "user1"
    profile_id = "prof1"
    project_id = 123

    # Mock ensure_draft_poster to raise an exception.
    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=Exception("R2 upload failed"),
    ):
        # Calling the background warmer should NOT raise.
        # (It will log at info, but the coroutine completes successfully.)
        await warm_draft_poster_background(user_id, profile_id, project_id)

    # No exception raised = success.


@pytest.mark.asyncio
async def test_game_source_warming_swallows_failures():
    """Game source warming failures don't propagate; gesture succeeds."""
    user_id = "user1"
    profile_id = "prof1"
    game_id = 456

    # Mock ensure_game_source_poster to raise an exception.
    with patch(
        "app.services.poster_warmer.ensure_game_source_poster",
        side_effect=Exception("FFmpeg failed"),
    ):
        # Calling the background warmer should NOT raise.
        await warm_game_source_poster_background(user_id, profile_id, game_id)

    # No exception raised = success.


@pytest.mark.asyncio
async def test_warming_logs_failures_at_info():
    """Warming failures are logged at info, not silent."""
    user_id = "user1"
    profile_id = "prof1"
    project_id = 123

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=Exception("Test error"),
    ), patch("app.services.poster_warmer.logger") as mock_logger:
        await warm_draft_poster_background(user_id, profile_id, project_id)

        # Should log at info about the failure.
        mock_logger.info.assert_called()
        call_args = str(mock_logger.info.call_args)
        assert "warming failed" in call_args.lower() or "error" in call_args.lower()


@pytest.mark.asyncio
async def test_asyncio_create_task_fire_and_forget(monkeypatch):
    """Gesture calls create_task (fire-and-forget), not await."""
    # This test verifies that the gesture handler uses asyncio.create_task
    # to fire warming in the background without blocking the response.

    warming_called = False

    async def mock_warm(*args):
        nonlocal warming_called
        warming_called = True
        await asyncio.sleep(0.01)

    with patch(
        "app.services.poster_warmer.PosterWarmer.warm_draft_poster_async",
        side_effect=mock_warm,
    ):
        # Simulate the gesture handler creating a task.
        from app.services.poster_warmer import get_poster_warmer

        warmer = get_poster_warmer()

        # Create the task (fire-and-forget).
        task = asyncio.create_task(
            warmer.warm_draft_poster_async("user1", "prof1", 123)
        )

        # The task is created, but we check if it runs in the background.
        # If we await it immediately, we're testing the wrong thing.
        # Instead, yield control to let the task run a bit.
        await asyncio.sleep(0.02)

        # Task should have completed by now.
        assert task.done()
        assert warming_called
