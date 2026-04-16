"""
Tests for the per-user write lock (T1531).

Two writers for the same user serialize. Two writers for different users do
not. A reader never blocks on a writer. The wait-time log fires only for
contended writers.
"""

import asyncio
import logging
import time

import pytest

from app.middleware import db_sync


@pytest.fixture(autouse=True)
def isolate_locks(monkeypatch):
    """Each test gets a fresh _USER_WRITE_LOCKS dict."""
    monkeypatch.setattr(db_sync, "_USER_WRITE_LOCKS", {})
    yield


def test_reader_does_not_block_on_writer():
    """A GET running concurrently with a slow POST returns immediately."""
    user = "userA"

    async def runner():
        write_done = asyncio.Event()

        async def slow_writer():
            async with db_sync._maybe_write_lock(user, "POST", "/api/x", "rid1"):
                await asyncio.sleep(0.20)
                write_done.set()

        async def fast_reader():
            t0 = time.perf_counter()
            async with db_sync._maybe_write_lock(user, "GET", "/api/x", "rid2"):
                pass
            return time.perf_counter() - t0

        write_task = asyncio.create_task(slow_writer())
        # Yield control so the writer takes the lock first.
        await asyncio.sleep(0.01)
        reader_elapsed = await fast_reader()
        await write_task
        # Reader should not have waited on the writer.
        assert reader_elapsed < 0.05, f"reader waited {reader_elapsed:.3f}s — should be immediate"

    asyncio.run(runner())


def test_two_writers_same_user_serialize():
    """Two POSTs for the same user run sequentially, not in parallel."""
    user = "userA"
    order: list[str] = []

    async def runner():
        async def writer(tag: str, hold: float):
            async with db_sync._maybe_write_lock(user, "POST", "/api/x", f"rid_{tag}"):
                order.append(f"start_{tag}")
                await asyncio.sleep(hold)
                order.append(f"end_{tag}")

        # Both started simultaneously; lock forces serial execution.
        t0 = time.perf_counter()
        await asyncio.gather(writer("A", 0.10), writer("B", 0.10))
        elapsed = time.perf_counter() - t0
        # Sequential: ~200ms total. Parallel would be ~100ms.
        assert elapsed >= 0.18, f"expected serial (>=180ms), got {elapsed:.3f}s"
        # Strict ordering: B cannot start before A ends.
        assert order in (
            ["start_A", "end_A", "start_B", "end_B"],
            ["start_B", "end_B", "start_A", "end_A"],
        ), f"writers interleaved: {order}"

    asyncio.run(runner())


def test_writers_different_users_do_not_serialize():
    """Two POSTs for different users run in parallel."""

    async def runner():
        async def writer(user: str):
            async with db_sync._maybe_write_lock(user, "POST", "/api/x", "rid"):
                await asyncio.sleep(0.10)

        t0 = time.perf_counter()
        await asyncio.gather(writer("userA"), writer("userB"))
        elapsed = time.perf_counter() - t0
        # Parallel: ~100ms. Serial would be ~200ms.
        assert elapsed < 0.18, f"different users serialized: {elapsed:.3f}s"

    asyncio.run(runner())


def test_anonymous_writer_does_not_lock():
    """A POST with no user_id is allowed (allowlisted paths) and takes no lock."""

    async def runner():
        async def writer():
            async with db_sync._maybe_write_lock(None, "POST", "/api/auth/x", "rid"):
                await asyncio.sleep(0.05)

        t0 = time.perf_counter()
        await asyncio.gather(writer(), writer(), writer())
        elapsed = time.perf_counter() - t0
        # Three parallel: ~50ms. Serial would be ~150ms.
        assert elapsed < 0.10, f"anonymous writers serialized: {elapsed:.3f}s"

    asyncio.run(runner())


def test_write_lock_wait_log_emitted(caplog):
    """When a writer waits >50ms, a [WRITE_LOCK_WAIT] log is emitted."""
    user = "userA"

    async def runner():
        async def first():
            async with db_sync._maybe_write_lock(user, "POST", "/api/x", "rid_first"):
                await asyncio.sleep(0.10)

        async def second():
            await asyncio.sleep(0.01)  # let first acquire
            async with db_sync._maybe_write_lock(user, "POST", "/api/x", "rid_second"):
                pass

        await asyncio.gather(first(), second())

    with caplog.at_level(logging.INFO, logger="app.middleware.db_sync"):
        asyncio.run(runner())

    waits = [r for r in caplog.records if "[WRITE_LOCK_WAIT]" in r.getMessage()]
    assert len(waits) == 1, f"expected 1 wait log, got {len(waits)}"
    msg = waits[0].getMessage()
    assert "rid_second" in msg
    assert "user=userA" in msg
