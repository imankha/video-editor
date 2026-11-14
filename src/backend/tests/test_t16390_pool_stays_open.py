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
import threading
import time

import psycopg2
import pytest

from app.services import pg

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
