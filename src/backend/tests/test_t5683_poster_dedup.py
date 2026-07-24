"""Tests for T5683 in-flight dedup + bounded concurrency in poster warming.

Concurrent requests for the same poster key must await the same ffmpeg task,
not duplicate. This verifies the PosterWarmer dedup mechanism.
"""

import asyncio
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.services.poster_warmer import PosterWarmer


@pytest.mark.asyncio
async def test_dedup_concurrent_requests_same_key():
    """10 concurrent requests for the same draft poster -> 1 ffmpeg run."""
    warmer = PosterWarmer()
    user_id = "user1"
    profile_id = "prof1"
    project_id = 123

    call_count = 0

    async def mock_ensure_draft_poster(proj_id, uid):
        """Track how many times the actual poster generation runs."""
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.01)  # Simulate ffmpeg work
        return f"poster_{proj_id}.jpg"

    # Mock ensure_draft_poster to be called only once despite concurrent requests.
    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure_draft_poster,
    ):
        # 10 concurrent requests for the same poster key.
        tasks = [
            warmer.warm_draft_poster_async(user_id, profile_id, project_id)
            for _ in range(10)
        ]
        results = await asyncio.gather(*tasks)

    # All 10 requests should get the same result.
    assert len(set(results)) == 1
    # But ensure_draft_poster should only run once (dedup).
    assert call_count == 1, f"Expected 1 ffmpeg run, got {call_count}"


@pytest.mark.asyncio
async def test_dedup_different_keys_run_in_parallel():
    """Requests for different poster keys run in parallel (not serialized)."""
    warmer = PosterWarmer()
    call_count = 0
    start_times = []

    async def mock_ensure(proj_id, uid):
        """Track when each call starts."""
        nonlocal call_count
        call_count += 1
        start_times.append(asyncio.get_event_loop().time())
        await asyncio.sleep(0.05)  # Simulate ffmpeg work
        return f"poster_{proj_id}.jpg"

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ):
        # 3 concurrent requests for DIFFERENT projects.
        tasks = [
            warmer.warm_draft_poster_async("user1", "prof1", proj_id)
            for proj_id in [100, 101, 102]
        ]
        await asyncio.gather(*tasks)

    # All 3 should run (one per key).
    assert call_count == 3
    # They should start roughly concurrently (within 20ms of each other).
    time_spread = max(start_times) - min(start_times)
    assert time_spread < 0.02, f"Not concurrent: spread={time_spread:.3f}s"


@pytest.mark.asyncio
async def test_dedup_double_check_after_wait():
    """In-flight dedup: after lock wait, double-check cache before re-running."""
    warmer = PosterWarmer()
    user_id = "user1"
    profile_id = "prof1"
    project_id = 123
    call_count = 0

    async def mock_ensure(proj_id, uid):
        """Simulate ffmpeg taking time."""
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return f"poster_{proj_id}.jpg"

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        side_effect=lambda uid, path: False,  # Always "missing" until double-check
    ) as mock_exists:
        # Task 1 starts warming.
        task1 = asyncio.create_task(
            warmer.warm_draft_poster_async(user_id, profile_id, project_id)
        )
        await asyncio.sleep(0.01)  # Let task1 start

        # Task 2 arrives while task1 is still warming (in-flight).
        task2 = asyncio.create_task(
            warmer.warm_draft_poster_async(user_id, profile_id, project_id)
        )

        results = await asyncio.gather(task1, task2)

    # Both should get the same result (task2 awaited task1).
    assert results[0] == results[1]
    # ensure_draft_poster should only run once.
    assert call_count == 1


@pytest.mark.asyncio
async def test_bounded_semaphore_limits_concurrent():
    """Bounded semaphore limits concurrent work to max_concurrent (3-4)."""
    warmer = PosterWarmer()
    concurrent_runs = 0
    max_concurrent_seen = 0

    async def mock_ensure(proj_id, uid):
        """Track max concurrent runs."""
        nonlocal concurrent_runs, max_concurrent_seen
        concurrent_runs += 1
        max_concurrent_seen = max(max_concurrent_seen, concurrent_runs)
        await asyncio.sleep(0.05)
        concurrent_runs -= 1
        return f"poster_{proj_id}.jpg"

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ):
        # 10 concurrent warming requests, each using semaphore.
        tasks = []
        for proj_id in range(10):
            coro = warmer.warm_draft_poster_async("user1", "prof1", proj_id)
            tasks.append(warmer.warm_with_semaphore(coro))
        await asyncio.gather(*tasks)

    # Max concurrent should not exceed the semaphore limit (3).
    assert max_concurrent_seen <= 3, f"Exceeded limit: {max_concurrent_seen} > 3"
