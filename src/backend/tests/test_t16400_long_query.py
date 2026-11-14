"""T16400:C5: the new limits never cut off a long admin/analytics query.

T16400 bounds the CONNECT (connect_timeout), unacknowledged sends (tcp_user_timeout)
and the auth middleware's session check (SESSION_CHECK_TIMEOUT_S). None of them is a
statement limit, so a query that runs longer than all of them, through the real pool
with its real connection settings, must still finish. This is a non-regression check:
it passes before and after T16400, and fails if a global statement_timeout is added.
"""

import os
import time

import pytest

from app.middleware.db_sync import SESSION_CHECK_TIMEOUT_S
from app.services import pg

_real_get_pg = pg.get_pg
_real_init_pg_pool = pg.init_pg_pool

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="needs a real Postgres (DATABASE_URL)"
)

LONG_QUERY_S = 6.0


@pytest.fixture
def real_pool():
    saved = (pg._pool, pg._checkout_gate, dict(pg._last_returned))
    pg._pool = None
    pg._last_returned.clear()
    _real_init_pg_pool()
    try:
        yield
    finally:
        pg.close_pg_pool()
        pg._pool, pg._checkout_gate = saved[0], saved[1]
        pg._last_returned.clear()
        pg._last_returned.update(saved[2])


def test_c5_query_longer_than_every_new_limit_finishes(real_pool):
    assert LONG_QUERY_S > SESSION_CHECK_TIMEOUT_S
    assert LONG_QUERY_S > pg._CONNECT_TIMEOUT_S
    with _real_get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SHOW statement_timeout")
        assert cur.fetchone()["statement_timeout"] == "0", "a statement limit is set on pooled connections"
        t0 = time.monotonic()
        cur.execute("SELECT pg_sleep(%s), 1 AS done", (LONG_QUERY_S,))
        assert cur.fetchone()["done"] == 1
        assert time.monotonic() - t0 >= LONG_QUERY_S
