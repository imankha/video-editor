"""T9135 — the two cold-path boot blockers T9120 found outside the Publish
burst (T9130) must not run inline on the event loop.

1. `POST /api/auth/init` (`init_session`, auth.py) called `user_session_init`
   directly -- the un-offloaded twin of the T6240 middleware fix. This is the
   explicit bootstrap call the frontend fires once on mount, so it runs on the
   literal first request of a cold session (measured 2145ms cold).
2. `_schedule_startup_recovery` -> `_run_startup_recovery` (session_init.py)
   already fires fire-and-forget onto the captured main loop (T6240 fixed the
   *scheduling* half of this) -- but its recovery work itself
   (`recover_orphaned_jobs`, blocking sqlite + a blocking
   `modal.FunctionCall.from_id(...).get()`) still executed directly on
   whichever loop that task landed on, competing with the user's first page
   load on that same loop.

Both guards assert the PROPERTY (the event loop stays free), not a wall-clock
threshold on real I/O -- same philosophy as test_t6240_session_init_concurrency.py.
Both are counterfactual-provable: reverting either offload reintroduces
serialization / a blocked loop and fails the assertion.
"""
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import app.session_init as session_init
from app.profile_context import get_current_profile_id
from app.routers.auth import InitRequest, init_session
from app.user_context import set_current_user_id

DELAY = 0.2
N = 8


# ---------------------------------------------------------------------------
# 1. init_session must offload user_session_init, not call it inline.
# ---------------------------------------------------------------------------

def _blocking_user_session_init(user_id, hint_profile_id=None):
    """Stand-in for the real (blocking R2 + sqlite) user_session_init: sleeps on
    whatever thread it runs on, then returns the shape init_session expects."""
    time.sleep(DELAY)
    return {"profile_id": "abcd1234", "is_new_user": False}


async def _call_init_once(i: int):
    # Each gather branch is its own Task, which copies the context at creation
    # time -- setting the contextvar here only mutates THIS task's own copy.
    set_current_user_id(f"t9135-user-{i}")
    resp = await init_session(InitRequest())
    return resp, get_current_profile_id()


async def _fire_concurrent_inits(n):
    # Mirror lifespan()'s bounded I/O executor so N offloaded inits have
    # threads to overlap on (asyncio's default can be as few as 5 on 1-vCPU CI).
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(max_workers=32, thread_name_prefix="t9135-io-test")
    )
    t0 = time.perf_counter()
    results = await asyncio.gather(*[_call_init_once(i) for i in range(n)])
    return results, time.perf_counter() - t0


def test_init_session_offloads_user_session_init_and_overlaps():
    """N concurrent /api/auth/init calls overlap (wall ~= DELAY), not serialize
    (wall ~= N*DELAY) -- proving user_session_init runs off the event loop."""
    with patch("app.routers.auth.user_session_init", _blocking_user_session_init):
        results, wall = asyncio.run(_fire_concurrent_inits(N))

    for resp, _ in results:
        assert resp.profile_id == "abcd1234"
        assert resp.is_new_user is False

    serialized = N * DELAY
    assert wall < serialized * 0.5, (
        f"requests serialized on user_session_init: wall={wall:.3f}s for N={N} "
        f"(serialized would be ~{serialized:.3f}s). user_session_init is "
        f"likely back on the event loop instead of offloaded via run_in_context."
    )


def test_init_session_reapplies_profile_id_after_offload():
    """The offloaded thread's copied context does not propagate the profile_id
    it sets back to the request context -- init_session must re-apply it from
    the returned dict, or the request's own X-Profile-ID resolution breaks."""
    with patch("app.routers.auth.user_session_init", _blocking_user_session_init):
        results, _wall = asyncio.run(_fire_concurrent_inits(1))
    resp, ctx_profile_id = results[0]

    assert resp.profile_id == "abcd1234"
    assert ctx_profile_id == "abcd1234", (
        "init_session did not re-apply the offloaded profile_id onto the "
        "request context after run_in_context returned"
    )


def test_single_init_request_actually_pays_the_delay():
    """Sanity: a single request pays ~DELAY, so the guard above is measuring
    real per-request cost (guards against the stub silently becoming a no-op)."""
    with patch("app.routers.auth.user_session_init", _blocking_user_session_init):
        results, wall = asyncio.run(_fire_concurrent_inits(1))
    assert results[0][0].profile_id == "abcd1234"
    assert wall >= DELAY * 0.8, f"single request too fast ({wall:.3f}s) -- stub not blocking?"


# ---------------------------------------------------------------------------
# 2. _run_startup_recovery must not block the loop it is scheduled on.
# ---------------------------------------------------------------------------

def _blocking_recover_orphaned_jobs():
    """Stand-in for the real recover_orphaned_jobs: blocking sqlite + a
    blocking Modal network call, no `await` anywhere -- hence plain `def`."""
    time.sleep(DELAY)


async def _fast_process_modal_queue():
    return {"processed": 0, "succeeded": 0, "failed": 0}


def test_startup_recovery_does_not_block_its_own_loop():
    """While recover_orphaned_jobs' blocking work runs, a concurrent ticker
    task on the SAME loop must keep advancing. Pre-fix, recover_orphaned_jobs
    ran directly on whichever loop _run_startup_recovery was scheduled on
    (the main loop, per T6240's fire-and-forget fix) -- so it would starve the
    ticker (and every real request) for the full DELAY."""

    async def scenario():
        set_current_user_id("t9135-recovery-user")
        from app.profile_context import set_current_profile_id
        set_current_profile_id("abcd1234")

        ticks = {"n": 0}

        async def _ticker():
            while True:
                ticks["n"] += 1
                await asyncio.sleep(0.02)

        ticker_task = asyncio.create_task(_ticker())
        try:
            t0 = time.perf_counter()
            with patch(
                "app.services.export_worker.recover_orphaned_jobs",
                _blocking_recover_orphaned_jobs,
            ), patch(
                "app.services.modal_queue.process_modal_queue",
                _fast_process_modal_queue,
            ):
                await session_init._run_startup_recovery("t9135-recovery-user")
            wall = time.perf_counter() - t0
        finally:
            ticker_task.cancel()

        return wall, ticks["n"]

    wall, ticks = asyncio.run(scenario())

    assert wall >= DELAY * 0.8, f"recovery finished too fast ({wall:.3f}s) -- stub not blocking?"
    # At a 0.02s tick interval, a free loop advances ~10 times over a 0.2s
    # recovery. A generous floor (5) keeps this from flaking under CI jitter
    # while still failing decisively if recover_orphaned_jobs is called
    # directly on the loop (the ticker would advance ~0-1 times).
    assert ticks >= 5, (
        f"ticker only advanced {ticks} times during a {wall:.3f}s recovery -- "
        f"the loop was blocked. recover_orphaned_jobs is likely being awaited "
        f"directly instead of offloaded via run_in_context."
    )
