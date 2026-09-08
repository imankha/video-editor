"""T9130 — the Publish page-load burst must not serialize on the event loop.

The Publish screen fires ~7 independent, data-unrelated read endpoints
(`admin/me`, `health`, `rank/confidence` x2, `collections/summary`, `intro-cards`,
`bootstrap`) within ~20ms, then a second ~4-endpoint burst. T9120 proved each
handler was holding the SINGLE uvicorn event loop on its own blocking
sqlite/psycopg2/R2 call, so the burst serialized (wall == the SUM of per-handler
times) and a trivial `/api/health` — 3ms of real work, touching no DB — inflated
to 602ms. That is the T6200 fingerprint: while the loop is blocked it can neither
advance another request nor flush an already-finished response, so every
concurrent request drains together.

T9130 flips those handlers to plain `def` (anyio threadpool) / offloads their
blocking work via run_in_context, so the loop stays free during the burst.

This is the durable perf guard. It asserts the PROPERTY (a victim `/health`-shaped
endpoint stays FLAT, and a loop-resident ticker keeps ticking, while a
Publish-shaped burst of blocking handlers is in flight) with a controlled
sleeping stub instead of a wall-clock threshold on real I/O — the same philosophy
as test_t6200_concurrency.py / test_t6240_session_init_concurrency.py. It is
counterfactual-proof: the sibling test drives the SAME burst against an
`async def` handler that blocks the loop inline and shows the ticker stalls and
the victim inflates, exactly the pre-fix behaviour.
"""
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import FastAPI

# One controlled unit of blocking "I/O" per Publish handler. Big enough that
# N*DELAY is unmistakably separable from ~DELAY, small enough to keep it fast.
DELAY = 0.15
N = 7  # the Stall-A burst size
TICK_INTERVAL = 0.005


def _make_probe_app(block_on_loop: bool) -> FastAPI:
    """A minimal app with two route shapes: a `/heavy` endpoint that does DELAY of
    blocking work, and a pure-victim `/health` that does none.

    block_on_loop=False models the POST-fix shape: `/heavy` is a plain `def`, so
    Starlette runs it in the anyio threadpool, off the loop. block_on_loop=True
    models the PRE-fix shape: `/heavy` is `async def` and blocks the loop inline.
    """
    probe = FastAPI()

    if block_on_loop:
        @probe.get("/heavy")
        async def heavy():  # pre-fix: blocking call runs directly on the loop
            time.sleep(DELAY)
            return {"ok": True}
    else:
        @probe.get("/heavy")
        def heavy():  # post-fix: plain def -> anyio threadpool, off the loop
            time.sleep(DELAY)
            return {"ok": True}

    @probe.get("/health")
    async def health():  # pure victim: 0ms of work, always on the loop
        return {"ok": True}

    return probe


async def _run_burst(block_on_loop: bool):
    """Fire N concurrent /heavy requests, and while they are in flight time a
    single /health request AND count ticks of a loop-resident coroutine. Returns
    (heavy_status_codes, health_status, health_latency, ticks_during, burst_wall)."""
    # Mirror lifespan()'s bounded I/O executor so offloaded work has threads.
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(max_workers=32, thread_name_prefix="io-test")
    )

    state = {"ticks": 0, "stop": False}

    async def ticker():
        while not state["stop"]:
            state["ticks"] += 1
            await asyncio.sleep(TICK_INTERVAL)

    tick_task = asyncio.create_task(ticker())
    await asyncio.sleep(0.02)  # let the ticker settle into its cadence

    transport = httpx.ASGITransport(app=_make_probe_app(block_on_loop))
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        ticks_before = state["ticks"]
        t0 = time.perf_counter()
        burst = asyncio.gather(*[c.get("/heavy") for _ in range(N)])
        # Let the burst get mid-flight, then measure the victim's latency.
        await asyncio.sleep(DELAY * 0.3)
        h0 = time.perf_counter()
        health_resp = await c.get("/health")
        health_latency = time.perf_counter() - h0
        heavy_resps = await burst
        burst_wall = time.perf_counter() - t0
        ticks_during = state["ticks"] - ticks_before

    state["stop"] = True
    tick_task.cancel()
    try:
        await tick_task
    except asyncio.CancelledError:
        pass

    return (
        [r.status_code for r in heavy_resps],
        health_resp.status_code,
        health_latency,
        ticks_during,
        burst_wall,
    )


def test_publish_burst_does_not_serialize_on_the_loop():
    """POST-fix: with the Publish handlers off the loop, a concurrent burst
    overlaps, the victim /health stays flat, and the loop keeps ticking."""
    codes, health_code, health_latency, ticks, wall = asyncio.run(_run_burst(False))

    assert all(c == 200 for c in codes), codes
    assert health_code == 200

    serialized = N * DELAY
    # Burst overlaps instead of summing.
    assert wall < serialized * 0.5, (
        f"burst serialized: wall={wall:.3f}s for N={N} (serialized ~{serialized:.3f}s, "
        f"overlapped ~{DELAY:.3f}s) — a Publish handler is likely back on the loop."
    )
    # The victim is not stuck behind the burst.
    assert health_latency < DELAY * 0.5, (
        f"/health inflated to {health_latency*1000:.0f}ms while the burst ran — "
        f"the loop was blocked (T6200/T9120 fingerprint)."
    )
    # The loop kept advancing: expect roughly wall/TICK_INTERVAL ticks; require at
    # least half that (generous so scheduling jitter never flakes it).
    expected_ticks = wall / TICK_INTERVAL
    assert ticks >= expected_ticks * 0.5, (
        f"loop ticker stalled during the burst: {ticks} ticks over {wall:.3f}s "
        f"(expected ~{expected_ticks:.0f}) — the loop was blocked."
    )


def test_inline_blocking_burst_stalls_the_loop():
    """Counterfactual sanity: the SAME burst against an async handler that blocks
    the loop inline serializes AND stalls the loop ticker — so the guard above is
    measuring the real property, not a no-op. The ticker (a loop-native coroutine)
    is the reliable witness of loop advancement; the mid-burst /health latency is
    scheduling-dependent under ASGITransport, so it is not asserted here."""
    codes, health_code, _health_latency, ticks, wall = asyncio.run(_run_burst(True))

    assert all(c == 200 for c in codes), codes
    assert health_code == 200

    # Pre-fix: the burst serialized (wall ~= N*DELAY).
    assert wall >= N * DELAY * 0.7, (
        f"expected the inline-blocking burst to serialize (~{N*DELAY:.3f}s), "
        f"got wall={wall:.3f}s — the stub is not actually blocking the loop."
    )
    # Pre-fix: the loop was blocked, so the ticker could barely advance. It ticked
    # far fewer times than the free-loop expectation (wall / TICK_INTERVAL).
    expected_ticks = wall / TICK_INTERVAL
    assert ticks < expected_ticks * 0.5, (
        f"expected the loop ticker to STALL behind the blocked loop, but it ticked "
        f"{ticks} times over {wall:.3f}s (free-loop expectation ~{expected_ticks:.0f}) "
        f"— the stub is not actually blocking the loop."
    )
