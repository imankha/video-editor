"""T8000 — admin analytics handlers must not block the event loop.

Background: the app runs a SINGLE uvicorn worker with one asyncio event loop
(see .claude/knowledge/backend-services.md "Request concurrency model"). The
admin analytics handlers were `async def` with blocking psycopg2 calls inline,
so they ran ON the loop — a slow admin query stalled EVERY user's request for
its whole duration, not just the admin's. The fix converts them to plain `def`,
which FastAPI runs in its worker threadpool, off the loop.

This guard asserts the PROPERTY (concurrent overlap) with a controlled sleeping
stub instead of a wall-clock threshold on real I/O — the same philosophy as
test_t6200_concurrency. It is counterfactual-proof: reverting the handler to
`async def` turns wall time from ~DELAY into ~N*DELAY and fails the assertion.
"""
import asyncio
import contextlib
import inspect
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.main import app
from app.session_init import _init_cache

# X-User-ID admin auth needs an owned 8-hex profile so the middleware skips the
# R2-heavy session_init cold path (conftest's _register_test_profiles treats an
# _init_cache selected profile as owned). Then the ONLY get_pg call on the
# request path is inside the handler body under test.
_init_cache["admin-user"] = {"profile_id": "abcd1234", "is_new_user": False}

DELAY = 0.3   # how long the slow admin "DB" call blocks its thread
N = 6         # concurrent requests in the burst

# X-User-ID admin path + owned profile -> no validate_session, no session_init, so the
# middleware itself issues zero get_pg calls (it can't contaminate the measurement); the
# blocking get_pg is reached only inside the handler.
_HEADERS = {"X-User-ID": "admin-user", "X-Profile-ID": "abcd1234"}


def _seed_owned_profile(monkeypatch):
    """Pre-populate the profile-ownership registry cache so the middleware's guard
    resolves abcd1234 as owned via a pure dict lookup (peek_registered_profile_ids)
    and never calls load_registered_profile_ids -> user.sqlite. Without this, N cold
    concurrent requests race to open/create the same user.sqlite and intermittently
    raise `sqlite3 disk I/O error` (WAL contention). conftest's autouse fixture clears
    this cache around every test, so the seeding never leaks."""
    import app.session_init as _si
    monkeypatch.setitem(_si._profile_registry_cache, "admin-user", frozenset({"abcd1234"}))


class _FakeCursor:
    def execute(self, *a, **k):
        pass

    def fetchall(self):
        return []

    def fetchone(self):
        return None

    def close(self):
        pass


class _FakeConn:
    def cursor(self):
        return _FakeCursor()

    def commit(self):
        pass

    def rollback(self):
        pass


@contextlib.contextmanager
def _blocking_get_pg(*a, **k):
    """Stand-in for get_pg that BLOCKS its calling thread for DELAY (models a
    slow admin aggregate query), then yields an empty result set."""
    time.sleep(DELAY)
    yield _FakeConn()


_URL = "/api/admin/analytics/platforms?action=export_completed"


def test_slow_admin_analytics_does_not_serialize_concurrent_requests(monkeypatch):
    """N concurrent slow admin analytics requests must OVERLAP, not serialize.

    Each request's DB call blocks for DELAY. Because the handler is a sync `def`,
    FastAPI runs it in the threadpool, off the single event loop, so N of them run
    concurrently and the burst finishes in ~one DELAY. If the handler were `async
    def`, the inline blocking get_pg would hold the loop and the burst would take
    ~N*DELAY.

    Robustness: rather than an absolute wall-clock threshold (sensitive to load and
    to anyio's lazy per-thread pool warmup), we measure a single-request baseline t1
    in the SAME run and require the N-burst to finish in far less than the fully
    serialized N*t1 — the per-request overhead and machine load cancel out. A warmup
    burst first spawns the pool's worker threads so the timed burst isn't paying
    thread-creation cost. Verified counterfactually: flipping the handler back to
    `async def` makes the burst ~N*t1 and fails this assertion.
    """
    # Bypass the admin gate (its own get_pg check is not what we're measuring) and make
    # the handler's `from ..services.pg import get_pg` resolve to the blocking stub.
    monkeypatch.setattr("app.routers.admin._require_admin", lambda: None)
    monkeypatch.setattr("app.services.pg.get_pg", _blocking_get_pg)
    _seed_owned_profile(monkeypatch)

    async def go():
        asyncio.get_running_loop().set_default_executor(
            ThreadPoolExecutor(max_workers=32, thread_name_prefix="io-test")
        )
        tr = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=tr, base_url="http://testserver") as c:
            # Warm the threadpool (spawn N workers) so the timed burst pays no
            # thread-creation cost — anyio creates worker threads lazily one at a time.
            await asyncio.gather(*[c.get(_URL, headers=dict(_HEADERS)) for _ in range(N)])

            t0 = time.perf_counter()
            single = await c.get(_URL, headers=dict(_HEADERS))
            t1 = time.perf_counter() - t0     # baseline: one request, same load/overhead

            t0 = time.perf_counter()
            responses = await asyncio.gather(*[c.get(_URL, headers=dict(_HEADERS)) for _ in range(N)])
            tN = time.perf_counter() - t0     # N concurrent requests

            return single, responses, t1, tN

    single, responses, t1, tN = asyncio.run(go())

    assert single.status_code == 200
    assert all(r.status_code == 200 for r in responses), [r.status_code for r in responses]

    # Overlapped: tN ~= t1. Serialized (async on the loop): tN ~= N*t1. Half the
    # serialized projection cleanly separates the two and self-calibrates to load.
    assert tN < t1 * N * 0.5, (
        f"admin analytics serialized: N={N} concurrent took {tN:.3f}s vs a single "
        f"request's {t1:.3f}s (serialized projection ~{t1 * N:.3f}s). A handler is "
        f"likely back to async def, blocking the single event loop."
    )


def test_single_slow_request_actually_pays_the_delay(monkeypatch):
    """Sanity: a single request pays ~DELAY, so the overlap guard is measuring a
    real per-request cost (guards against the stub silently becoming a no-op)."""
    monkeypatch.setattr("app.routers.admin._require_admin", lambda: None)
    monkeypatch.setattr("app.services.pg.get_pg", _blocking_get_pg)
    _seed_owned_profile(monkeypatch)

    async def go():
        tr = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=tr, base_url="http://testserver") as c:
            t0 = time.perf_counter()
            r = await c.get(_URL, headers=dict(_HEADERS))
            return r, time.perf_counter() - t0

    response, wall = asyncio.run(go())
    assert response.status_code == 200
    assert wall >= DELAY * 0.8, f"single request too fast ({wall:.3f}s) — stub not blocking?"


def test_all_eight_analytics_handlers_are_sync_def():
    """Regression guard: FastAPI only threadpools PLAIN def handlers. If any of
    these reverts to `async def`, its blocking psycopg2 body is back on the loop.
    T8010 added analytics_journey and analytics_user_actions to T8000's original six."""
    from app.routers import admin
    for name in (
        "analytics_funnel",
        "analytics_channels",
        "analytics_share_funnel",
        "analytics_cohorts",
        "analytics_pulse",
        "analytics_platforms",
        "analytics_journey",
        "analytics_user_actions",
    ):
        fn = getattr(admin, name)
        assert not inspect.iscoroutinefunction(fn), (
            f"{name} is async def — it must be a plain def so FastAPI runs its "
            f"blocking DB body in the threadpool, off the event loop (T8000)."
        )
