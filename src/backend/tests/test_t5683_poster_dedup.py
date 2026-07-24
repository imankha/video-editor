"""Tests for T5683 in-flight dedup + bounded concurrency in poster warming.

Concurrent requests for the same poster key must await the same ffmpeg task,
not duplicate. This verifies the PosterWarmer dedup mechanism.
"""

import asyncio
import time
import pytest
from unittest.mock import patch

from app.services.poster_warmer import PosterWarmer


@pytest.mark.asyncio
async def test_dedup_concurrent_requests_same_key():
    """10 concurrent requests for the same draft poster -> 1 ffmpeg run."""
    warmer = PosterWarmer()
    user_id = "user1"
    profile_id = "prof1"
    project_id = 123

    call_count = 0

    def mock_ensure_draft_poster(proj_id, uid):
        nonlocal call_count
        call_count += 1
        return f"poster_{proj_id}.jpg"

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure_draft_poster,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,
    ):
        tasks = [
            warmer.warm_draft_poster_async(user_id, profile_id, project_id)
            for _ in range(10)
        ]
        results = await asyncio.gather(*tasks)

    assert len(set(results)) == 1
    assert call_count == 1, f"Expected 1 ffmpeg run, got {call_count}"


@pytest.mark.asyncio
async def test_dedup_different_keys_run_in_parallel():
    """Requests for different poster keys run in parallel (not serialized)."""
    warmer = PosterWarmer()
    call_count = 0
    start_times = []

    def mock_ensure(proj_id, uid):
        # Runs inside asyncio.to_thread's worker thread -- no running event
        # loop there, so use a plain wall-clock timer, not get_event_loop().
        nonlocal call_count
        call_count += 1
        start_times.append(time.monotonic())
        return f"poster_{proj_id}.jpg"

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,
    ):
        tasks = [
            warmer.warm_draft_poster_async("user1", "prof1", proj_id)
            for proj_id in [100, 101, 102]
        ]
        await asyncio.gather(*tasks)

    assert call_count == 3
    time_spread = max(start_times) - min(start_times)
    assert time_spread < 0.5, f"Not concurrent: spread={time_spread:.3f}s"


@pytest.mark.asyncio
async def test_dedup_in_flight_second_caller_awaits_first():
    """A caller arriving while another is warming awaits the SAME task."""
    warmer = PosterWarmer()
    user_id = "user1"
    profile_id = "prof1"
    project_id = 123
    call_count = 0
    started = asyncio.Event()
    release = asyncio.Event()

    def mock_ensure(proj_id, uid):
        nonlocal call_count
        call_count += 1
        return f"poster_{proj_id}.jpg"

    async def slow_to_thread(fn, *args):
        started.set()
        await release.wait()
        return fn(*args)

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,
    ), patch(
        "asyncio.to_thread",
        side_effect=slow_to_thread,
    ):
        task1 = asyncio.create_task(
            warmer.warm_draft_poster_async(user_id, profile_id, project_id)
        )
        await started.wait()  # task1 is now inside do_warm, holding the lock

        # task2 arrives while task1 is in-flight -> must find it in _warming_tasks
        assert f"draft:{profile_id}:{project_id}" in warmer._warming_tasks
        task2 = asyncio.create_task(
            warmer.warm_draft_poster_async(user_id, profile_id, project_id)
        )
        await asyncio.sleep(0.01)  # let task2 reach the in-flight await

        release.set()
        results = await asyncio.gather(task1, task2)

    assert results[0] == results[1]
    assert call_count == 1


@pytest.mark.asyncio
async def test_bounded_semaphore_limits_concurrent():
    """Bounded semaphore limits concurrent work to max_concurrent (3)."""
    warmer = PosterWarmer()
    concurrent_runs = 0
    max_concurrent_seen = 0
    lock = asyncio.Lock()

    async def fake_work(proj_id):
        nonlocal concurrent_runs, max_concurrent_seen
        async with lock:
            concurrent_runs += 1
            max_concurrent_seen = max(max_concurrent_seen, concurrent_runs)
        await asyncio.sleep(0.05)
        async with lock:
            concurrent_runs -= 1
        return f"poster_{proj_id}.jpg"

    tasks = [warmer.warm_with_semaphore(fake_work(i)) for i in range(10)]
    await asyncio.gather(*tasks)

    assert max_concurrent_seen <= 3, f"Exceeded limit: {max_concurrent_seen} > 3"


@pytest.mark.asyncio
async def test_cache_hit_skips_ffmpeg_entirely():
    """If the poster already exists in R2, ensure_draft_poster is never called."""
    warmer = PosterWarmer()
    call_count = 0

    def mock_ensure(proj_id, uid):
        nonlocal call_count
        call_count += 1
        return f"poster_{proj_id}.jpg"

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=True,  # Already cached.
    ):
        result = await warmer.warm_draft_poster_async("user1", "prof1", 999)

    assert call_count == 0
    assert result is not None
