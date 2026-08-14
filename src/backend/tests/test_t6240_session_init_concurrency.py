"""T6240 — user_session_init must not serialize concurrent requests on the loop.

Background: the app runs a SINGLE uvicorn worker with a single asyncio event
loop. When a request arrives WITHOUT an `X-Profile-ID` header, the middleware
runs `user_session_init(user_id)` (blocking R2 downloads of user.sqlite +
profile.sqlite, sqlite opens, Postgres credit/quest work) to discover the
profile. Before T6240 that ran directly on the event loop.

This is exactly the shape that bites at app boot: the FIRST request of a session
is `/api/profiles`, whose whole job is to discover which profiles exist, so it
CANNOT send `X-Profile-ID` — it routes straight into `user_session_init`. While
that blocking init held the loop it could neither advance another request nor
flush an already-finished response, so the ~7 requests issued behind it drained
together — the T6200 fingerprint at boot (2026-07-31 HAR: eight boot requests all
~22s, finishing within ~40ms of each other). T6200 deliberately left this call on
the loop, judging it "rare on the hot path"; boot proved that judgement wrong.

Fix: `user_session_init` is offloaded via `run_in_context` (db_sync.py) — the
same primitive T6200 introduced. run_in_context (not a bare to_thread) copies the
request contextvars into the worker thread, so `ensure_database()`'s
`get_current_*()` reads still resolve there; the loop stays free while the init
runs, and concurrent requests overlap.

This is the durable perf guard. It asserts the PROPERTY (overlap) with a
controlled sleeping stub instead of a wall-clock threshold on real I/O — the same
philosophy as test_t6200_concurrency.py. It is counterfactual-proof: re-inlining
the blocking call (reverting to `init_result = user_session_init(user_id)`) turns
wall time from ~DELAY into ~N*DELAY and fails the overlap assertion.
"""
import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx
from fastapi import FastAPI

import app.session_init as session_init
from app.middleware import RequestContextMiddleware
from app.profile_context import get_current_profile_id, set_current_profile_id
from app.user_context import set_current_user_id
from app.utils.offload import run_in_context

# One controlled unit of blocking "I/O" inside user_session_init. Big enough that
# N*DELAY is unmistakably separable from ~DELAY, small enough to keep it fast.
DELAY = 0.2
N = 8


def _fast_validate_session(session_id):
    """Non-blocking stand-in for the real psycopg2 validate_session — returns a
    valid session immediately so the request reaches the session_init branch."""
    return {"user_id": "t6240-user", "email": "t6240@test.local"}


def _blocking_user_session_init(user_id, hint_profile_id=None):
    """Stand-in for the real (blocking R2 + sqlite) user_session_init: sleeps on
    whatever thread it runs on, then returns the init result dict the middleware
    expects. On the event loop this blocks everything; offloaded it overlaps."""
    time.sleep(DELAY)
    return {"profile_id": "abcd1234", "is_new_user": False}


def _make_probe_app():
    """Minimal app carrying the REAL RequestContextMiddleware plus one trivial
    authenticated route that is NOT allowlisted and NOT in SKIP_SESSION_INIT_PATHS
    — so a request without X-Profile-ID actually runs user_session_init. R2 is
    disabled in tests, so no sync flow runs."""
    probe = FastAPI()

    @probe.get("/api/probe")
    async def _probe():
        return {"ok": True}

    probe.add_middleware(RequestContextMiddleware)
    return probe


async def _fire_concurrent(n):
    # Mirror lifespan()'s bounded I/O executor so N offloaded inits have threads
    # to overlap on (asyncio's default is min(32, cpu+4) = as few as 5 on 1-vCPU CI).
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(max_workers=32, thread_name_prefix="io-test")
    )
    transport = httpx.ASGITransport(app=_make_probe_app())
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver", cookies={"rb_session": "x"}
    ) as c:
        t0 = time.perf_counter()
        # No X-Profile-ID header -> the middleware runs user_session_init.
        responses = await asyncio.gather(*[c.get("/api/probe") for _ in range(n)])
        wall = time.perf_counter() - t0
    return responses, wall


def test_session_init_does_not_serialize_on_the_loop():
    """N concurrent requests that each trigger user_session_init overlap
    (wall ~= DELAY), not serialize (wall ~= N*DELAY), because the init runs off
    the event loop."""
    with patch("app.middleware.db_sync.validate_session", _fast_validate_session), \
         patch("app.middleware.db_sync.user_session_init", _blocking_user_session_init):
        responses, wall = asyncio.run(_fire_concurrent(N))

    assert all(r.status_code == 200 for r in responses), [r.status_code for r in responses]

    serialized = N * DELAY
    # Overlap: wall should be far below the serialized time. Generous bound
    # (< 50% of serialized) so thread-scheduling / GIL jitter never flakes it,
    # while the pre-fix serialized wall (~N*DELAY) blows past it decisively.
    assert wall < serialized * 0.5, (
        f"requests serialized on user_session_init: wall={wall:.3f}s for N={N} "
        f"(serialized would be ~{serialized:.3f}s; overlapped ~{DELAY:.3f}s). "
        f"user_session_init is likely back on the event loop."
    )


def test_the_stub_actually_blocks_its_thread():
    """Sanity: a SINGLE request pays ~DELAY, so the guard above is measuring real
    per-request cost (guards against the stub silently becoming a no-op)."""
    with patch("app.middleware.db_sync.validate_session", _fast_validate_session), \
         patch("app.middleware.db_sync.user_session_init", _blocking_user_session_init):
        responses, wall = asyncio.run(_fire_concurrent(1))
    assert responses[0].status_code == 200
    assert wall >= DELAY * 0.8, f"single request too fast ({wall:.3f}s) — stub not blocking?"


# --------------------------------------------------------------------------
# Regression: offloading user_session_init to a worker thread must NOT turn its
# tail-end startup recovery (recover_orphaned_jobs + modal-queue drain) from a
# fire-and-forget background task into a BLOCKING inline `asyncio.run`.
#
# _schedule_startup_recovery detects "am I on the loop?" with get_running_loop().
# On a worker thread that raises RuntimeError; the naive fallback runs
# `asyncio.run(_run_startup_recovery(...))`, which BLOCKS the worker thread (and
# thus the awaited middleware call — the very cold-boot request T6240 speeds up)
# until the modal queue drains, and runs recovery on an ephemeral loop that
# cancels pending sub-tasks at close. The fix hands the main loop to session_init
# (set_main_loop) so the worker-thread path schedules onto it fire-and-forget,
# carrying this thread's user/profile ContextVars via copy_context.
#
# Counterfactual: with the old `asyncio.run` fallback, scheduling blocks for
# RECOVERY_WORK seconds and the elapsed assertion fails.
# --------------------------------------------------------------------------

RECOVERY_WORK = 0.3


def test_offloaded_startup_recovery_is_fire_and_forget_on_main_loop():
    async def scenario():
        main_loop = asyncio.get_running_loop()
        session_init.set_main_loop(main_loop)

        observed = {"loop": None, "profile": None}
        done = threading.Event()

        async def _fake_recovery(user_id):
            # Record where the recovery coroutine actually runs.
            observed["loop"] = asyncio.get_running_loop()
            try:
                observed["profile"] = get_current_profile_id()
            except RuntimeError:
                observed["profile"] = "<unset>"
            await asyncio.sleep(RECOVERY_WORK)
            done.set()

        def _worker():
            # Simulate the offloaded user_session_init tail: context is set, then
            # recovery is scheduled. This must return immediately.
            set_current_user_id("u6240")
            set_current_profile_id("abcd1234")
            t0 = time.perf_counter()
            session_init._schedule_startup_recovery("u6240")
            return time.perf_counter() - t0

        try:
            with patch.object(session_init, "_run_startup_recovery", _fake_recovery):
                # run_in_context puts _worker on a real worker thread, exactly like
                # the middleware's run_in_context(user_session_init, ...).
                elapsed = await run_in_context(_worker)
                # Scheduling from the worker thread must NOT block on the recovery
                # work (fire-and-forget). asyncio.run fallback would block ~RECOVERY_WORK.
                assert elapsed < RECOVERY_WORK * 0.5, (
                    f"scheduling blocked {elapsed:.3f}s — recovery ran inline via "
                    f"asyncio.run instead of firing onto the main loop"
                )
                # The recovery coroutine must actually run — on the MAIN loop, with
                # the worker thread's profile context carried across.
                await asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(None, done.wait), timeout=2
                )
        finally:
            session_init.set_main_loop(None)

        assert observed["loop"] is main_loop, "recovery did not run on the main loop"
        assert observed["profile"] == "abcd1234", (
            f"recovery lost profile context (got {observed['profile']!r})"
        )

    asyncio.run(scenario())
