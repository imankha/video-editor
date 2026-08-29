"""T5770: admin per-user usage — avg/week + last-7-days columns.

Two data strategies (no-redundant-state rule):
  * `avg_weekly_seconds` — DERIVED at read time in the admin endpoint from the
    existing running total and the signup date; stored nowhere.
  * `last_7d_seconds` — a NEW per-day bucket table (`user_usage_daily`) summed
    over the trailing 7 days, written ONLY via the shared `add_usage_seconds`
    helper (single write path) in the SAME transaction as the running total.

These tests are written test-first (Stage 3): they fail until the helper, the
schema, and the endpoint fields exist.
"""

from contextlib import contextmanager

import pytest

from app.analytics import add_usage_seconds, close_session, create_user_segment, update_session
from app.services.auth_db import create_user
from app.user_context import set_current_impersonator_id


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _seg(user_id: str) -> dict | None:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM user_segments WHERE user_id = %s", (user_id,))
        return cur.fetchone()


def _bucket(user_id: str) -> int | None:
    """Today's daily bucket for the user (None if no row)."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT seconds FROM user_usage_daily WHERE user_id = %s AND day = CURRENT_DATE",
            (user_id,),
        )
        row = cur.fetchone()
        return row["seconds"] if row else None


def _seed(user_id="user-a", *, total=0, acquired_days_ago=0):
    create_user(user_id, email=f"{user_id}@test.local")
    create_user_segment(user_id, "organic", None, "otp")
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE user_segments
               SET total_usage_seconds = %s,
                   current_session_start = NULL,
                   acquired_at = CURRENT_DATE - make_interval(days => %s)
               WHERE user_id = %s""",
            (total, acquired_days_ago, user_id),
        )


def _add_daily(user_id: str, days_ago: int, seconds: int):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO user_usage_daily (user_id, day, seconds)
               VALUES (%s, CURRENT_DATE - make_interval(days => %s), %s)
               ON CONFLICT (user_id, day) DO UPDATE SET seconds = EXCLUDED.seconds""",
            (user_id, days_ago, seconds),
        )


def _call_list_users():
    from unittest.mock import patch

    from app.routers import admin
    with patch.object(admin, "_require_admin", return_value=None), \
         patch.object(admin.credit_ledger, "stats_for_admin", return_value={}):
        # T8020: list_users is now a plain sync def (off the event loop via the FastAPI
        # threadpool), so call it directly — no asyncio.run.
        return admin.list_users(
            page=1, page_size=50,
            origin=None, acquired_from=None, acquired_to=None, filter=None,
        )


# --------------------------------------------------------------------------- #
# 1. shared write path: total + daily bucket move together
# --------------------------------------------------------------------------- #
class TestAddUsageSeconds:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        _seed("user-a", total=0)

    def test_updates_both_total_and_bucket(self, pg_conn):
        """One call bumps BOTH the running total and today's daily bucket."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            add_usage_seconds(conn.cursor(), "user-a", 120)
        assert _seg("user-a")["total_usage_seconds"] == 120
        assert _bucket("user-a") == 120

    def test_on_conflict_accumulates(self, pg_conn):
        """A second same-day increment ADDS (ON CONFLICT), never overwrites."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            add_usage_seconds(conn.cursor(), "user-a", 120)
        with get_pg() as conn:
            add_usage_seconds(conn.cursor(), "user-a", 30)
        assert _seg("user-a")["total_usage_seconds"] == 150
        assert _bucket("user-a") == 150

    def test_both_move_in_one_transaction(self, pg_conn):
        """total and bucket are written on the same cursor: a rollback drops BOTH,
        so they can never disagree (the single-write-path guarantee)."""
        from app.services.pg import get_pg
        with pytest.raises(RuntimeError), get_pg() as conn:
            add_usage_seconds(conn.cursor(), "user-a", 200)
            raise RuntimeError("force rollback")
        # neither side committed
        assert _seg("user-a")["total_usage_seconds"] == 0
        assert _bucket("user-a") is None

    def test_zero_is_noop(self, pg_conn):
        """0 engaged seconds (an instant session) writes no empty bucket row."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            add_usage_seconds(conn.cursor(), "user-a", 0)
        assert _seg("user-a")["total_usage_seconds"] == 0
        assert _bucket("user-a") is None


# --------------------------------------------------------------------------- #
# 2. both existing write sites route through the helper (single write path)
# --------------------------------------------------------------------------- #
class TestWriteSitesUseHelper:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.local")
        create_user_segment("user-a", "organic", None, "otp")

    def test_close_session_writes_bucket(self, pg_conn):
        """close_session (session-end site) banks into the daily bucket too."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - make_interval(mins => 10),
                       last_active_at = now() - make_interval(mins => 1),
                       total_usage_seconds = 0
                   WHERE user_id = %s""",
                ("user-a",),
            )
        close_session("user-a")
        # ~10 min confirmed span banked to both stores
        assert _seg("user-a")["total_usage_seconds"] == pytest.approx(600, abs=5)
        assert _bucket("user-a") == pytest.approx(600, abs=5)

    def test_session_rollover_writes_bucket(self, pg_conn):
        """update_session (session-rollover site) banks the prior session to the
        daily bucket when a >30-min gap starts a new session."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - make_interval(mins => 45),
                       last_active_at = now() - make_interval(mins => 35),
                       total_usage_seconds = 100
                   WHERE user_id = %s""",
                ("user-a",),
            )
        update_session("user-a")
        # 10 min (600s) prior session banked on top of the 100 base
        assert _seg("user-a")["total_usage_seconds"] == pytest.approx(700, abs=5)
        assert _bucket("user-a") == pytest.approx(600, abs=5)


# --------------------------------------------------------------------------- #
# 3. impersonation must not inflate the user's usage (either store)
# --------------------------------------------------------------------------- #
class TestImpersonationNoInflation:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.local")
        create_user_segment("user-a", "organic", None, "otp")
        yield
        set_current_impersonator_id(None)

    def test_impersonated_close_does_not_bank(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - make_interval(mins => 10),
                       last_active_at = now() - make_interval(mins => 1),
                       total_usage_seconds = 0
                   WHERE user_id = %s""",
                ("user-a",),
            )
        set_current_impersonator_id("admin-user")
        close_session("user-a")
        assert _seg("user-a")["total_usage_seconds"] == 0
        assert _bucket("user-a") is None

    def test_impersonated_update_does_not_bank(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - make_interval(mins => 45),
                       last_active_at = now() - make_interval(mins => 35),
                       total_usage_seconds = 100
                   WHERE user_id = %s""",
                ("user-a",),
            )
        set_current_impersonator_id("admin-user")
        update_session("user-a")
        assert _seg("user-a")["total_usage_seconds"] == 100
        assert _bucket("user-a") is None


# --------------------------------------------------------------------------- #
# 4. admin endpoint: derived avg/week + last-7d fields
# --------------------------------------------------------------------------- #
class TestAdminEndpointFields:
    def test_returns_both_new_fields(self, pg_conn):
        _seed("user-a", total=0, acquired_days_ago=0)
        by_id = {u["user_id"]: u for u in _call_list_users()["users"]}
        assert "avg_weekly_seconds" in by_id["user-a"]
        assert "last_7d_seconds" in by_id["user-a"]

    def test_avg_weekly_derivation(self, pg_conn):
        """avg = total / weeks_since_signup. 1400s over 2 weeks -> 700/wk."""
        _seed("user-a", total=1400, acquired_days_ago=14)
        u = {x["user_id"]: x for x in _call_list_users()["users"]}["user-a"]
        assert u["avg_weekly_seconds"] == pytest.approx(700, abs=2)

    def test_new_signup_clamps_to_one_week(self, pg_conn):
        """A brand-new signup (0 weeks) clamps to min 1 week: no divide-by-zero,
        no absurd average. total 500 over <1 week -> 500."""
        _seed("user-a", total=500, acquired_days_ago=0)
        u = {x["user_id"]: x for x in _call_list_users()["users"]}["user-a"]
        assert u["avg_weekly_seconds"] == pytest.approx(500, abs=2)

    def test_last_7d_sums_only_trailing_week(self, pg_conn):
        """last_7d sums the trailing 7 days (today..today-6) and EXCLUDES older
        buckets — real recorded data only, no backfill."""
        _seed("user-a", total=0, acquired_days_ago=30)
        _add_daily("user-a", 0, 100)    # today
        _add_daily("user-a", 3, 200)    # within window
        _add_daily("user-a", 6, 50)     # boundary, included
        _add_daily("user-a", 10, 999)   # older, excluded
        u = {x["user_id"]: x for x in _call_list_users()["users"]}["user-a"]
        assert u["last_7d_seconds"] == 350

    def test_last_7d_zero_when_no_buckets(self, pg_conn):
        """No recorded buckets -> honest 0 (not fabricated from the total)."""
        _seed("user-a", total=5000, acquired_days_ago=30)
        u = {x["user_id"]: x for x in _call_list_users()["users"]}["user-a"]
        assert u["last_7d_seconds"] == 0


# --------------------------------------------------------------------------- #
# 5. perf guard: admin list stays a BOUNDED number of queries (no N+1)
# --------------------------------------------------------------------------- #
class _CountingCursor:
    def __init__(self, real, counter):
        self._real = real
        self._counter = counter

    def execute(self, *a, **k):
        self._counter[0] += 1
        return self._real.execute(*a, **k)

    def __getattr__(self, name):
        return getattr(self._real, name)

    def __iter__(self):
        return iter(self._real)


class _CountingConn:
    def __init__(self, real, counter):
        self._real = real
        self._counter = counter

    def cursor(self, *a, **k):
        return _CountingCursor(self._real.cursor(*a, **k), self._counter)

    def __getattr__(self, name):
        return getattr(self._real, name)


class TestBoundedQueries:
    """Seed N users, hit the endpoint, assert the admin router's Postgres
    statement count is FLAT as N grows (last-7d is a single grouped join, not a
    per-user query). The project `query_counter` fixture wraps SQLite only and
    `list_users` is Postgres-only, so it would count 0 statements here — we count
    psycopg2 executes on admin.get_pg directly instead (same intent: no N+1)."""

    def _measure(self, prefix, n):
        from unittest.mock import patch

        from app.routers import admin
        for i in range(n):
            uid = f"{prefix}{i}"
            create_user(uid, email=f"{uid}@test.local")
            create_user_segment(uid, "organic", None, "otp")
            _add_daily(uid, 0, 60)

        counter = [0]
        base_get_pg = admin.get_pg  # pg_conn's mock_get_pg (NOT self-nested)

        @contextmanager
        def counting_get_pg():
            with base_get_pg() as conn:
                yield _CountingConn(conn, counter)

        with patch.object(admin, "get_pg", counting_get_pg), \
             patch.object(admin, "_require_admin", return_value=None), \
             patch.object(admin.credit_ledger, "stats_for_admin", return_value={}):
            # T8020: list_users is now a plain sync def — call it directly.
            admin.list_users(
                page=1, page_size=50,
                origin=None, acquired_from=None, acquired_to=None, filter=None,
            )
        return counter[0]

    def test_query_count_flat_under_growth(self, pg_conn):
        # bounded-* ids are not in _TEST_USER_IDS, so clean them up explicitly.
        from app.services.pg import get_pg
        try:
            small = self._measure("bounded-a-", 2)
            large = self._measure("bounded-b-", 7)
            assert small == large, (
                f"admin list query count grew with user count ({small} -> {large}) "
                f"— N+1 regression in the last-7d / avg join"
            )
        finally:
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM user_usage_daily WHERE user_id LIKE 'bounded-%'")
                cur.execute("DELETE FROM user_segments WHERE user_id LIKE 'bounded-%'")
                cur.execute("DELETE FROM users WHERE user_id LIKE 'bounded-%'")
