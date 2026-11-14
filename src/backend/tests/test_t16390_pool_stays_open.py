"""T16390: the Postgres pool keeps all ``_MAX_POOL_CONN`` connections open.

Before: ``ThreadedConnectionPool(minconn=2, ...)``. psycopg2 opens a missing
connection inside ``getconn()`` WHILE HOLDING the pool lock, and ``putconn()``
closes any connection returned while the free list already holds ``minconn``.
So every burst past two requests re-opened connections one after another
(prod, 2026-11-13: 12 parallel requests took 2.0 s each, +0.17 s per extra
request). After: ``minconn == maxconn``; a burst finds them ready and nothing
is closed afterwards.

These tests use the real pool against DATABASE_URL (no tables touched, so they
do not use the ``pg_conn`` fixture). ``psycopg2.connect`` is wrapped to count
connects and add ``CONNECT_LATENCY_S`` per connect, modelling the cross-region
connect cost measured on prod.
"""

import os
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from unittest.mock import patch

import psycopg2
import pytest

from app.services import auth_db, pg

# conftest patches pg.get_pg / pg.init_pg_pool with stubs for app tests; capture
# the real ones at collection time (same pattern as test_t4960_pg_pool_preping.py).
_real_get_pg = pg.get_pg
_real_init_pg_pool = pg.init_pg_pool

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="needs a real Postgres (DATABASE_URL)"
)

CONNECT_LATENCY_S = 0.17
BURST = 12
HOLD_S = 0.05  # each request's own work while it holds a connection
# The before-number recorded in the task file (## Measurement): 12 at once took 1.50 s.
RECORDED_BEFORE_S = 1.50
# One LA -> Chicago round trip; a session lookup is one query on a pooled connection.
LOOKUP_RTT_S = 0.045
INVALID_COOKIE = "probe-not-a-real-session"


@pytest.fixture
def real_pool(monkeypatch):
    """A freshly initialised real pool (as at server start); restored afterwards."""
    saved = (pg._pool, pg._checkout_gate, dict(pg._last_returned))
    monkeypatch.setattr(pg, "get_pg", _real_get_pg)
    pg._pool = None
    pg._last_returned.clear()
    _real_init_pg_pool()
    try:
        yield pg._pool
    finally:
        pg.close_pg_pool()
        pg._pool, pg._checkout_gate = saved[0], saved[1]
        pg._last_returned.clear()
        pg._last_returned.update(saved[2])


@pytest.fixture
def slow_connects(monkeypatch):
    """Count psycopg2.connect calls made from now on and make each one slow."""
    real_connect = psycopg2.connect
    calls = []

    def _slow_connect(*args, **kwargs):
        calls.append(time.monotonic())
        time.sleep(CONNECT_LATENCY_S)
        return real_connect(*args, **kwargs)

    monkeypatch.setattr(psycopg2, "connect", _slow_connect)
    return calls


def _open_pooled(pool):
    return [c for c in pool._pool if not c.closed]


def _burst():
    """BURST simultaneous checkouts; returns (wall seconds, errors)."""
    barrier = threading.Barrier(BURST)
    errors = []

    def _one():
        barrier.wait()
        try:
            with pg.get_pg() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                time.sleep(HOLD_S)
        except Exception as e:  # collected and asserted by the caller
            errors.append(e)

    threads = [threading.Thread(target=_one) for _ in range(BURST)]
    t0 = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return time.monotonic() - t0, errors


def test_c3_startup_opens_every_connection(real_pool):
    """Cold start: init_pg_pool leaves all _MAX_POOL_CONN connections open and live."""
    open_conns = _open_pooled(real_pool)
    assert len(open_conns) == pg._MAX_POOL_CONN, (
        f"pool opened {len(open_conns)} connections at start, want {pg._MAX_POOL_CONN}"
    )
    with pg.get_pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 AS ok")
        assert cur.fetchone()["ok"] == 1


def test_c2_burst_opens_no_connections_and_is_3x_faster(real_pool, slow_connects):
    """Two bursts of 12: no connection is opened (or closed) and each burst finishes
    in under a third of the serial-connect time the old pool paid."""
    # Old pool: 8 extra connections opened one after another under the pool lock.
    serial_before_s = (BURST - 2) * CONNECT_LATENCY_S
    for round_no in (1, 2):
        wall, errors = _burst()
        assert not errors, errors
        assert len(slow_connects) == 0, (
            f"burst {round_no} opened {len(slow_connects)} connections one after another "
            f"({wall:.2f}s for {BURST} requests)"
        )
        assert wall < serial_before_s / 3, f"burst {round_no} took {wall:.2f}s"
        assert len(_open_pooled(real_pool)) == pg._MAX_POOL_CONN, (
            f"after burst {round_no} the pool holds {len(_open_pooled(real_pool))} open connections"
        )


def test_c3_after_suspend_dead_connections_are_replaced_and_kept(real_pool):
    """Resume from suspend: Postgres has dropped every pooled socket. A burst still
    succeeds (pre-ping discards the dead ones and reconnects), no dead connection
    stays pooled, and the replacements are kept open (the pool regrows on demand,
    never shrinks below what a burst opened)."""
    pids = [c.get_backend_pid() for c in real_pool._pool]
    assert len(pids) == pg._MAX_POOL_CONN
    killer = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        killer.autocommit = True
        with killer.cursor() as cur:
            cur.execute("SELECT pg_terminate_backend(pid) FROM unnest(%s::int[]) AS pid", (pids,))
    finally:
        killer.close()
    # Make every pooled connection look idle so get_pg pre-pings it (as after suspend).
    pg._last_returned.clear()

    _wall, errors = _burst()
    assert not errors, errors
    pooled = list(real_pool._pool)
    assert pooled, "pool kept no connection after the burst"
    assert not {c.get_backend_pid() for c in pooled} & set(pids), "a dead connection stayed pooled"
    for c in pooled:  # every kept connection is live
        with c.cursor() as cur:
            cur.execute("SELECT 1 AS ok")
            assert cur.fetchone()["ok"] == 1
        c.rollback()

    _wall, errors = _burst()
    assert not errors, errors
    assert len(_open_pooled(real_pool)) >= len(pooled), "the pool closed connections after a burst"


@contextmanager
def _uvicorn(lifespan):
    """The app served by a real uvicorn server, as in production; yields (base url, server)."""
    import uvicorn

    from app.main import app
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=port, lifespan=lifespan, log_level="warning",
    ))
    thread = threading.Thread(target=server.run, daemon=True)
    t0 = time.monotonic()
    thread.start()
    while not server.started and thread.is_alive() and time.monotonic() - t0 < 60:
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}", server
    finally:
        server.should_exit = True
        thread.join(30)


def _http_burst(base_url, path, session_ids):
    """BURST barrier-synced GETs, one client each with its own rb_session cookie;
    returns (wall seconds, status codes)."""
    import httpx

    barrier = threading.Barrier(BURST + 1)

    def one(i):
        with httpx.Client(base_url=base_url, cookies={"rb_session": session_ids[i]}, timeout=30) as c:
            barrier.wait()
            return c.get(path).status_code

    with ThreadPoolExecutor(max_workers=BURST) as ex:
        futures = [ex.submit(one, i) for i in range(BURST)]
        barrier.wait()
        t0 = time.monotonic()
        codes = [f.result() for f in futures]
    return time.monotonic() - t0, codes


@pytest.mark.parametrize("cookies", ["same", "distinct"])
def test_c2_twelve_requests_with_invalid_cookie_3x_faster_than_recorded(
    real_pool, slow_connects, tmp_path, monkeypatch, cookies
):
    """12 simultaneous HTTP requests with an invalid rb_session cookie, on a real
    server whose pool was opened at start: each request asks Postgres about the
    cookie (an invalid session is never remembered), every connect costs 0.17 s and
    every lookup one cross-region round trip. The burst answers within a third of
    the recorded before-number, twice in a row. "same": one cookie, as the staging
    curl sends (red on a per-request lookup queue: 12 serial round trips).
    "distinct": 12 different invalid cookies, 12 lookups at once (red on the old
    pool: 8 connects opened one after another)."""
    lookups = []

    @contextmanager
    def rtt_get_pg():
        lookups.append(1)
        with _real_get_pg() as conn:
            time.sleep(LOOKUP_RTT_S)
            yield conn

    monkeypatch.setattr(auth_db, "get_pg", rtt_get_pg)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch.dict(os.environ, {"APP_ENV": "production"}), \
         _uvicorn("off") as (base_url, _server):
        for round_no in (1, 2):
            lookups.clear()
            session_ids = [INVALID_COOKIE if cookies == "same" else f"{INVALID_COOKIE}-{i}"
                           for i in range(BURST)]
            wall, codes = _http_burst(base_url, "/api/version", session_ids)
            assert codes == [200] * BURST, codes
            assert wall <= RECORDED_BEFORE_S / 3, (
                f"burst {round_no}: {BURST} requests took {wall:.2f}s, limit "
                f"{RECORDED_BEFORE_S / 3:.2f}s; {len(slow_connects)} connects opened"
            )
            # Each burst asks Postgres (an invalid cookie is never remembered); one
            # cookie's requests share in-flight lookups instead of queueing.
            if cookies == "same":
                assert 1 <= len(lookups) < BURST, f"burst {round_no}: {len(lookups)} lookups"
            else:
                assert len(lookups) == BURST, f"burst {round_no}: {len(lookups)} lookups"


def test_c3_server_starts_and_passes_health_check_cold_and_after_suspend(tmp_path, monkeypatch):
    """Cold start through the real lifespan (pool + schema), then the health check;
    then Postgres drops every pooled socket (as after a Fly suspend), and the health
    check and a request that asks Postgres both still answer."""
    import httpx

    monkeypatch.setattr(pg, "init_pg_pool", _real_init_pg_pool)
    monkeypatch.setattr(pg, "get_pg", _real_get_pg)
    monkeypatch.setattr(auth_db, "get_pg", _real_get_pg)
    saved = (pg._pool, pg._checkout_gate, dict(pg._last_returned))
    pg._pool = None
    pg._last_returned.clear()
    try:
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch.dict(os.environ, {"APP_ENV": "production"}), \
             _uvicorn("on") as (base_url, server), \
             httpx.Client(base_url=base_url, timeout=30) as c:
            assert server.started, "server did not finish starting within 60 s"
            assert c.get("/api/health").status_code == 200
            pooled = _open_pooled(pg._pool)
            assert len(pooled) == pg._MAX_POOL_CONN, (
                f"server started with {len(pooled)} open connections, want {pg._MAX_POOL_CONN}"
            )

            pids = [conn.get_backend_pid() for conn in pooled]
            killer = psycopg2.connect(os.environ["DATABASE_URL"])
            try:
                killer.autocommit = True
                with killer.cursor() as cur:
                    cur.execute("SELECT pg_terminate_backend(pid) FROM unnest(%s::int[]) AS pid", (pids,))
            finally:
                killer.close()
            pg._last_returned.clear()  # every pooled connection now looks idle

            assert c.get("/api/health").status_code == 200
            # A request that asks Postgres: an invalid cookie is checked and refused
            # (401), not answered "database unavailable" (503).
            c.cookies.set("rb_session", INVALID_COOKIE)
            assert c.get("/api/projects").status_code == 401
    finally:
        pg._pool, pg._checkout_gate = saved[0], saved[1]
        pg._last_returned.clear()
        pg._last_returned.update(saved[2])
