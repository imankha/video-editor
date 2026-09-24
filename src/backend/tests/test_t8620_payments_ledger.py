"""T8620: append-only payments ledger + Stripe backfill — Phase 1 FAILING tests.

Written against APPROVED design docs/plans/tasks/revenue-integrity/T8620-design.md
(rulings 2026-09-24). Production code does NOT exist yet:
  - no `payments` table (no migration v030, no `_SCHEMA_DDL` entry)
  - no `app/services/payments_ledger.py`
  - no `scripts/backfill_payments_ledger.py`
  - `payments.py` write sites are still gated on `result["applied"]` and call the
    OLD `increment_total_spent`/`decrement_total_spent` free functions directly

Every test in this file is expected to fail against current master, for one of:
  - relation "payments" does not exist (Postgres)
  - ModuleNotFoundError / ImportError (payments_ledger, backfill script)
  - AttributeError (helper function doesn't exist yet)
  - AssertionError (behavior not wired yet, e.g. cache still bumps twice)

Test-id mapping is to T8620-design.md §10's table (T1-T11). See the mapping
docstring on each test class/method.
"""

import asyncio
import importlib
import logging
import re
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# G2 background-fill tests drive the real HTTP/webhook scheduling path, so they
# reuse the TestClient + seeded-payer fixtures from the reconciliation suite.
from tests.test_revenue_reconciliation import admin_env, client  # noqa: F401  (pytest fixtures)

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_APP_DIR = Path(__file__).resolve().parents[1] / "app"
SCRIPTS_DIR = REPO_ROOT / "scripts"

USER_A = "user-a"


# ---------------------------------------------------------------------------
# Shared webhook/event builders (mirrors test_payments_webhook_idempotency.py)
# ---------------------------------------------------------------------------


class _FakeRequest:
    def __init__(self, body=b"{}"):
        self.headers = {"stripe-signature": "sig"}
        self._body = body

    async def body(self):
        return self._body


def _checkout_event(session_id="cs_t8620_1", credits=40, pack="starter", pi_id="pi_t8620_1",
                    created=1690002000):
    return {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": session_id,
            "payment_intent": pi_id,
            "amount_total": 399,
            "created": created,
            "metadata": {"user_id": USER_A, "credits": str(credits), "pack": pack},
        }},
    }


def _pi_event(pi_id="pi_t8620_1", credits=40, pack="starter", amount_received=399,
              latest_charge="ch_t8620_1", created=1690001000):
    return {
        "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": pi_id,
            "amount_received": amount_received,
            "latest_charge": latest_charge,
            "created": created,
            "metadata": {"user_id": USER_A, "credits": str(credits), "pack": pack},
        }},
    }


def _refund_event(charge_id="ch_t8620_1", pi_id="pi_t8620_1", user_id=USER_A,
                   amount_refunded=150):
    """A charge.refunded webhook payload. G3: current Stripe API versions do NOT
    embed `refunds` on the Charge and a webhook payload cannot expand it, so this
    builder deliberately omits it -- the production code fetches the authoritative
    refund list via stripe.Refund.list (mock it with `_mock_refund_list`)."""
    return {
        "type": "charge.refunded",
        "data": {"object": {
            "id": charge_id,
            "payment_intent": pi_id,
            "metadata": {"user_id": user_id},
            "amount_refunded": amount_refunded,
            "currency": "usd",
        }},
    }


class _FakeRefundList:
    """Mimics the object stripe.Refund.list returns: an .auto_paging_iter()."""
    def __init__(self, refunds):
        self._refunds = refunds

    def auto_paging_iter(self):
        return iter(self._refunds)


def _refund(refund_id, amount, status="succeeded", created=1690000000, currency="usd"):
    return {"id": refund_id, "amount": amount, "status": status,
            "created": created, "currency": currency}


def _mock_refund_list(monkeypatch, payments_mod, refunds):
    """Patch stripe.Refund.list to return the given refund dicts. `refunds` may be
    a list (any charge) or a callable(**kwargs)->list for per-charge control."""
    def _list(**kwargs):
        data = refunds(**kwargs) if callable(refunds) else refunds
        return _FakeRefundList(data)
    monkeypatch.setattr(payments_mod.stripe.Refund, "list", _list)


class _PI(dict):
    """Dict that also supports attribute access, mimicking a Stripe object (which
    is a dict subclass) closely enough for the confirm-intent / webhook paths."""
    __getattr__ = dict.get


def _bg_intent(pi_id, latest_charge, amount_received=399):
    """A succeeded PaymentIntent for the G2 background-fill tests -- `latest_charge`
    is a bare id (or None) here, exactly as Stripe returns it un-expanded, so the
    charge-id fill has to run to populate stripe_charge_id."""
    return _PI(id=pi_id, status="succeeded", amount_received=amount_received,
               latest_charge=latest_charge,
               metadata={"user_id": USER_A, "credits": "40", "pack": "starter"})


def _row_by_pi(pi_id):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payments WHERE stripe_object_id = %s", (pi_id,))
        return cur.fetchall()


@pytest.fixture
def payments_env(pg_conn, monkeypatch):
    """Webhook env for driving real payments.py handlers against pg_conn.

    Mirrors test_payments_webhook_idempotency's `_webhook_env` fixture but does
    NOT stub `increment_total_spent`/`record_milestone` to no-ops -- these tests
    care about the real ledger + cache-bump behavior, not just credit grants.

    Both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` must be set explicitly
    here (mirrors test_payments_receipt_email.py's `_setup` fixture) -- the
    user-facing sites (`confirm_payment_intent`, `verify_session`) 503 on a
    falsy `STRIPE_SECRET_KEY` before any patched Stripe call runs. Branch CI
    has no `.env` (only local dev does, where a real key is picked up from the
    environment), so without this these tests pass locally by leaning on the
    dev environment and fail red in CI.
    """
    from app.routers import payments as payments_mod
    monkeypatch.setattr(payments_mod, "STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setattr(payments_mod, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)
    # G1 (hermetic): the verify_session (D) path schedules the async charge-id
    # fill via fire_and_forget when it has no BackgroundTasks, and that fill calls
    # stripe.PaymentIntent.retrieve(pi, expand=["latest_charge"]) -- the REAL
    # Stripe API. With no key (CI) that both errors and touches the network. Stub
    # a charge-less intent here so any stray background fill is a clean no-op;
    # the G2 tests that assert on the fill install their own stub, which overrides
    # this default for the duration of the test.
    monkeypatch.setattr(
        payments_mod.stripe.PaymentIntent, "retrieve",
        lambda *a, **k: {"id": (a[0] if a else k.get("id")), "latest_charge": None},
    )
    yield


def _seed_user_segment(user_id=USER_A, total_spent_cents=0):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user(user_id, email=f"{user_id}@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO user_segments (user_id, total_spent_cents) VALUES (%s, %s) "
            "ON CONFLICT (user_id) DO UPDATE SET total_spent_cents = EXCLUDED.total_spent_cents",
            (user_id, total_spent_cents),
        )


def _payments_rows(user_id=None):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        if user_id:
            cur.execute("SELECT * FROM payments WHERE user_id = %s ORDER BY id", (user_id,))
        else:
            cur.execute("SELECT * FROM payments ORDER BY id")
        return cur.fetchall()


def _total_spent(user_id):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT total_spent_cents FROM user_segments WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        return row["total_spent_cents"] if row else None


# ---------------------------------------------------------------------------
# T1: purchase insert + redelivery idempotency
# ---------------------------------------------------------------------------


class TestT1PurchaseInsertRedeliveryIdempotency:
    """Design §10 T1: one payments row + one cache bump on first observation;
    redelivery (applied=False) writes no second row, doesn't error, cache
    unchanged the second time."""

    def test_webhook_purchase_writes_one_row_and_redelivery_is_noop(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 0)
        from app.routers import payments as payments_mod

        event = _pi_event(pi_id="pi_t1", amount_received=699)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        first = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert first["status"] == "credits_granted"

        rows = _payments_rows(USER_A)
        assert len(rows) == 1, f"expected exactly one payments row after first observation, got {rows}"
        assert rows[0]["kind"] == "purchase"
        assert rows[0]["amount_cents"] == 699
        assert rows[0]["stripe_object_id"] == "pi_t1"
        # G6: occurred_at is the PI's Stripe `created`, not now().
        assert rows[0]["occurred_at"].timestamp() == 1690001000

        cache_after_first = _total_spent(USER_A)
        assert cache_after_first == 699, "cache should bump exactly once on the new row"

        # Redelivery: same event again. grant()'s applied is now False.
        second = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert second["status"] == "already_processed"

        rows_after_redelivery = _payments_rows(USER_A)
        assert len(rows_after_redelivery) == 1, "redelivery must not write a second ledger row"
        assert _total_spent(USER_A) == 699, "cache must NOT bump a second time on redelivery"

    def test_record_purchase_helper_returns_false_on_conflict(self, pg_conn):
        """Direct helper-level check of the ON CONFLICT DO NOTHING contract."""
        from app.services import payments_ledger

        _seed_user_segment(USER_A, 0)
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            inserted_1 = payments_ledger.record_purchase(
                cur, user_id=USER_A, stripe_object_id="pi_t1b", amount_cents=399,
                currency="usd", stripe_charge_id=None, pack="starter", credits=80,
                occurred_at="2026-09-24T00:00:00Z", source="webhook",
            )
            inserted_2 = payments_ledger.record_purchase(
                cur, user_id=USER_A, stripe_object_id="pi_t1b", amount_cents=399,
                currency="usd", stripe_charge_id=None, pack="starter", credits=80,
                occurred_at="2026-09-24T00:00:00Z", source="webhook",
            )
        assert inserted_1 is True
        assert inserted_2 is False


# ---------------------------------------------------------------------------
# T2: B/D-vs-webhook convergence (same PI, session vs webhook paths)
# ---------------------------------------------------------------------------


class TestT2SessionVsWebhookConvergeOnPI:
    """Design §10 T2: verify_session (D) and checkout.session.completed webhook (B)
    for the SAME PI -> one row keyed on the PI, cache bumped exactly once."""

    def test_verify_then_checkout_webhook_same_pi_one_row_one_bump(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 0)
        from app.routers import payments as payments_mod
        from app.services.credit_ledger import get_credit_balance

        pi_id = "pi_t2_shared"
        session_id = "cs_t2_1"

        # Site D: verify_session
        session_obj = type("S", (), {
            "payment_status": "paid",
            "metadata": {"user_id": USER_A, "credits": "40", "pack": "starter"},
            "amount_total": 399,
            "payment_intent": pi_id,
            "id": session_id,
        })()
        monkeypatch.setattr(payments_mod.stripe.checkout.Session, "retrieve", lambda *a, **k: session_obj)
        monkeypatch.setattr(payments_mod, "get_current_user_id", lambda: USER_A)

        async def _run_verify():
            req = type("R", (), {"json": staticmethod(lambda: asyncio.sleep(0, result={"session_id": session_id}))})()
            return await payments_mod.verify_session(req)

        verify_result = asyncio.run(_run_verify())
        assert verify_result["status"] == "credits_granted"
        assert get_credit_balance(USER_A)["balance"] == 40

        # Site B: checkout.session.completed webhook for a DIFFERENT session_id
        # but the SAME PaymentIntent (session["payment_intent"] = pi_id).
        event = _checkout_event(session_id="cs_t2_webhook_dup", credits=40, pack="starter", pi_id=pi_id)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        webhook_result = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        rows = _payments_rows(USER_A)
        assert len(rows) == 1, (
            f"verify (D) and webhook (B) for the SAME PI must converge on ONE row "
            f"keyed by stripe_object_id=pi_..., got {rows}"
        )
        assert rows[0]["stripe_object_id"] == pi_id
        assert _total_spent(USER_A) == 399, "cache must bump exactly once across both sites"


# ---------------------------------------------------------------------------
# T3: refund negative row + redelivery no-op
# ---------------------------------------------------------------------------


class TestT3RefundNegativeRowRedeliveryNoop:
    """Design §10 T3: refund writes a second negative row keyed on re_...;
    redelivered refund writes none, no double-decrement."""

    def test_refund_writes_negative_row_and_redelivery_is_noop(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 699)
        from app.routers import payments as payments_mod

        event = _refund_event(charge_id="ch_t3", pi_id="pi_t3", amount_refunded=150)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        _mock_refund_list(monkeypatch, payments_mod, [_refund("re_t3", 150, created=1690000500)])

        first = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert first["status"] == "refund_recorded"

        rows = _payments_rows(USER_A)
        refund_rows = [r for r in rows if r["kind"] == "refund"]
        assert len(refund_rows) == 1, f"expected exactly one refund row, got {rows}"
        assert refund_rows[0]["amount_cents"] == -150
        assert refund_rows[0]["stripe_object_id"] == "re_t3"
        # G6: occurred_at is the refund's Stripe `created`, not now().
        assert refund_rows[0]["occurred_at"].timestamp() == 1690000500

        cache_after_first = _total_spent(USER_A)
        assert cache_after_first == 549, "699 - 150 = 549"

        # Redeliver the SAME refund event.
        second = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        rows_after = _payments_rows(USER_A)
        refund_rows_after = [r for r in rows_after if r["kind"] == "refund"]
        assert len(refund_rows_after) == 1, "redelivered refund must not write a second row"
        assert _total_spent(USER_A) == 549, "redelivered refund must not double-decrement"


# ---------------------------------------------------------------------------
# G3: refund resolution via stripe.Refund.list (charge.refunded payload has no
# `refunds` key on current Stripe API versions)
# ---------------------------------------------------------------------------


class TestG3RefundResolutionViaStripe:
    """Round-2 G3 (MAJOR): the charge.refunded webhook payload no longer embeds
    `refunds` (Stripe default since API version 2022-11-15, unexpandable in a
    webhook). Keying off the payload therefore wrote NO row, logged CRITICAL, and
    returned 200 (no redelivery) -- a regression from base's amount_refunded
    fallback. The fix fetches stripe.Refund.list and records each succeeded refund
    keyed on its re_ id."""

    def test_payload_with_no_refunds_key_still_writes_the_row(self, payments_env, monkeypatch):
        """THE regression test: a charge.refunded payload with NO `refunds` key
        must still write a ledger row (via Refund.list). Fails against 66592da9,
        which read charge['refunds'] and logged CRITICAL without inserting."""
        _seed_user_segment(USER_A, 699)
        from app.routers import payments as payments_mod

        event = _refund_event(charge_id="ch_g3", pi_id="pi_g3", amount_refunded=200)
        assert "refunds" not in event["data"]["object"], "payload must NOT carry refunds (G3 premise)"
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        _mock_refund_list(monkeypatch, payments_mod, [_refund("re_g3", 200)])

        result = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert result["status"] == "refund_recorded"

        refund_rows = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert len(refund_rows) == 1, "a refund with no payload `refunds` key must still write a row"
        assert refund_rows[0]["stripe_object_id"] == "re_g3"
        assert refund_rows[0]["amount_cents"] == -200
        assert _total_spent(USER_A) == 499

    def test_two_refunds_on_one_charge_give_two_rows(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 1000)
        from app.routers import payments as payments_mod

        event = _refund_event(charge_id="ch_g3b", pi_id="pi_g3b", amount_refunded=300)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        _mock_refund_list(monkeypatch, payments_mod, [
            _refund("re_g3b_1", 100), _refund("re_g3b_2", 200),
        ])

        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        refund_rows = sorted(
            [r for r in _payments_rows(USER_A) if r["kind"] == "refund"],
            key=lambda r: r["stripe_object_id"],
        )
        assert [r["stripe_object_id"] for r in refund_rows] == ["re_g3b_1", "re_g3b_2"]
        assert [r["amount_cents"] for r in refund_rows] == [-100, -200]
        assert _total_spent(USER_A) == 700, "1000 - 100 - 200"

    def test_redelivery_gives_no_new_rows_and_no_second_decrement(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 1000)
        from app.routers import payments as payments_mod

        event = _refund_event(charge_id="ch_g3c", pi_id="pi_g3c", amount_refunded=250)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        _mock_refund_list(monkeypatch, payments_mod, [
            _refund("re_g3c_1", 100), _refund("re_g3c_2", 150),
        ])

        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert _total_spent(USER_A) == 750
        # Redeliver.
        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        refund_rows = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert len(refund_rows) == 2, "redelivery must not add rows"
        assert _total_spent(USER_A) == 750, "redelivery must not double-decrement"

    def test_failed_or_canceled_refund_is_skipped(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 1000)
        from app.routers import payments as payments_mod

        event = _refund_event(charge_id="ch_g3d", pi_id="pi_g3d", amount_refunded=100)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        _mock_refund_list(monkeypatch, payments_mod, [
            _refund("re_ok", 100, status="succeeded"),
            _refund("re_failed", 500, status="failed"),
            _refund("re_canceled", 400, status="canceled"),
            _refund("re_pending", 300, status="pending"),
        ])

        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        refund_rows = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert [r["stripe_object_id"] for r in refund_rows] == ["re_ok"], (
            "only the succeeded refund may write a row"
        )
        assert _total_spent(USER_A) == 900, "only the 100 succeeded refund decrements"

    def test_refund_list_error_reraises(self, payments_env, monkeypatch):
        """A Stripe error fetching the refund list must RE-RAISE (webhook non-2xx
        -> Stripe redelivers, ruling 4c), never a silent 200 that drops the refund."""
        _seed_user_segment(USER_A, 699)
        from app.routers import payments as payments_mod
        import stripe as stripe_mod

        event = _refund_event(charge_id="ch_g3e", pi_id="pi_g3e", amount_refunded=150)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        def _boom(**kwargs):
            raise stripe_mod.APIConnectionError("stripe down")
        monkeypatch.setattr(payments_mod.stripe.Refund, "list", _boom)

        with pytest.raises(stripe_mod.StripeError):
            asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        # No row written, cache untouched.
        assert [r for r in _payments_rows(USER_A) if r["kind"] == "refund"] == []
        assert _total_spent(USER_A) == 699


# ---------------------------------------------------------------------------
# T4: per-user SUM(amount_cents) == reconciler's Stripe net
# ---------------------------------------------------------------------------


class TestT4LedgerSumMatchesReconcilerNet:
    """Design §10 T4: SUM(amount_cents) per user equals the Stripe net the
    reconciler computes for the same fixture data."""

    def test_purchase_plus_refund_sum_matches_reconciler_net(self, pg_conn):
        from app.services import payments_ledger
        from app.services.pg import get_pg
        from app.services.revenue_reconciliation import build_stripe_net_by_user

        _seed_user_segment(USER_A, 0)

        pi = {
            "id": "pi_t4",
            "status": "succeeded",
            "metadata": {"user_id": USER_A},
            "amount_received": 699,
            "created": 1690000000,
            "latest_charge": {
                "amount_captured": 699,
                "amount_refunded": 300,
                "disputed": False,
                "dispute": None,
            },
        }
        stripe_net = build_stripe_net_by_user([pi])[USER_A]["net_cents"]
        assert stripe_net == 399

        with get_pg() as conn:
            cur = conn.cursor()
            payments_ledger.record_purchase(
                cur, user_id=USER_A, stripe_object_id="pi_t4", amount_cents=699,
                currency="usd", stripe_charge_id="ch_t4", pack="popular", credits=200,
                occurred_at="2026-08-24T04:02:26Z", source="webhook",
            )
            payments_ledger.record_refund(
                cur, user_id=USER_A, stripe_object_id="re_t4", amount_cents=-300,
                currency="usd", stripe_charge_id="ch_t4",
                occurred_at="2026-08-24T05:00:00Z", source="webhook",
            )
            cur.execute("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE user_id = %s", (USER_A,))
            ledger_sum = cur.fetchone()["total"]

        assert ledger_sum == stripe_net == 399


# ---------------------------------------------------------------------------
# T5: bump_total_spent against a missing user_segments row -> CRITICAL, no raise
# ---------------------------------------------------------------------------


class TestT5MissingSegmentRowLogsCritical:
    """Design §10 T5: drive a purchase for a user with NO user_segments row ->
    ledger row IS written, CRITICAL logged (not an 'Incremented' success line),
    no exception, no bare segment row created."""

    def test_purchase_for_segmentless_user_writes_ledger_logs_critical_no_segment_row(
        self, payments_env, monkeypatch, caplog,
    ):
        # Deliberately do NOT call _seed_user_segment -- but DO create the users
        # row (sessions/auth need it), matching "payer with no user_segments row"
        # from the design (segment rows are created only at OAuth/OTP signup).
        from app.services.auth_db import create_user
        create_user(USER_A, email=f"{USER_A}@test.local")

        from app.routers import payments as payments_mod

        event = _pi_event(pi_id="pi_t5", amount_received=399)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        import logging
        caplog.set_level(logging.CRITICAL)

        result = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert result["status"] == "credits_granted", "the payment/grant must succeed regardless of the cache miss"

        rows = _payments_rows(USER_A)
        assert len(rows) == 1, "ledger row must be written even though user_segments has no row for this user"

        assert _total_spent(USER_A) is None, "must NOT create a bare user_segments row from the payment path"

        critical_records = [r for r in caplog.records if r.levelno >= logging.CRITICAL]
        assert critical_records, "a missing user_segments row must log CRITICAL, not silently succeed"


# ---------------------------------------------------------------------------
# T6: ledger failure isolation + site-type-correct failure handling
# ---------------------------------------------------------------------------


class TestT6LedgerFailureIsolationAndSiteBehavior:
    """Design §10 T6:
    (a) webhook site: ledger insert raises -> grant/credits unchanged, CRITICAL
        logged, handler RE-RAISES (non-2xx).
    (b) user-facing site (confirm-intent): same injected failure -> grant/credits
        unchanged, CRITICAL logged, HTTP response still success.
    """

    def test_webhook_ledger_failure_reraises_and_preserves_grant(self, payments_env, monkeypatch, caplog):
        _seed_user_segment(USER_A, 0)
        from app.routers import payments as payments_mod
        from app.services import payments_ledger
        from app.services.credit_ledger import get_credit_balance

        event = _pi_event(pi_id="pi_t6a", amount_received=399)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        monkeypatch.setattr(
            payments_ledger, "record_purchase",
            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("simulated ledger insert failure")),
        )

        import logging
        caplog.set_level(logging.CRITICAL)

        with pytest.raises(Exception):
            asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        # Grant must have already committed (it runs before the ledger block).
        assert get_credit_balance(USER_A)["balance"] == 40, "credit grant must survive a ledger failure"
        assert any(r.levelno >= logging.CRITICAL for r in caplog.records), "ledger failure must log CRITICAL"

    def test_confirm_intent_ledger_failure_swallowed_response_still_success(
        self, payments_env, monkeypatch, caplog,
    ):
        _seed_user_segment(USER_A, 0)
        from app.routers import payments as payments_mod
        from app.services import payments_ledger

        pi_id = "pi_t6b"
        intent_obj = type("I", (), {
            "status": "succeeded",
            "metadata": {"user_id": USER_A, "credits": "40", "pack": "starter"},
            "amount_received": 399,
            "latest_charge": "ch_t6b",
            "id": pi_id,
        })()
        monkeypatch.setattr(payments_mod.stripe.PaymentIntent, "retrieve", lambda *a, **k: intent_obj)
        monkeypatch.setattr(payments_mod, "get_current_user_id", lambda: USER_A)
        monkeypatch.setattr(
            payments_ledger, "record_purchase",
            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("simulated ledger insert failure")),
        )

        import logging
        caplog.set_level(logging.CRITICAL)

        req = payments_mod.ConfirmIntentRequest(payment_intent_id=pi_id)
        result = asyncio.run(payments_mod.confirm_payment_intent(req))

        assert result["status"] == "credits_granted", "user-facing site must swallow the ledger failure"
        assert any(r.levelno >= logging.CRITICAL for r in caplog.records), "ledger failure must log CRITICAL"


# ---------------------------------------------------------------------------
# T7: redelivery-after-failure self-heals on webhook sites
# ---------------------------------------------------------------------------


class TestT7RedeliveryAfterFailureSelfHeals:
    """Design §10 T7 / ruling 4e: the core mechanism ruling 4 fixes. First
    webhook delivery's ledger insert fails -> no row yet. Redeliver the SAME
    event (grant already applied, applied=False this time) -> because the
    ledger insert is NOT gated on `applied`, it is retried and succeeds; row
    now exists; cache bumped exactly once total."""

    def test_redelivery_writes_the_row_the_first_attempt_failed_to_write(
        self, payments_env, monkeypatch,
    ):
        _seed_user_segment(USER_A, 0)
        from app.routers import payments as payments_mod
        from app.services import payments_ledger

        event = _pi_event(pi_id="pi_t7", amount_received=399)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        real_record_purchase = payments_ledger.record_purchase
        call_count = {"n": 0}

        def _flaky_record_purchase(*a, **k):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("simulated first-attempt ledger insert failure")
            return real_record_purchase(*a, **k)

        monkeypatch.setattr(payments_ledger, "record_purchase", _flaky_record_purchase)

        # First delivery: ledger insert fails. Grant still succeeds (its own txn,
        # runs before the ledger block) or the whole handler may raise -- either
        # way, we only assert on ledger state here, catching a possible raise.
        try:
            asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        except Exception:
            pass

        rows_after_first = _payments_rows(USER_A)
        assert len(rows_after_first) == 0, "first attempt's ledger insert failed -- no row should exist yet"

        # Redelivery: same event. grant()'s applied is now False (already granted),
        # but the ledger insert must NOT be gated on that -- it must retry.
        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        rows_after_redelivery = _payments_rows(USER_A)
        assert len(rows_after_redelivery) == 1, (
            "redelivery must retry the ledger insert (not gated on applied) and "
            "succeed this time"
        )
        assert _total_spent(USER_A) == 399, "cache must bump exactly once total, on the delivery that actually wrote the row"


# ---------------------------------------------------------------------------
# G5: self-heal after a first-attempt ledger failure on the OTHER two webhook
# sites (T7 already covers payment_intent.succeeded). Because the ledger insert
# is not gated on `applied`/on the grant, a redelivery retries it and succeeds.
# ---------------------------------------------------------------------------


class TestG5SelfHealAfterFailure:
    """Round-2 G5: a webhook whose first-attempt ledger insert fails RE-RAISES
    (non-2xx -> Stripe redelivers, ruling 4c); the redelivery, which is NOT gated
    on the already-applied grant, retries the insert and writes the row, bumping
    the cache exactly once."""

    def test_checkout_session_completed_self_heals_on_redelivery(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 0)
        from app.routers import payments as payments_mod
        from app.services import payments_ledger

        event = _checkout_event(session_id="cs_g5", pi_id="pi_g5", credits=40, pack="starter")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        real = payments_ledger.record_purchase
        calls = {"n": 0}

        def flaky(*a, **k):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("first-attempt checkout ledger insert failure")
            return real(*a, **k)

        monkeypatch.setattr(payments_ledger, "record_purchase", flaky)

        with pytest.raises(Exception):
            asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert len(_payments_rows(USER_A)) == 0, "first attempt failed -- no row yet"

        # Redeliver the SAME checkout event: grant already applied, but the ledger
        # insert must retry (not gated on applied) and succeed this time.
        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        rows = _payments_rows(USER_A)
        assert len(rows) == 1 and rows[0]["stripe_object_id"] == "pi_g5", \
            "redelivery must write the row the first attempt failed to write"
        assert _total_spent(USER_A) == 399, "cache bumps exactly once, on the delivery that wrote the row"

    def test_charge_refunded_self_heals_on_redelivery(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 699)
        from app.routers import payments as payments_mod
        from app.services import payments_ledger

        event = _refund_event(charge_id="ch_g5r", pi_id="pi_g5r", amount_refunded=150)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        _mock_refund_list(monkeypatch, payments_mod, [_refund("re_g5r", 150)])

        real = payments_ledger.record_refund
        calls = {"n": 0}

        def flaky(*a, **k):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("first-attempt refund ledger insert failure")
            return real(*a, **k)

        monkeypatch.setattr(payments_ledger, "record_refund", flaky)

        with pytest.raises(Exception):
            asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert [r for r in _payments_rows(USER_A) if r["kind"] == "refund"] == [], \
            "first attempt failed -- no refund row yet"
        assert _total_spent(USER_A) == 699, "no decrement on the failed attempt"

        # Redeliver: Refund.list returns the same refund; the insert retries.
        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        refund_rows = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert len(refund_rows) == 1 and refund_rows[0]["stripe_object_id"] == "re_g5r"
        assert _total_spent(USER_A) == 549, "cache decrements exactly once (699 - 150)"


# ---------------------------------------------------------------------------
# T8: confirm-intent (A) + webhook (C) for the same PI -> one row, one bump
# ---------------------------------------------------------------------------


class TestT8ConfirmIntentAndWebhookPairing:
    """Design §10 T8 / ruling 4e: site A (confirm-intent) then site C (webhook
    payment_intent.succeeded) for the SAME PI -> exactly one payments row,
    exactly one cache bump."""

    def test_confirm_intent_then_webhook_same_pi_one_row_one_bump(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 0)
        from app.routers import payments as payments_mod

        pi_id = "pi_t8"
        intent_obj = type("I", (), {
            "status": "succeeded",
            "metadata": {"user_id": USER_A, "credits": "40", "pack": "starter"},
            "amount_received": 399,
            "latest_charge": "ch_t8",
            "id": pi_id,
        })()
        monkeypatch.setattr(payments_mod.stripe.PaymentIntent, "retrieve", lambda *a, **k: intent_obj)
        monkeypatch.setattr(payments_mod, "get_current_user_id", lambda: USER_A)

        req = payments_mod.ConfirmIntentRequest(payment_intent_id=pi_id)
        confirm_result = asyncio.run(payments_mod.confirm_payment_intent(req))
        assert confirm_result["status"] == "credits_granted"

        event = _pi_event(pi_id=pi_id, amount_received=399)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        webhook_result = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        rows = _payments_rows(USER_A)
        assert len(rows) == 1, f"confirm-intent (A) + webhook (C) for the SAME PI must converge on one row, got {rows}"
        assert _total_spent(USER_A) == 399, "cache must bump exactly once across both sites"


# ---------------------------------------------------------------------------
# T9: backfill idempotency + orphan + never touches total_spent_cents
# ---------------------------------------------------------------------------


class TestT9BackfillIdempotencyAndOrphan:
    """Design §10 T9: backfill CLI/guardrail shape. The end-to-end backfill
    behavior (idempotency, the 2026-08-24 orphan PI, never touching
    total_spent_cents) is proven by TestG4RealBackfillRun, which drives the real
    `run_backfill` rather than re-implementing its loop."""

    def test_backfill_script_importable_and_has_expected_cli_shape(self, monkeypatch):
        """Per §7: --env {dev,staging,prod} required, --write default off,
        non-dev --write refused without --i-am-the-operator.

        Phase 2 (post-implementation): the script now exists -- this asserts
        the real argparse/guardrail shape instead of the Phase-1 "does not
        exist yet" marker this test started as.
        """
        backfill_path = SCRIPTS_DIR / "backfill_payments_ledger.py"
        assert backfill_path.exists(), "backfill_payments_ledger.py must exist post-implementation"

        spec_module_name = "backfill_payments_ledger"
        sys.path.insert(0, str(SCRIPTS_DIR))
        try:
            module = importlib.import_module(spec_module_name)

            # --env is required.
            monkeypatch.setattr(sys, "argv", ["backfill_payments_ledger.py"])
            with pytest.raises(SystemExit):
                module.main()

            # --env is restricted to dev/staging/prod.
            monkeypatch.setattr(sys, "argv", ["backfill_payments_ledger.py", "--env", "bogus"])
            with pytest.raises(SystemExit):
                module.main()

            # Non-dev --write is refused without --i-am-the-operator (guardrail
            # message printed, sys.exit(1) -- verified without touching a real
            # non-dev DB or Stripe).
            monkeypatch.setattr(
                sys, "argv",
                ["backfill_payments_ledger.py", "--env", "staging", "--write"],
            )
            monkeypatch.setattr(module, "load_env", lambda env_name: {
                "DATABASE_URL": "postgresql://user:pass@staging-host/db",
                "STRIPE_SECRET_KEY": "sk_test_x",
            })
            with pytest.raises(SystemExit) as exc_info:
                module.main()
            assert exc_info.value.code != 0, "non-dev --write without --i-am-the-operator must refuse (nonzero exit)"
        finally:
            sys.path.remove(str(SCRIPTS_DIR))
            sys.modules.pop(spec_module_name, None)


class TestT9DisputeRefundNetting:
    """Reviewer MAJOR finding (post-implementation): a dispute resolved by
    refunding the charge (Stripe status `charge_refunded`) sets BOTH
    `amount_refunded` and the dispute amount for the SAME money leaving us.
    `revenue_reconciliation.build_stripe_net_by_user` already nets these
    (`lost_dispute = max(lost_dispute_raw - refunded, 0)`); the backfill's
    `_dispute_lost_row` must mirror that netting or it double-subtracts --
    and since the ledger is append-only, a wrong backfilled row can never
    self-correct on a re-run. Proves T4's AC ("SUM(amount_cents) per user
    equals the Stripe net the reconciler computes") for this specific shape.
    """

    def _load_dispute_lost_row(self):
        sys.path.insert(0, str(SCRIPTS_DIR))
        try:
            module = importlib.import_module("backfill_payments_ledger")
            return module._dispute_lost_row
        finally:
            sys.path.remove(str(SCRIPTS_DIR))
            sys.modules.pop("backfill_payments_ledger", None)

    def test_charge_refunded_dispute_nets_against_refunded_amount(self):
        """A $10 charge fully refunded as part of losing a dispute: Stripe
        reports amount_refunded=1000 AND dispute.amount=1000 for the same
        money. The netted dispute_lost amount must be 0 (no row), not 1000
        (which would double-subtract on top of the refund row)."""
        _dispute_lost_row = self._load_dispute_lost_row()
        charge = {
            "id": "ch_netted",
            "amount_refunded": 1000,
            "dispute": {"id": "dp_netted", "status": "charge_refunded", "amount": 1000},
        }
        intent = {"id": "pi_netted", "latest_charge": charge}
        assert _dispute_lost_row(intent, charge) is None, (
            "fully-refunded charge_refunded dispute must net to zero -- the refund row "
            "already accounts for this money"
        )

    def test_charge_refunded_dispute_partial_refund_leaves_residual(self):
        """Dispute amount exceeds the (partial) refund -- only the residual
        should be recorded as dispute_lost, matching the reconciler's
        max(lost_dispute_raw - refunded, 0)."""
        _dispute_lost_row = self._load_dispute_lost_row()
        charge = {
            "id": "ch_partial",
            "amount_refunded": 300,
            "dispute": {"id": "dp_partial", "status": "charge_refunded", "amount": 1000},
        }
        intent = {"id": "pi_partial", "latest_charge": charge}
        result = _dispute_lost_row(intent, charge)
        assert result == ("dp_partial", 700), f"expected netted residual (dp id, 700), got {result}"

    def test_genuine_lost_dispute_with_no_refund_is_unaffected(self):
        """A true `lost`-status dispute with funds withdrawn directly
        (amount_refunded == 0) still writes the FULL dispute amount -- the
        netting must not touch this case."""
        _dispute_lost_row = self._load_dispute_lost_row()
        charge = {
            "id": "ch_lost",
            "amount_refunded": 0,
            "dispute": {"id": "dp_lost", "status": "lost", "amount": 500},
        }
        intent = {"id": "pi_lost", "latest_charge": charge}
        result = _dispute_lost_row(intent, charge)
        assert result == ("dp_lost", 500)


# ---------------------------------------------------------------------------
# G4: exercise the REAL run_backfill against the throwaway DB (not a
# re-implementation), with fetch_stripe_intents + stripe.Refund.list mocked.
# ---------------------------------------------------------------------------


class TestG4RealBackfillRun:
    """Round-2 G4: call `backfill_payments_ledger.run_backfill` itself over a
    fixture set covering a plain purchase, a partial refund (with a stray failed
    refund that must be skipped), a fully-failed refund, a genuine lost dispute,
    and a charge_refunded-status dispute. Proves: a dry run writes 0 rows; two
    --write runs give identical row counts (idempotent); total_spent_cents is
    never touched (ruling 4d); per-user SUM(amount_cents) equals the reconciler's
    Stripe net for the SAME fixtures (the T4 AC, end-to-end); and the 2026-08-24
    orphan PI (a user with no `users` row) inserts cleanly since payments.user_id
    has no FK -- the point of the ledger outliving account deletion."""

    ORPHAN_USER_ID = "fb40690a-edcf-4504-a51f-f9df6f84ac4f"

    def _intents(self):
        def _charge(cid, captured, refunded=0, dispute=None):
            return {"id": cid, "amount_captured": captured, "amount_refunded": refunded,
                    "disputed": bool(dispute), "dispute": dispute, "currency": "usd"}

        def _pi(pi_id, user_id, captured, charge):
            return {"id": pi_id, "status": "succeeded", "currency": "usd",
                    "metadata": {"user_id": user_id, "pack": "starter", "credits": "40"},
                    "amount_received": captured, "created": 1690000000,
                    "latest_charge": charge}

        return [
            _pi("pi_g4_pur", "user-a", 1000, _charge("ch_g4_pur", 1000)),
            _pi("pi_g4_partial", "user-b", 1000, _charge("ch_g4_partial", 1000, refunded=300)),
            _pi("pi_g4_failed", "user-c", 800, _charge("ch_g4_failed", 800, refunded=0)),
            _pi("pi_g4_lost", "user-1", 1200, _charge(
                "ch_g4_lost", 1200, refunded=0,
                dispute={"id": "dp_g4_lost", "status": "lost", "amount": 1200})),
            _pi("pi_g4_chr", "user-2", 1000, _charge(
                "ch_g4_chr", 1000, refunded=1000,
                dispute={"id": "dp_g4_chr", "status": "charge_refunded", "amount": 1000})),
            # Orphan: no `users` row for this user_id. payments.user_id has no FK,
            # so it must insert cleanly (the ledger outlives account deletion).
            _pi("pi_g4_orphan", self.ORPHAN_USER_ID, 399, _charge("ch_g4_orphan", 399)),
        ]

    def _refund_map(self):
        # Keyed by charge id. `_refund_rows` only calls Refund.list when the
        # charge's amount_refunded > 0, so ch_g4_failed (refunded=0) is never
        # queried; the succeeded refunds must sum to each charge's amount_refunded
        # for the ledger SUM to equal the reconciler net.
        return {
            "ch_g4_partial": [_refund("re_g4_p", 300, status="succeeded"),
                              _refund("re_g4_pf", 999, status="failed")],
            "ch_g4_chr": [_refund("re_g4_chr", 1000, status="succeeded")],
        }

    def test_run_backfill_dry_then_write_idempotent_matches_reconciler(self, pg_conn, monkeypatch):
        import os
        from app.services.auth_db import create_user
        from app.services.pg import get_pg
        from app.services.revenue_reconciliation import build_stripe_net_by_user

        intents = self._intents()
        refund_map = self._refund_map()

        # Seed an unrelated total_spent_cents to prove the backfill never moves it.
        create_user("user-a", email="user-a@test.local")
        with get_pg() as conn:
            conn.cursor().execute(
                "INSERT INTO user_segments (user_id, total_spent_cents) VALUES ('user-a', 5000) "
                "ON CONFLICT (user_id) DO UPDATE SET total_spent_cents = 5000")

        sys.path.insert(0, str(SCRIPTS_DIR))
        try:
            backfill = importlib.import_module("backfill_payments_ledger")

            def _refund_list(**kwargs):
                return _FakeRefundList(refund_map.get(kwargs.get("charge"), []))
            monkeypatch.setattr(backfill.stripe.Refund, "list", _refund_list)
            monkeypatch.setattr(
                "app.services.revenue_reconciliation.fetch_stripe_intents",
                lambda *a, **k: intents,
            )

            config = {"DATABASE_URL": os.environ["DATABASE_URL"], "APP_ENV": "dev",
                      "STRIPE_SECRET_KEY": "sk_test_dummy"}

            # Dry run writes nothing.
            backfill.run_backfill(config, write=False)
            assert len(_payments_rows()) == 0, "dry run must write 0 rows"

            # First --write run.
            backfill.run_backfill(config, write=True)
            count_after_first = len(_payments_rows())
            assert count_after_first > 0

            # Second --write run is idempotent (ON CONFLICT DO NOTHING everywhere).
            backfill.run_backfill(config, write=True)
            assert len(_payments_rows()) == count_after_first, \
                "a second --write run must add no rows"

            # Cache is never touched by the backfill (ruling 4d).
            assert _total_spent("user-a") == 5000, "backfill must never move total_spent_cents"

            # Orphan PI: a row exists, no `users` row was needed, no segment created.
            from app.services.auth_db import get_user_by_id
            orphan_rows = _payments_rows(self.ORPHAN_USER_ID)
            assert len(orphan_rows) == 1, "orphan PI (no users row) must still write a ledger row"
            assert get_user_by_id(self.ORPHAN_USER_ID) is None, "orphan user must not exist in users"
            assert _total_spent(self.ORPHAN_USER_ID) is None, "backfill must not create a segment row"

            # Per-user SUM(amount_cents) == reconciler Stripe net for the same fixtures.
            net = build_stripe_net_by_user(intents)
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute("SELECT user_id, COALESCE(SUM(amount_cents), 0) AS total "
                            "FROM payments GROUP BY user_id")
                sums = {r["user_id"]: r["total"] for r in cur.fetchall()}
            for uid, agg in net.items():
                assert sums.get(uid, 0) == agg["net_cents"], (
                    f"user {uid}: ledger SUM {sums.get(uid, 0)} != reconciler net {agg['net_cents']}"
                )
        finally:
            sys.path.remove(str(SCRIPTS_DIR))
            sys.modules.pop("backfill_payments_ledger", None)


# ---------------------------------------------------------------------------
# T10: fill_missing_charge_id
# ---------------------------------------------------------------------------


class TestT10FillMissingChargeId:
    """Design §10 T10: fills only when NULL, doesn't overwrite existing, a
    background Stripe error is swallowed/logged, never touches other columns."""

    def test_fills_only_when_null(self, pg_conn):
        from app.services import payments_ledger
        from app.services.pg import get_pg

        _seed_user_segment(USER_A, 0)
        with get_pg() as conn:
            cur = conn.cursor()
            payments_ledger.record_purchase(
                cur, user_id=USER_A, stripe_object_id="pi_t10a", amount_cents=399,
                currency="usd", stripe_charge_id=None, pack="starter", credits=80,
                occurred_at="2026-09-24T00:00:00Z", source="webhook",
            )

        with get_pg() as conn:
            cur = conn.cursor()
            changed = payments_ledger.fill_missing_charge_id(
                cur, stripe_object_id="pi_t10a", stripe_charge_id="ch_filled_1",
            )
        assert changed is True

        rows = _payments_rows(USER_A)
        assert rows[0]["stripe_charge_id"] == "ch_filled_1"

    def test_does_not_overwrite_existing_charge_id(self, pg_conn):
        from app.services import payments_ledger
        from app.services.pg import get_pg

        _seed_user_segment(USER_A, 0)
        with get_pg() as conn:
            cur = conn.cursor()
            payments_ledger.record_purchase(
                cur, user_id=USER_A, stripe_object_id="pi_t10b", amount_cents=399,
                currency="usd", stripe_charge_id="ch_original", pack="starter", credits=80,
                occurred_at="2026-09-24T00:00:00Z", source="webhook",
            )

        with get_pg() as conn:
            cur = conn.cursor()
            changed = payments_ledger.fill_missing_charge_id(
                cur, stripe_object_id="pi_t10b", stripe_charge_id="ch_should_not_apply",
            )
        assert changed is False

        rows = _payments_rows(USER_A)
        assert rows[0]["stripe_charge_id"] == "ch_original", "must never overwrite an existing charge id"

    def test_update_statement_only_touches_stripe_charge_id_column(self):
        """Schema-level check on the UPDATE's column list: read the exact SQL text
        payments_ledger.fill_missing_charge_id issues and assert it names no other
        column than stripe_charge_id."""
        from app.services import payments_ledger
        import inspect

        source = inspect.getsource(payments_ledger.fill_missing_charge_id)
        match = re.search(r"UPDATE\s+payments\s+SET\s+(.*?)\s+WHERE", source, re.IGNORECASE | re.DOTALL)
        assert match, "could not find an UPDATE payments SET ... WHERE statement in fill_missing_charge_id"
        set_clause = match.group(1)
        assert "stripe_charge_id" in set_clause
        forbidden = ["amount_cents", "kind", "user_id", "occurred_at", "stripe_object_id"]
        for col in forbidden:
            assert col not in set_clause, f"fill_missing_charge_id's SET clause must never touch {col}"


# ---------------------------------------------------------------------------
# G2: ruling-5 async charge-id fill exercised through the REAL request/webhook
# scheduling path (not just the helper). Replaces the empty Phase-1 marker test
# with tests that actually drive BackgroundTasks and fire_and_forget, and that
# catch the "fill always raises, try/except removed" mutant.
# ---------------------------------------------------------------------------


class TestG2BackgroundFillRealPath:
    """Round-2 G2: the ruling-5 async `stripe_charge_id` fill must (a) actually
    run and write ch_... through a real HTTP confirm-intent call's BackgroundTasks;
    (b) when Stripe raises inside the fill, leave the response 200, the row intact
    with a NULL charge id, and log a warning (this is the assertion the "try/except
    removed" mutant fails -- with the guard gone, the background exception
    propagates through TestClient(raise_server_exceptions=True) and the POST
    raises instead of returning 200); (c) register the task through
    fire_and_forget on the webhook path (no BackgroundTasks in scope)."""

    def test_confirm_intent_http_background_fill_runs(self, client, monkeypatch):
        pi = "pi_bg_ok"
        calls = []

        def retrieve(pid, **kw):
            calls.append(kw)
            if kw.get("expand"):
                return _PI(id=pid, latest_charge=_PI(id="ch_bg_ok"))
            return _bg_intent(pid, None)

        monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_x")
        with patch("stripe.PaymentIntent.retrieve", side_effect=retrieve):
            r = client.post("/api/payments/confirm-intent",
                            json={"payment_intent_id": pi}, headers={"X-User-ID": USER_A})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "credits_granted"
        rows = _row_by_pi(pi)
        assert len(rows) == 1 and rows[0]["amount_cents"] == 399
        assert any(c.get("expand") == ["latest_charge"] for c in calls), \
            f"background fill never called Stripe: {calls}"
        assert rows[0]["stripe_charge_id"] == "ch_bg_ok"
        assert _total_spent(USER_A) == 699 + 399

    def test_confirm_intent_http_background_stripe_error_harmless(self, client, monkeypatch, caplog):
        pi = "pi_bg_err"

        def retrieve(pid, **kw):
            if kw.get("expand"):
                raise RuntimeError("stripe exploded")
            return _bg_intent(pid, None)

        monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_x")
        caplog.set_level(logging.WARNING)
        with patch("stripe.PaymentIntent.retrieve", side_effect=retrieve):
            r = client.post("/api/payments/confirm-intent",
                            json={"payment_intent_id": pi}, headers={"X-User-ID": USER_A})
        assert r.status_code == 200 and r.json()["status"] == "credits_granted"
        rows = _row_by_pi(pi)
        assert len(rows) == 1 and rows[0]["amount_cents"] == 399 and rows[0]["stripe_charge_id"] is None
        assert any("fill_missing_charge_id_background failed" in rec.getMessage()
                   for rec in caplog.records)

    def test_webhook_fire_and_forget_fill_runs(self, admin_env, monkeypatch):
        from app.routers import payments as payments_mod
        from app.services import poster_warmer
        pi = "pi_bg_wh"
        event = {"type": "checkout.session.completed", "data": {"object": {
            "id": "cs_bg_wh", "payment_intent": pi, "amount_total": 399, "currency": "usd",
            "created": 1690002000,
            "metadata": {"user_id": USER_A, "credits": "40", "pack": "starter"}}}}
        monkeypatch.setattr(payments_mod, "STRIPE_WEBHOOK_SECRET", "whsec")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)
        monkeypatch.setattr(payments_mod.stripe.PaymentIntent, "retrieve",
                            lambda pid, **kw: _PI(id=pid, latest_charge=_PI(id="ch_bg_wh")))

        async def go():
            # Snapshot before triggering the webhook and diff after, so a task
            # some earlier test left pending on a since-closed event loop
            # (still sitting in this module-level set) is never handed to
            # this loop's asyncio.gather -- only the task this call itself
            # registered is awaited.
            before = set(poster_warmer._background_tasks)
            res = await payments_mod.stripe_webhook(_FakeRequest())
            new_tasks = [t for t in poster_warmer._background_tasks if t not in before]
            assert new_tasks, "no fire_and_forget task was registered (strong ref missing)"
            await asyncio.gather(*new_tasks)
            return res

        res = asyncio.run(go())
        assert res["status"] == "credits_granted"
        rows = _row_by_pi(pi)
        assert len(rows) == 1 and rows[0]["stripe_charge_id"] == "ch_bg_wh" and rows[0]["amount_cents"] == 399


# ---------------------------------------------------------------------------
# T11: grep — no UPDATE/DELETE against `payments` outside the one whitelisted
# fill_missing_charge_id UPDATE. This test's JOB IS TO STAY GREEN through
# implementation, not to fail now (nothing exists yet, so it currently passes
# vacuously). See report note.
# ---------------------------------------------------------------------------


class TestT11AppendOnlyGrep:
    """Design §10 T11 / ruling 2 (amended): no `UPDATE payments` outside
    `fill_missing_charge_id`'s own definition, and no `DELETE FROM payments`
    anywhere in app/ or scripts/.

    NOTE: this test does not need to start red -- there is nothing to grep yet
    (no payments_ledger.py, no backfill script, no payments.py writes against a
    `payments` table). It asserts the invariant that must hold once T8620 is
    implemented, and its job is to catch a REGRESSION during/after
    implementation, not to prove the feature is currently missing.
    """

    UPDATE_PATTERN = re.compile(r"UPDATE\s+payments\b", re.IGNORECASE)
    DELETE_PATTERN = re.compile(r"DELETE\s+FROM\s+payments\b", re.IGNORECASE)

    def _scan(self, root: Path):
        violations = []
        for py_file in root.rglob("*.py"):
            if "/tests/" in str(py_file).replace("\\", "/") or py_file.name.startswith("test_"):
                continue
            text = py_file.read_text(encoding="utf-8", errors="ignore")
            for lineno, line in enumerate(text.splitlines(), start=1):
                if self.DELETE_PATTERN.search(line):
                    violations.append(("DELETE", py_file, lineno, line.strip()))
                if self.UPDATE_PATTERN.search(line):
                    violations.append(("UPDATE", py_file, lineno, line.strip()))
        return violations

    def _is_whitelisted_update(self, file_path: Path, line: str):
        # The one permitted UPDATE: fill_missing_charge_id's own statement.
        return (
            file_path.name == "payments_ledger.py"
            and "stripe_charge_id" in line
        )

    def test_no_disallowed_update_or_delete_against_payments(self):
        violations = []
        for root in (BACKEND_APP_DIR, SCRIPTS_DIR):
            if not root.exists():
                continue
            violations.extend(self._scan(root))

        bad = [
            v for v in violations
            if v[0] == "DELETE" or not self._is_whitelisted_update(v[1], v[3])
        ]
        assert bad == [], f"disallowed UPDATE/DELETE against `payments` found: {bad}"
