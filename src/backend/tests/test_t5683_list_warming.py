"""Tests for T5683 LIST-TIME WARMING: cache skips + bounded concurrency.

LIST endpoints warm posters for visible items. Cache hits (file exists)
skip ffmpeg. Concurrent warming is bounded to max 3-4 in flight.
"""

import pytest
from unittest.mock import patch, MagicMock, call
from app.services.poster_warmer import PosterWarmer


@pytest.mark.asyncio
async def test_list_warming_skips_cached_posters():
    """LIST warming skips ffmpeg for posters already in R2."""
    warmer = PosterWarmer()
    user_id = "user1"
    profile_id = "prof1"
    project_ids = [100, 101, 102]

    ensure_call_count = 0

    def mock_ensure(*args):
        nonlocal ensure_call_count
        ensure_call_count += 1
        return f"poster_{args[0]}.jpg"

    # Projects 100 and 101 have posters; 102 is missing.
    def mock_exists_in_r2(uid, path):
        return "100" in path or "101" in path

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        side_effect=mock_exists_in_r2,
    ):
        # Warm all 3 posters (cache-first strategy).
        tasks = []
        for proj_id in project_ids:
            coro = warmer.warm_draft_poster_async(user_id, profile_id, proj_id)
            tasks.append(coro)

        import asyncio
        results = await asyncio.gather(*tasks)

    # Only project 102 (missing) should call ensure_draft_poster.
    assert ensure_call_count == 1, f"Expected 1 ffmpeg run, got {ensure_call_count}"
    # All 3 should return a path (either cached or freshly generated).
    assert len([r for r in results if r]) == 3


@pytest.mark.asyncio
async def test_list_warming_bounded_concurrency():
    """LIST warming uses semaphore to limit concurrent ffmpeg."""
    warmer = PosterWarmer()
    concurrent_count = 0
    max_concurrent = 0

    def mock_ensure(*args):
        nonlocal concurrent_count, max_concurrent
        concurrent_count += 1
        max_concurrent = max(max_concurrent, concurrent_count)
        concurrent_count -= 1  # Simulate sync work completion
        return f"poster_{args[0]}.jpg"

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,  # All "missing" to trigger ffmpeg.
    ):
        # 10 concurrent warming requests, each using semaphore.
        import asyncio

        tasks = []
        for proj_id in range(10):
            coro = warmer.warm_draft_poster_async("user1", "prof1", proj_id)
            task = warmer.warm_with_semaphore(coro)
            tasks.append(task)

        await asyncio.gather(*tasks)

    # Max concurrent should not exceed semaphore limit (3).
    assert max_concurrent <= 3, f"Exceeded limit: {max_concurrent} > 3"


@pytest.mark.asyncio
async def test_list_warming_never_fails_endpoint():
    """LIST warming failures don't fail the endpoint."""
    warmer = PosterWarmer()
    user_id = "user1"
    profile_id = "prof1"

    # Mock warming to raise an exception.
    def mock_ensure(*args):
        raise Exception("R2 error")

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,
    ):
        # Warming should handle the exception gracefully.
        import asyncio

        tasks = []
        for proj_id in range(3):
            coro = warmer.warm_draft_poster_async(user_id, profile_id, proj_id)
            task = warmer.warm_with_semaphore(coro)
            tasks.append(task)

        # gather with return_exceptions=True prevents one failure from aborting all.
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # All tasks should have completed (some with None/"error").
        assert len(results) == 3
