"""T8670: scheduled reconciliation drift-alert pass (Revenue Record Integrity 6/6).

Proves the weekly background pass:
- alerts (CRITICAL log + admin email attempt) on `unknown` drift,
- alerts on a pending dispute even with no `unknown` rows,
- stays SILENT when every row is explained,
- is guarded by a single Postgres advisory lock so two concurrent passes alert
  exactly once, not once per machine,
- writes NOTHING (read-only): user_segments / payments / account_deletions are
  byte-for-byte unchanged across a run against a genuinely drifted fixture.

Stripe is fully mocked (fetch_stripe_intents patched); no live key, no network.
Runs against an ISOLATED test database (t8670_test), never the shared dev DB.
"""

import asyncio
import logging
from unittest.mock import AsyncMock, patch

import psycopg2
import pytest

# Reuse the pure Stripe-fixture builder from the T5760/T8640 recon tests.
from tests.test_revenue_reconciliation import make_pi

# ---------------------------------------------------------------------------
# Seeding helpers (Postgres via the pg_conn fixture)
# ---------------------------------------------------------------------------

def _seed_segment(user_id, cents):
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_segments (user_id, total_spent_cents) VALUES (%s, %s) "
            "ON CONFLICT (user_id) DO UPDATE SET total_spent_cents = EXCLUDED.total_spent_cents",
            (user_id, cents),
        )


def _table_snapshot(dsn):
    """Row counts + full contents of the three tables the pass must never write."""
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        snap = {}
        cur.execute("SELECT user_id, total_spent_cents FROM user_segments ORDER BY user_id")
        snap["user_segments"] = cur.fetchall()
        cur.execute("SELECT user_id, amount_cents, kind FROM payments ORDER BY id")
        snap["payments"] = cur.fetchall()
        cur.execute("SELECT user_id, actor, path FROM account_deletions ORDER BY id")
        snap["account_deletions"] = cur.fetchall()
        return snap
    finally:
        conn.close()


@pytest.fixture()
def recon_alert_env(pg_conn, monkeypatch):
    """Admin user + one admin_users recipient; Stripe key set (calls are mocked).

    Yields the DSN so a test can open its OWN raw connection to hold the
    advisory lock (a separate session from the pass's connection).
    """
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    # Pin admin_users to EXACTLY one recipient (the fixture seed also adds the
    # real imankh@ admin), so "one alert" maps deterministically to one email.
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM admin_users")
        cur.execute("INSERT INTO admin_users (email) VALUES ('test-admin@test.local')")
    monkeypatch.setattr("stripe.api_key", "sk_test_dummy")
    yield pg_conn  # pg_conn yields the dsn string


def _run_pass(fixture, send_mock):
    """Run one pass with Stripe mocked to `fixture` and the email send spied on."""
    from app.services import reconciliation_alert
    with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture), \
         patch.object(reconciliation_alert, "send_admin_update_email", send_mock):
        return asyncio.run(reconciliation_alert.run_reconciliation_alert_pass())


# ---------------------------------------------------------------------------
# Alert-condition behaviour
# ---------------------------------------------------------------------------

class TestReconciliationAlertPass:
    def test_unknown_drift_produces_exactly_one_alert(self, recon_alert_env, caplog):
        # Live account, local 699 but Stripe net 399 with no refund/dispute to
        # explain it -> `unknown` -> must alert (log line + one email attempt).
        from app.services.auth_db import create_user
        create_user("user-a", email="a@test.local")
        _seed_segment("user-a", 699)
        fixture = [make_pi("user-a", 399, pi_id="pi_unknown")]

        send_mock = AsyncMock(return_value=True)
        with caplog.at_level(logging.CRITICAL, logger="app.services.reconciliation_alert"):
            result = _run_pass(fixture, send_mock)

        assert result["status"] == "alerted"
        assert "user-a" in result["user_ids"]
        # Exactly one email attempt (one admin recipient), not one per machine.
        assert send_mock.await_count == 1
        # A greppable CRITICAL drift line naming the user.
        drift_logs = [r for r in caplog.records if r.levelno == logging.CRITICAL
                      and "DRIFT" in r.getMessage()]
        assert len(drift_logs) == 1
        assert "user-a" in drift_logs[0].getMessage()

    def test_all_explained_is_silent(self, recon_alert_env, caplog):
        # aligned + refund + test_mode_era + account_deleted are all EXPLAINED:
        # no `unknown`, no pending dispute -> no alert at all.
        # user-a/b/c are in conftest's _TEST_USER_IDS so pg_conn cleans them.
        from app.services.auth_db import create_user
        create_user("user-a", email="aligned@test.local")
        create_user("user-b", email="refund@test.local")
        create_user("user-c", email="testera@test.local")
        _seed_segment("user-a", 399)   # == net 399 -> aligned
        _seed_segment("user-b", 699)   # net 399 after refund -> refund
        _seed_segment("user-c", 999)   # no live history -> test_mode_era
        fixture = [
            make_pi("user-a", 399, pi_id="pi_al"),
            make_pi("user-b", 699, refunded=300, pi_id="pi_re"),
        ]

        send_mock = AsyncMock(return_value=True)
        with caplog.at_level(logging.CRITICAL, logger="app.services.reconciliation_alert"):
            result = _run_pass(fixture, send_mock)

        assert result["status"] == "silent"
        assert send_mock.await_count == 0
        drift_logs = [r for r in caplog.records if r.levelno == logging.CRITICAL
                      and "DRIFT" in r.getMessage()]
        assert drift_logs == []

    def test_pending_dispute_alerts_without_unknown(self, recon_alert_env, caplog):
        # An OPEN dispute on an otherwise-aligned account: no `unknown` row, but
        # the pending dispute is a deadline that must still be surfaced.
        from app.services.auth_db import create_user
        create_user("user-a", email="disp@test.local")
        _seed_segment("user-a", 399)  # local == net (open dispute not subtracted)
        fixture = [make_pi("user-a", 399,
                           dispute={"status": "warning_needs_response", "amount": 399},
                           pi_id="pi_disp")]

        send_mock = AsyncMock(return_value=True)
        with caplog.at_level(logging.CRITICAL, logger="app.services.reconciliation_alert"):
            result = _run_pass(fixture, send_mock)

        assert result["status"] == "alerted"
        assert "user-a" in result["user_ids"]
        assert send_mock.await_count == 1
        drift_logs = [r for r in caplog.records if r.levelno == logging.CRITICAL
                      and "DRIFT" in r.getMessage()]
        assert len(drift_logs) == 1
        assert "dispute" in drift_logs[0].getMessage().lower()


# ---------------------------------------------------------------------------
# Single-machine coordination (Postgres advisory lock)
# ---------------------------------------------------------------------------

class TestAdvisoryLockGuard:
    def test_two_concurrent_passes_alert_exactly_once(self, recon_alert_env, caplog):
        dsn = recon_alert_env
        from app.services.auth_db import create_user
        from app.services.reconciliation_alert import RECONCILIATION_ALERT_LOCK_ID
        create_user("user-a", email="a@test.local")
        _seed_segment("user-a", 699)
        fixture = [make_pi("user-a", 399, pi_id="pi_unknown")]

        # Machine 1: hold the advisory lock in its own session for the whole
        # duration of machine 2's pass.
        holder = psycopg2.connect(dsn)
        try:
            hc = holder.cursor()
            hc.execute("SELECT pg_try_advisory_lock(%s)", (RECONCILIATION_ALERT_LOCK_ID,))
            assert hc.fetchone()[0] is True
            holder.commit()

            # Machine 2: runs its pass while the lock is held -> must skip
            # entirely (no log, no email).
            send_mock = AsyncMock(return_value=True)
            with caplog.at_level(logging.CRITICAL, logger="app.services.reconciliation_alert"):
                contended = _run_pass(fixture, send_mock)
            assert contended["status"] == "skipped_locked"
            assert send_mock.await_count == 0
            assert [r for r in caplog.records if r.levelno == logging.CRITICAL
                    and "DRIFT" in r.getMessage()] == []
        finally:
            hc.execute("SELECT pg_advisory_unlock(%s)", (RECONCILIATION_ALERT_LOCK_ID,))
            holder.commit()
            holder.close()

        # Lock now free: a subsequent pass alerts exactly once.
        send_mock2 = AsyncMock(return_value=True)
        result = _run_pass(fixture, send_mock2)
        assert result["status"] == "alerted"
        assert send_mock2.await_count == 1


# ---------------------------------------------------------------------------
# Lock RELEASE path (the half mock_get_pg cannot exercise: it closes the
# connection on exit, so it would release the lock even if the explicit
# pg_advisory_unlock were deleted). These drive the pass through a get_pg that
# keeps the connection OPEN afterwards -- exactly the pooled-connection case the
# module exists for.
# ---------------------------------------------------------------------------

class TestLockReleasePath:
    def _keepalive_get_pg(self, dsn, open_conns):
        """A get_pg that yields a real connection and returns it to the caller's
        list ALIVE (never closed) -- mimics the pool handing a connection back
        without disconnecting it."""
        from contextlib import contextmanager

        from psycopg2.extras import RealDictCursor

        @contextmanager
        def _cm():
            conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
            open_conns.append(conn)
            try:
                yield conn
                conn.commit()
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                try:
                    conn.rollback()
                except Exception:
                    pass  # discarded like the pool would
            except Exception:
                conn.rollback()
                raise
            # Deliberately does NOT close: the lock must be released by the
            # explicit pg_advisory_unlock, not by the connection closing.
        return _cm

    def test_explicit_unlock_releases_on_a_still_open_connection(self, recon_alert_env):
        # MAJOR #2 guard: prove the pass's pg_advisory_unlock (not connection
        # close) frees the lock. If the finally's unlock were deleted, the lock
        # would still be held by the (still-open) pass connection and the probe
        # below would fail to acquire it.
        dsn = recon_alert_env
        from app.services import reconciliation_alert
        from app.services.auth_db import create_user
        from app.services.reconciliation_alert import RECONCILIATION_ALERT_LOCK_ID
        create_user("user-a", email="a@test.local")
        _seed_segment("user-a", 699)
        fixture = [make_pi("user-a", 399, pi_id="pi_unknown")]

        open_conns = []
        cm = self._keepalive_get_pg(dsn, open_conns)
        send_mock = AsyncMock(return_value=True)
        try:
            with patch("app.services.pg.get_pg", cm), \
                 patch("app.routers.admin.get_pg", cm), \
                 patch("app.services.auth_db.get_pg", cm), \
                 patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture), \
                 patch.object(reconciliation_alert, "send_admin_update_email", send_mock):
                result = asyncio.run(reconciliation_alert.run_reconciliation_alert_pass())
            assert result["status"] == "alerted"  # the pass acquired + ran fully

            # Every connection the pass used is still OPEN. A separate session can
            # only take the lock if the pass released it via pg_advisory_unlock.
            probe = psycopg2.connect(dsn)
            try:
                pc = probe.cursor()
                pc.execute("SELECT pg_try_advisory_lock(%s)", (RECONCILIATION_ALERT_LOCK_ID,))
                assert pc.fetchone()[0] is True
                pc.execute("SELECT pg_advisory_unlock(%s)", (RECONCILIATION_ALERT_LOCK_ID,))
                probe.commit()
            finally:
                probe.close()
        finally:
            for c in open_conns:
                try:
                    c.close()
                except Exception:
                    pass

    def test_unlock_failure_forces_close_and_releases_lock(self, recon_alert_env, caplog):
        # MAJOR #1 guard: if the unlock statement itself raises (dead socket), the
        # pass must log CRITICAL and force the connection closed so the lock cannot
        # ride a live pooled connection forever (silent stall). Closing ends the
        # server session, which releases the lock -- proven by the probe.
        dsn = recon_alert_env
        from contextlib import contextmanager

        from psycopg2.extras import RealDictCursor

        from app.services import reconciliation_alert
        from app.services.auth_db import create_user
        from app.services.reconciliation_alert import RECONCILIATION_ALERT_LOCK_ID
        create_user("user-a", email="a@test.local")
        _seed_segment("user-a", 699)
        fixture = [make_pi("user-a", 399, pi_id="pi_unknown")]

        lock_conns = []

        class _UnlockRaisesCursor:
            def __init__(self, real):
                self._real = real
            def execute(self, sql, params=None):
                if "pg_advisory_unlock" in sql:
                    raise psycopg2.OperationalError("simulated dead socket on unlock")
                return self._real.execute(sql, params)
            def fetchone(self):
                return self._real.fetchone()

        class _UnlockRaisesConn:
            def __init__(self, real):
                self._real = real
                self.close_called = False
            def cursor(self, *a, **k):
                return _UnlockRaisesCursor(self._real.cursor(*a, **k))
            def commit(self):
                return self._real.commit()
            def rollback(self):
                return self._real.rollback()
            def close(self):
                self.close_called = True
                return self._real.close()

        @contextmanager
        def lock_get_pg():
            # Only the pass's OWN lock connection (app.services.pg.get_pg) fails on
            # unlock; the compute/email connections use a normal keepalive CM.
            real = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
            wrapped = _UnlockRaisesConn(real)
            lock_conns.append(wrapped)
            try:
                yield wrapped
                wrapped.commit()
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                try:
                    wrapped.rollback()
                except Exception:
                    pass
            except Exception:
                wrapped.rollback()
                raise

        open_conns = []
        compute_cm = self._keepalive_get_pg(dsn, open_conns)
        send_mock = AsyncMock(return_value=True)
        try:
            with caplog.at_level(logging.CRITICAL, logger="app.services.reconciliation_alert"), \
                 patch("app.services.pg.get_pg", lock_get_pg), \
                 patch("app.routers.admin.get_pg", compute_cm), \
                 patch("app.services.auth_db.get_pg", compute_cm), \
                 patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture), \
                 patch.object(reconciliation_alert, "send_admin_update_email", send_mock):
                result = asyncio.run(reconciliation_alert.run_reconciliation_alert_pass())

            assert result["status"] == "alerted"
            # The failed unlock was surfaced loudly, not swallowed silently.
            assert any(r.levelno == logging.CRITICAL and "pg_advisory_unlock" in r.getMessage()
                       for r in caplog.records)
            # The lock connection was force-closed by the hardening.
            assert lock_conns and lock_conns[0].close_called is True
            # And closing ended its session, so the lock is genuinely free again.
            probe = psycopg2.connect(dsn)
            try:
                pc = probe.cursor()
                pc.execute("SELECT pg_try_advisory_lock(%s)", (RECONCILIATION_ALERT_LOCK_ID,))
                assert pc.fetchone()[0] is True
                pc.execute("SELECT pg_advisory_unlock(%s)", (RECONCILIATION_ALERT_LOCK_ID,))
                probe.commit()
            finally:
                probe.close()
        finally:
            for c in open_conns:
                try:
                    c.close()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Read-only guarantee
# ---------------------------------------------------------------------------

class TestReadOnly:
    def test_pass_writes_nothing_against_real_drift(self, recon_alert_env):
        dsn = recon_alert_env
        from app.services.auth_db import create_user
        create_user("user-a", email="a@test.local")
        _seed_segment("user-a", 699)  # genuine unknown drift vs net 399
        fixture = [make_pi("user-a", 399, pi_id="pi_unknown")]

        before = _table_snapshot(dsn)
        send_mock = AsyncMock(return_value=True)
        result = _run_pass(fixture, send_mock)
        after = _table_snapshot(dsn)

        # It DID detect drift (so this proves read-only on a real-write scenario,
        # not a trivially empty one)...
        assert result["status"] == "alerted"
        # ...yet changed no financial state whatsoever.
        assert before == after
