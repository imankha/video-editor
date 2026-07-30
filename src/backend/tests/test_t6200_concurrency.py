"""T6200 — request-path blocking I/O must not serialize concurrent requests.

Background: the app runs a SINGLE uvicorn worker with a single asyncio event
loop. Before T6200, `validate_session` (a blocking psycopg2 query) ran directly
on that loop for every authenticated request. While the loop was blocked it could
neither advance another request nor flush an already-finished response, so a
concurrent burst SERIALIZED and drained together — the HAR fingerprint (identical
durations, simultaneous completion). Measured on warm staging: authed /api/health
went 358ms(N=1) -> 1271ms(N=8); anon stayed flat.

Fix: `validate_session` is offloaded via `asyncio.to_thread` (db_sync.py), so the
loop stays free and concurrent requests overlap.

This is the durable perf guard. It asserts the PROPERTY (overlap) with a
controlled sleeping stub instead of a wall-clock threshold on real I/O — the same
philosophy as the loop-probe seam and the T6070 note. It is counterfactual-proof:
re-inlining the blocking call (reverting to `session = validate_session(...)`)
turns wall time from ~DELAY into ~N*DELAY and fails the overlap assertion.
"""
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx

from app.main import app

# One controlled unit of blocking "I/O". Big enough that N*DELAY is unmistakably
# separable from ~DELAY, small enough to keep the test fast.
DELAY = 0.2
N = 8


def _blocking_validate_session(session_id):
    """Stand-in for the real (blocking psycopg2) validate_session: sleeps on
    whatever thread it runs on, then returns a valid session dict."""
    time.sleep(DELAY)
    return {"user_id": "t6200-user", "email": "t6200@test.local"}


async def _fire_concurrent(n):
    # Mirror lifespan()'s bounded I/O executor so N offloaded calls have threads
    # to overlap on (the default is min(32, cpu+4) = as few as 5 on a 1-vCPU CI).
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(max_workers=32, thread_name_prefix="io-test")
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver", cookies={"rb_session": "x"}
    ) as c:
        t0 = time.perf_counter()
        responses = await asyncio.gather(*[c.get("/api/health") for _ in range(n)])
        wall = time.perf_counter() - t0
    return responses, wall


def test_authenticated_requests_do_not_serialize_on_the_loop():
    """N concurrent authed /api/health overlap (wall ~= DELAY), not serialize
    (wall ~= N*DELAY), because validate_session runs off the event loop."""
    with patch("app.middleware.db_sync.validate_session", _blocking_validate_session):
        responses, wall = asyncio.run(_fire_concurrent(N))

    assert all(r.status_code == 200 for r in responses), [r.status_code for r in responses]

    serialized = N * DELAY
    # Overlap: wall should be far below the serialized time. Generous bound
    # (< 50% of serialized) so thread-scheduling / GIL jitter never flakes it,
    # while the pre-fix serialized wall (~N*DELAY) blows past it decisively.
    assert wall < serialized * 0.5, (
        f"authed requests serialized: wall={wall:.3f}s for N={N} "
        f"(serialized would be ~{serialized:.3f}s; overlapped ~{DELAY:.3f}s). "
        f"validate_session is likely back on the event loop."
    )


def test_the_stub_actually_blocks_its_thread():
    """Sanity: a SINGLE request pays ~DELAY, so the guard above is measuring real
    per-request cost (guards against the stub silently becoming a no-op)."""
    with patch("app.middleware.db_sync.validate_session", _blocking_validate_session):
        responses, wall = asyncio.run(_fire_concurrent(1))
    assert responses[0].status_code == 200
    assert wall >= DELAY * 0.8, f"single request too fast ({wall:.3f}s) — stub not blocking?"
