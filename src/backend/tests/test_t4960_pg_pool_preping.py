"""T4960: PG pool pre-pings at checkout so a stale (server-closed) connection is
never handed to application code.

Fly Postgres closes idle client sockets while the pool still holds them
(``conn.closed`` stays 0). The first request after an idle window used to eat the
dead socket and return 500. ``get_pg()`` now runs a cheap ``SELECT 1`` at checkout,
discarding+refetching stale conns (up to ``maxconn`` retries) on
``OperationalError``/``InterfaceError`` and logging a WARNING per discard. The ping
is gated by idle age: conns reused within ``_IDLE_PING_THRESHOLD_S`` skip it.

These tests use a FAKE pool (no real Postgres) so they are hermetic — they must
NOT use the ``pg_conn`` fixture (which truncates shared dev tables).
"""

import logging
import time

import psycopg2
import pytest

from app.services import pg

# conftest.py has a session-scoped autouse fixture that patches
# ``app.services.pg.get_pg`` with a MagicMock stub (so app-level tests bypass the
# real pool). We need the REAL context manager here — capture it at import time,
# which runs during collection, before any fixture (and thus the stub) is active.
_real_get_pg = pg.get_pg


class FakeCursor:
    def __init__(self, execute_error=None):
        self._execute_error = execute_error
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append(sql)
        if self._execute_error is not None:
            raise self._execute_error

    def fetchone(self):
        return {"?column?": 1}

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class FakeConn:
    """Stand-in for a psycopg2 connection.

    ``ping_error`` (if set) is raised by ``cursor().execute`` — this models a
    server-closed socket that psycopg2 hasn't noticed yet (``closed`` still 0).
    """

    def __init__(self, ping_error=None, closed=False):
        self._ping_error = ping_error
        self.closed = closed
        self.commits = 0
        self.rollbacks = 0
        self.cursors = []

    def cursor(self, *args, **kwargs):
        cur = FakeCursor(execute_error=self._ping_error)
        self.cursors.append(cur)
        return cur

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakePool:
    def __init__(self, conns, maxconn=10):
        self._conns = list(conns)
        self.maxconn = maxconn
        self.getconn_calls = 0
        self.putconn_calls = []  # list of (conn, close_flag)

    def getconn(self):
        self.getconn_calls += 1
        if not self._conns:
            raise AssertionError("getconn() called more times than the test provisioned")
        return self._conns.pop(0)

    def putconn(self, conn, close=False):
        self.putconn_calls.append((conn, close))


def _op_error(msg="server closed the connection unexpectedly"):
    return psycopg2.OperationalError(msg)


@pytest.fixture(autouse=True)
def _isolate_last_returned(monkeypatch):
    """Give every test a clean idle-age ledger so id() reuse across tests can't
    make a fresh FakeConn look 'recently returned' and skip its ping."""
    monkeypatch.setattr(pg, "_last_returned", {})


def test_several_stale_then_healthy_recovers(monkeypatch, caplog):
    """After idle, MORE than one pooled conn is stale (the T4960 live-drive
    scenario). get_pg must keep discarding stale conns past the old 2-attempt
    bound until it reaches the healthy one, then yield it."""
    dead1 = FakeConn(ping_error=_op_error())
    dead2 = FakeConn(ping_error=_op_error())
    dead3 = FakeConn(ping_error=_op_error())
    healthy = FakeConn()
    pool = FakePool([dead1, dead2, dead3, healthy], maxconn=10)
    monkeypatch.setattr(pg, "_pool", pool)

    with caplog.at_level(logging.WARNING):
        with _real_get_pg() as conn:
            assert conn is healthy

    # All three stale conns discarded with close=True
    for dead in (dead1, dead2, dead3):
        assert (dead, True) in pool.putconn_calls
    # Healthy connection was checked back in at the end (close reflects .closed=False)
    assert pool.putconn_calls[-1] == (healthy, False)
    # A WARNING naming the discard was logged (grepped for in the Fly logs)
    assert "discarded stale connection" in caplog.text
    # Four checkouts: three stale then healthy — proves the bound exceeds 2
    assert pool.getconn_calls == 4


def test_all_stale_raises_bounded(monkeypatch):
    """When every checkout is stale, get_pg raises after exactly maxconn+1
    attempts (no infinite loop), discarding each with close=True."""
    deads = [FakeConn(ping_error=_op_error(f"closed {i}")) for i in range(3)]
    pool = FakePool(deads, maxconn=2)  # bound = maxconn + 1 = 3
    monkeypatch.setattr(pg, "_pool", pool)

    with pytest.raises(psycopg2.OperationalError):
        with _real_get_pg():
            pass

    assert pool.getconn_calls == 3  # maxconn + 1, bounded
    for dead in deads:
        assert (dead, True) in pool.putconn_calls


def test_healthy_first_single_ping_no_discard(monkeypatch):
    """A live conn is pinged exactly once (one SELECT 1) and yielded as-is —
    no discard, no extra checkout."""
    healthy = FakeConn()
    pool = FakePool([healthy])
    monkeypatch.setattr(pg, "_pool", pool)

    with _real_get_pg() as conn:
        assert conn is healthy

    assert pool.getconn_calls == 1
    # Nothing was discarded with close=True
    assert all(close is False for (_, close) in pool.putconn_calls)
    # Exactly one pre-ping SELECT 1 executed
    ping_statements = [sql for cur in healthy.cursors for sql in cur.executed]
    assert ping_statements == ["SELECT 1"]
    # The ping's read transaction was rolled back so it can't leak state
    assert healthy.rollbacks == 1


def test_recently_returned_conn_skips_ping(monkeypatch):
    """Idle-age gate: a conn returned within the threshold is handed out WITHOUT
    a pre-ping (hot path pays no extra round-trip)."""
    healthy = FakeConn()
    pool = FakePool([healthy])
    monkeypatch.setattr(pg, "_pool", pool)
    # Mark it as returned just now (idle age ~0 < threshold)
    pg._last_returned[id(healthy)] = time.monotonic()

    with _real_get_pg() as conn:
        assert conn is healthy

    assert pool.getconn_calls == 1
    # No cursor was ever opened -> no SELECT 1 ping happened
    assert healthy.cursors == []
    assert healthy.rollbacks == 0


def test_long_idle_conn_is_pinged(monkeypatch):
    """Idle-age gate: a conn that has sat idle past the threshold IS pre-pinged
    (the after-idle case this fix targets)."""
    healthy = FakeConn()
    pool = FakePool([healthy])
    monkeypatch.setattr(pg, "_pool", pool)
    # Returned an hour ago -> well past the threshold
    pg._last_returned[id(healthy)] = time.monotonic() - 3600

    with _real_get_pg() as conn:
        assert conn is healthy

    ping_statements = [sql for cur in healthy.cursors for sql in cur.executed]
    assert ping_statements == ["SELECT 1"]


def test_ledger_does_not_leak_on_overflow_close(monkeypatch):
    """psycopg2 closes a conn returned while the pool is over minconn. The idle-age
    ledger must not retain an entry for such a conn (else id() reuse -> wrong skip
    and unbounded growth)."""

    class OverflowClosingPool(FakePool):
        def putconn(self, conn, close=False):
            super().putconn(conn, close=close)
            conn.closed = True  # psycopg2 closes overflow / close=True conns on check-in

    healthy = FakeConn()
    pool = OverflowClosingPool([healthy])
    monkeypatch.setattr(pg, "_pool", pool)

    with _real_get_pg() as conn:
        assert conn is healthy

    # Closed on check-in -> no lingering ledger entry, ledger stays empty
    assert id(healthy) not in pg._last_returned
    assert pg._last_returned == {}
