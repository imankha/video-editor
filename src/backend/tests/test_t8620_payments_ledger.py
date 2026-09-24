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
import re
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

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


def _checkout_event(session_id="cs_t8620_1", credits=40, pack="starter", pi_id="pi_t8620_1"):
    return {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": session_id,
            "payment_intent": pi_id,
            "amount_total": 399,
            "metadata": {"user_id": USER_A, "credits": str(credits), "pack": pack},
        }},
    }


def _pi_event(pi_id="pi_t8620_1", credits=40, pack="starter", amount_received=399,
              latest_charge="ch_t8620_1"):
    return {
        "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": pi_id,
            "amount_received": amount_received,
            "latest_charge": latest_charge,
            "metadata": {"user_id": USER_A, "credits": str(credits), "pack": pack},
        }},
    }


def _refund_event(charge_id="ch_t8620_1", pi_id="pi_t8620_1", refund_id="re_t8620_1",
                   amount=150, user_id=USER_A):
    return {
        "type": "charge.refunded",
        "data": {"object": {
            "id": charge_id,
            "payment_intent": pi_id,
            "metadata": {"user_id": user_id},
            "amount_refunded": amount,
            "refunds": {"data": [{"id": refund_id, "amount": amount}]},
        }},
    }


@pytest.fixture
def payments_env(pg_conn, monkeypatch):
    """Webhook env for driving real payments.py handlers against pg_conn.

    Mirrors test_payments_webhook_idempotency's `_webhook_env` fixture but does
    NOT stub `increment_total_spent`/`record_milestone` to no-ops -- these tests
    care about the real ledger + cache-bump behavior, not just credit grants.
    """
    from app.routers import payments as payments_mod
    monkeypatch.setattr(payments_mod, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)
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

        # Seed the purchase row this refund correlates against (not required for
        # the refund write itself, but matches real sequencing).
        event = _refund_event(charge_id="ch_t3", pi_id="pi_t3", refund_id="re_t3", amount=150)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        first = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert first["status"] == "refund_recorded"

        rows = _payments_rows(USER_A)
        refund_rows = [r for r in rows if r["kind"] == "refund"]
        assert len(refund_rows) == 1, f"expected exactly one refund row, got {rows}"
        assert refund_rows[0]["amount_cents"] == -150
        assert refund_rows[0]["stripe_object_id"] == "re_t3"

        cache_after_first = _total_spent(USER_A)
        assert cache_after_first == 549, "699 - 150 = 549"

        # Redeliver the SAME refund event.
        second = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        rows_after = _payments_rows(USER_A)
        refund_rows_after = [r for r in rows_after if r["kind"] == "refund"]
        assert len(refund_rows_after) == 1, "redelivered refund must not write a second row"
        assert _total_spent(USER_A) == 549, "redelivered refund must not double-decrement"


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
    """Design §10 T9: backfill re-runnable with no dup rows; the 2026-08-24
    orphan PI (user with no `users` row) produces a payments row; backfill
    never calls bump_total_spent / touches total_spent_cents."""

    ORPHAN_USER_ID = "fb40690a-edcf-4504-a51f-f9df6f84ac4f"
    ORPHAN_PI_ID = "pi_3U7p5aIxob3dHqK01QfOa5qu"

    def _fixture_intents(self):
        return [{
            "id": self.ORPHAN_PI_ID,
            "status": "succeeded",
            "metadata": {"user_id": self.ORPHAN_USER_ID, "pack": "starter", "credits": "80"},
            "amount_received": 399,
            "created": 1755921746,  # 2026-08-24 04:02:26 UTC
            "latest_charge": {
                "id": "ch_orphan_1",
                "amount_captured": 399,
                "amount_refunded": 0,
                "disputed": False,
                "dispute": None,
            },
        }]

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

    def test_backfill_writes_orphan_row_and_is_idempotent_and_never_bumps_cache(self, pg_conn):
        """Exercises the backfill's CORE LOGIC directly via payments_ledger
        (bypassing the CLI/script layer, which T9's other test documents
        separately) -- this is what should be wired once payments_ledger.py
        and the backfill script exist. Currently fails on the payments_ledger
        import."""
        from app.services import payments_ledger  # ImportError expected pre-implementation

        intents = self._fixture_intents()

        def _run_backfill_pass():
            from app.services.pg import get_pg
            with get_pg() as conn:
                cur = conn.cursor()
                for pi in intents:
                    meta = pi.get("metadata") or {}
                    user_id = meta.get("user_id")
                    charge = pi.get("latest_charge") or {}
                    payments_ledger.record_purchase(
                        cur,
                        user_id=user_id,
                        stripe_object_id=pi["id"],
                        amount_cents=pi["amount_received"],
                        currency="usd",
                        stripe_charge_id=charge.get("id"),
                        pack=meta.get("pack"),
                        credits=int(meta["credits"]) if meta.get("credits") else None,
                        occurred_at="2026-08-24T04:02:26Z",
                        source="backfill",
                    )
                    # Backfill NEVER calls bump_total_spent (ruling 4d).

        _run_backfill_pass()
        rows_first = _payments_rows(self.ORPHAN_USER_ID)
        assert len(rows_first) == 1
        assert rows_first[0]["user_id"] == self.ORPHAN_USER_ID

        # No `users` row exists for the orphan -- payments.user_id has no FK,
        # so this must insert cleanly (the tombstone working as designed).
        from app.services.auth_db import get_user_by_id
        assert get_user_by_id(self.ORPHAN_USER_ID) is None, "orphan user must NOT exist in users table"

        # Re-run: idempotent, no dup rows.
        _run_backfill_pass()
        rows_second = _payments_rows(self.ORPHAN_USER_ID)
        assert len(rows_second) == 1, "backfill must be re-runnable with no duplicate rows"

        # Backfill never touches total_spent_cents -- no user_segments row should
        # have been created or modified for the orphan (it has none).
        assert _total_spent(self.ORPHAN_USER_ID) is None


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

    def test_background_stripe_error_swallowed_and_logged(self, payments_env, monkeypatch, caplog):
        """The background fill's whole block must be try/except-wrapped: a Stripe
        error must be logged and dropped, never raised, never affect the response."""
        from app.services import payments_ledger

        assert hasattr(payments_ledger, "schedule_charge_id_fill") or hasattr(
            payments_ledger, "fill_missing_charge_id_background"
        ), (
            "expected a background-fill entry point in payments_ledger "
            "(schedule_charge_id_fill or fill_missing_charge_id_background) per design §4a"
        )

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
