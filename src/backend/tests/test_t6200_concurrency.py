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
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from psycopg2.pool import PoolError

import app.services.pg as pg
from app.main import app
from app.middleware import RequestContextMiddleware
from app.services.pg import get_pg
from app.session_init import _init_cache

# T7520: the pg-bound burst test drives /api/probe with a valid 8-hex
# X-Profile-ID to skip session_init. The middleware now rejects an X-Profile-ID
# the session user does not own, so register this profile for the stub user
# (conftest's _register_test_profiles treats an _init_cache entry as owned).
_init_cache["t6200-user"] = {"profile_id": "abcd1234", "is_new_user": False}

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


# --------------------------------------------------------------------------
# Regression: PG-pool exhaustion under an authed burst must NOT 503.
#
# The executor bump (max_workers=32) lets up to 32 worker threads call
# validate_session -> get_pg -> pool.getconn() concurrently. psycopg2's
# ThreadedConnectionPool does NOT block when full — getconn() RAISES
# PoolError the instant len(_used) == maxconn. db_sync catches that and
# returns 503 + Retry-After. So a burst of MORE than maxconn concurrent
# authenticated requests would 503 where it previously merely queued on the
# event loop — the exact concurrency this task exists to enable.
#
# The fix is pg.py's BoundedSemaphore checkout gate (sized to maxconn):
# threads WAIT for a free connection instead of racing getconn past the
# ceiling. This test drives N > maxconn concurrent authed requests through
# the REAL RequestContextMiddleware + REAL get_pg against a fake pool with a
# small maxconn, and asserts every request returns 200 with zero 503s.
#
# Counterfactual: with the gate absent/ignored (the pre-fix commit), the
# fake pool raises PoolError past maxconn and the burst produces 503s — the
# assertion fails. The gate is what turns those into queued 200s.
# --------------------------------------------------------------------------

POOL_MAXCONN = 4          # deliberately below BURST so exhaustion is reachable
BURST = 8                 # concurrent authed requests (2x the pool capacity)
HOLD = 0.25               # how long each validate_session holds its connection


class _FakeCursor:
    """Minimal cursor supporting get_pg()'s pre-ping (`with conn.cursor()` +
    `execute("SELECT 1")`) and validate_session's trivial query."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, *args, **kwargs):
        pass

    def fetchone(self):
        return {"1": 1}

    def close(self):
        pass


class _FakeConn:
    def __init__(self):
        self.closed = 0

    def cursor(self):
        return _FakeCursor()

    def commit(self):
        pass

    def rollback(self):
        pass


class _FakePool:
    """Mimics psycopg2 ThreadedConnectionPool exhaustion semantics: getconn()
    RAISES PoolError once maxconn connections are checked out (it never waits)."""

    def __init__(self, maxconn):
        self.maxconn = maxconn
        self._used = {}
        self._lock = threading.Lock()

    def getconn(self):
        with self._lock:
            if len(self._used) >= self.maxconn:
                raise PoolError("connection pool exhausted")
            conn = _FakeConn()
            self._used[id(conn)] = conn
            return conn

    def putconn(self, conn, close=False):
        with self._lock:
            self._used.pop(id(conn), None)


def _pg_bound_validate_session(session_id):
    """Stand-in for validate_session that exercises the REAL get_pg checkout
    (subject to the gate) and HOLDS the connection for HOLD seconds, so a burst
    genuinely contends for the pool. Returns a valid session on success."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        time.sleep(HOLD)
    return {"user_id": "t6200-user", "email": "t6200@test.local"}


def _make_probe_app():
    """Minimal app carrying the REAL RequestContextMiddleware plus one trivial
    authenticated route that is NOT allowlisted (so a caught PoolError surfaces
    as a 503, not an allowlisted 200). A valid X-Profile-ID header skips the
    heavy session_init cold path; R2 is disabled in tests so no sync runs."""
    probe = FastAPI()

    @probe.get("/api/probe")
    async def _probe():
        return {"ok": True}

    probe.add_middleware(RequestContextMiddleware)
    return probe


async def _fire_authed_burst(n):
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(max_workers=32, thread_name_prefix="io-test")
    )
    transport = httpx.ASGITransport(app=_make_probe_app())
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver", cookies={"rb_session": "x"}
    ) as c:
        responses = await asyncio.gather(*[
            c.get("/api/probe", headers={"X-Profile-ID": "abcd1234"}) for _ in range(n)
        ])
    return responses


def test_pool_maxconn_exhaustion_check():
    """Sanity: the fake pool really does raise PoolError past maxconn (guards the
    regression below against the pool silently becoming unbounded)."""
    p = _FakePool(POOL_MAXCONN)
    held = [p.getconn() for _ in range(POOL_MAXCONN)]
    try:
        raised = False
        try:
            p.getconn()
        except PoolError:
            raised = True
        assert raised, "fake pool did not raise PoolError at maxconn — test is toothless"
    finally:
        for c in held:
            p.putconn(c)


def test_authed_burst_larger_than_pool_does_not_503():
    """BURST (> POOL_MAXCONN) concurrent authed requests must ALL return 200.

    Without the checkout gate, the requests past POOL_MAXCONN hit PoolError ->
    503. The gate makes them queue for a connection instead, so every request
    succeeds — latency, never errors, under the concurrency this task enables."""
    saved_pool = pg._pool
    saved_gate = getattr(pg, "_checkout_gate", None)
    pg._pool = _FakePool(POOL_MAXCONN)
    # Mirror init_pg_pool: the gate is sized to the pool's capacity. On the
    # pre-fix commit get_pg ignores this attribute, so the burst still 503s.
    pg._checkout_gate = threading.BoundedSemaphore(POOL_MAXCONN)
    try:
        with patch("app.middleware.db_sync.validate_session", _pg_bound_validate_session):
            responses = asyncio.run(_fire_authed_burst(BURST))
    finally:
        pg._pool = saved_pool
        pg._checkout_gate = saved_gate

    codes = [r.status_code for r in responses]
    assert codes.count(503) == 0, f"pool exhaustion 503'd an authed burst: {codes}"
    assert all(code == 200 for code in codes), codes
