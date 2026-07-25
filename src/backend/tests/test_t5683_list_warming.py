"""Tests for T5683 LIST-TIME WARMING: cache skips + bounded concurrency.

LIST endpoints warm posters for visible items. Cache hits (file exists)
skip ffmpeg. Concurrent warming is bounded to max 3-4 in flight.
"""

import asyncio
import pytest
from unittest.mock import patch
from app.services.poster_warmer import PosterWarmer


@pytest.mark.asyncio
async def test_list_warming_skips_cached_posters():
    """LIST warming skips ffmpeg for posters already in R2."""
    warmer = PosterWarmer()
    user_id = "user1"
    profile_id = "prof1"
    project_ids = [100, 101, 102]

    ensure_call_count = 0

    def mock_ensure(proj_id, uid):
        nonlocal ensure_call_count
        ensure_call_count += 1
        return f"poster_{proj_id}.jpg"

    # Projects 100 and 101 have cached posters; 102 is missing.
    def mock_exists_in_r2(uid, path):
        return "100" in path or "101" in path

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        side_effect=mock_exists_in_r2,
    ):
        tasks = [
            warmer.warm_draft_poster_async(user_id, profile_id, proj_id)
            for proj_id in project_ids
        ]
        results = await asyncio.gather(*tasks)

    # Only project 102 (missing) should call ensure_draft_poster.
    assert ensure_call_count == 1, f"Expected 1 ffmpeg run, got {ensure_call_count}"
    assert len([r for r in results if r]) == 3


@pytest.mark.asyncio
async def test_list_warming_bounded_concurrency():
    """LIST warming uses the semaphore to limit concurrent ffmpeg."""
    warmer = PosterWarmer()
    concurrent_count = 0
    max_concurrent = 0
    lock = asyncio.Lock()

    async def mock_to_thread(fn, *args):
        nonlocal concurrent_count, max_concurrent
        async with lock:
            concurrent_count += 1
            max_concurrent = max(max_concurrent, concurrent_count)
        await asyncio.sleep(0.02)
        async with lock:
            concurrent_count -= 1
        return fn(*args)

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=lambda proj_id, uid: f"poster_{proj_id}.jpg",
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,  # All "missing" to trigger ffmpeg.
    ), patch(
        "asyncio.to_thread",
        side_effect=mock_to_thread,
    ):
        tasks = [
            warmer.warm_with_semaphore(
                warmer.warm_draft_poster_async("user1", "prof1", proj_id)
            )
            for proj_id in range(10)
        ]
        await asyncio.gather(*tasks)

    assert max_concurrent <= 3, f"Exceeded limit: {max_concurrent} > 3"


@pytest.mark.asyncio
async def test_list_warming_never_fails_on_individual_error():
    """One poster failing doesn't prevent the others / doesn't raise."""
    warmer = PosterWarmer()

    def mock_ensure(proj_id, uid):
        if proj_id == 1:
            raise Exception("R2 error")
        return f"poster_{proj_id}.jpg"

    with patch(
        "app.services.poster_warmer.ensure_draft_poster",
        side_effect=mock_ensure,
    ), patch(
        "app.services.poster_warmer.file_exists_in_r2",
        return_value=False,
    ):
        tasks = [
            warmer.warm_with_semaphore(
                warmer.warm_draft_poster_async("user1", "prof1", proj_id)
            )
            for proj_id in range(3)
        ]
        # warm_draft_poster_async itself catches exceptions internally (best
        # effort) and returns None, so gather must complete without raising.
        results = await asyncio.gather(*tasks)

    assert results[0] is not None and results[2] is not None
    assert results[1] is None  # project 1 failed -> None, not an exception
