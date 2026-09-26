"""T8675: dispute webhook writes ledger rows (+ late-settling refunds) -- Phase 1
FAILING tests.

Written against the kickoff + T8620-design.md contract. Production code does NOT
exist yet on the base revision:
  - no `charge.dispute.closed` branch in `routers/payments.py` (a lost dispute
    writes no live ledger row)
  - no `charge.refund.updated` / `refund.updated` branch (a refund that settles
    after `charge.refunded` fired never reaches the ledger live)

Every test here is expected to fail against the pre-change branch point, for one of:
  - AssertionError (no dispute_lost / late-refund row written; status "ignored")
  - the webhook falling through to {"status": "ignored", "type": ...}

Reuses the pg-backed harness + fixtures/builders from test_t8620_payments_ledger.
"""

import asyncio

import pytest

# Reuse the plain helper/builder functions proven by the T8620 suite. The webhook
# env fixture is (re)defined locally below so this file is self-contained and needs
# no cross-module fixture import (which ruff flags as an F811 redefinition).
from tests.test_t8620_payments_ledger import (
    USER_A,
    _FakeRequest,
    _mock_refund_list,
    _payments_rows,
    _pi_event,
    _refund,
    _refund_event,
    _seed_user_segment,
    _total_spent,
)


@pytest.fixture
def payments_env(pg_conn, monkeypatch):
    """Local webhook env (mirrors test_t8620_payments_ledger's fixture): sets the
    Stripe keys the user-facing sites gate on, stubs record_milestone, and installs
    a charge-less PaymentIntent.retrieve default so any stray background charge-id
    fill is a clean no-op. Tests that resolve a user_id override retrieve via
    `_mock_pi_user`."""
    from app.routers import payments as payments_mod
    monkeypatch.setattr(payments_mod, "STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setattr(payments_mod, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)
    monkeypatch.setattr(
        payments_mod.stripe.PaymentIntent, "retrieve",
        lambda *a, **k: {"id": (a[0] if a else k.get("id")), "latest_charge": None},
    )
    yield


# ---------------------------------------------------------------------------
# Event builders (disputes/refunds carry NO metadata.user_id -- we set it on the
# PaymentIntent, so the handler resolves user_id via the object's payment_intent)
# ---------------------------------------------------------------------------


def _dispute_event(dp_id="dp_t8675", charge_id="ch_t8675", pi_id="pi_t8675",
                   status="lost", amount=399, created=1690003000,
                   event_type="charge.dispute.closed"):
    return {
        "type": event_type,
        "data": {"object": {
            "id": dp_id,
            "charge": charge_id,
            "payment_intent": pi_id,
            "status": status,
            "amount": amount,
            "currency": "usd",
            "created": created,
        }},
    }


def _refund_updated_event(re_id="re_t8675", charge_id="ch_t8675", pi_id="pi_t8675",
                          status="succeeded", amount=399, created=1690004000,
                          event_type="charge.refund.updated"):
    return {
        "type": event_type,
        "data": {"object": {
            "id": re_id,
            "charge": charge_id,
            "payment_intent": pi_id,
            "status": status,
            "amount": amount,
            "currency": "usd",
            "created": created,
        }},
    }


def _mock_pi_user(monkeypatch, payments_mod, user_id=USER_A):
    """Stub stripe.PaymentIntent.retrieve so the dispute/refund user_id resolution
    (which goes object.payment_intent -> PI -> metadata.user_id) returns user_id."""
    monkeypatch.setattr(
        payments_mod.stripe.PaymentIntent, "retrieve",
        lambda *a, **k: {"id": (a[0] if a else k.get("id")),
                         "metadata": {"user_id": user_id}, "latest_charge": None},
    )


def _fire(payments_mod, monkeypatch, event):
    monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
    return asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))


# ---------------------------------------------------------------------------
# Dispute: a lost dispute writes exactly one negative row; redelivery writes none
# ---------------------------------------------------------------------------


class TestLostDisputeWritesNegativeRow:
    def test_lost_dispute_writes_one_negative_row(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 399)
        from app.routers import payments as payments_mod
        _mock_pi_user(monkeypatch, payments_mod)

        result = _fire(payments_mod, monkeypatch,
                       _dispute_event(dp_id="dp_lost1", amount=399, created=1690003000))
        assert result["status"] == "dispute_recorded", result

        rows = [r for r in _payments_rows(USER_A) if r["kind"] == "dispute_lost"]
        assert len(rows) == 1, f"expected exactly one dispute_lost row, got {_payments_rows(USER_A)}"
        assert rows[0]["amount_cents"] == -399
        assert rows[0]["stripe_object_id"] == "dp_lost1"
        assert rows[0]["stripe_charge_id"] == "ch_t8675"
        # occurred_at is the dispute's own Stripe `created`, not now().
        assert rows[0]["occurred_at"].timestamp() == 1690003000
        # cache decremented by the lost dispute (mirrors refund handling).
        assert _total_spent(USER_A) == 0, "399 - 399 = 0"

    def test_redelivery_writes_no_second_row(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 399)
        from app.routers import payments as payments_mod
        _mock_pi_user(monkeypatch, payments_mod)

        event = _dispute_event(dp_id="dp_lost2", amount=399)
        _fire(payments_mod, monkeypatch, event)
        assert _total_spent(USER_A) == 0
        _fire(payments_mod, monkeypatch, event)  # redeliver

        rows = [r for r in _payments_rows(USER_A) if r["kind"] == "dispute_lost"]
        assert len(rows) == 1, "redelivery must not write a second dispute_lost row"
        assert _total_spent(USER_A) == 0, "redelivery must not double-decrement the cache"


class TestWonDisputeWritesNoRow:
    def test_won_dispute_writes_no_row(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 399)
        from app.routers import payments as payments_mod
        _mock_pi_user(monkeypatch, payments_mod)

        result = _fire(payments_mod, monkeypatch,
                       _dispute_event(dp_id="dp_won1", status="won", amount=399))
        assert result["status"] != "dispute_recorded", result

        rows = [r for r in _payments_rows(USER_A) if r["kind"] in ("dispute_lost", "dispute_won")]
        assert rows == [], f"a won dispute writes no row, got {rows}"
        assert _total_spent(USER_A) == 399, "a won dispute leaves the cache untouched"

    def test_charge_refunded_status_dispute_writes_no_dispute_row(self, payments_env, monkeypatch):
        """A dispute resolved by refunding the charge (status charge_refunded) must
        NOT get a dispute_lost row from the LIVE path -- that money is recorded by
        the charge.refunded -> refund-row path, so a dispute row would double-count
        (the reconciler nets it; the append-only ledger can't)."""
        _seed_user_segment(USER_A, 399)
        from app.routers import payments as payments_mod
        _mock_pi_user(monkeypatch, payments_mod)

        result = _fire(payments_mod, monkeypatch,
                       _dispute_event(dp_id="dp_cr1", status="charge_refunded", amount=399))
        assert result["status"] != "dispute_recorded", result
        rows = [r for r in _payments_rows(USER_A) if r["kind"] == "dispute_lost"]
        assert rows == [], "charge_refunded-status dispute must not write a dispute_lost row live"


# ---------------------------------------------------------------------------
# Late-settling refunds: charge.refund.updated / refund.updated
# ---------------------------------------------------------------------------


class TestLateSettlingRefund:
    def test_refund_updated_succeeded_writes_row_once(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 399)
        from app.routers import payments as payments_mod
        _mock_pi_user(monkeypatch, payments_mod)

        event = _refund_updated_event(re_id="re_late1", amount=399, created=1690004000)
        result = _fire(payments_mod, monkeypatch, event)
        assert result["status"] == "refund_recorded", result

        rows = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert len(rows) == 1
        assert rows[0]["amount_cents"] == -399
        assert rows[0]["stripe_object_id"] == "re_late1"
        assert rows[0]["stripe_charge_id"] == "ch_t8675"
        assert rows[0]["occurred_at"].timestamp() == 1690004000
        assert _total_spent(USER_A) == 0

        # Redeliver: no second row, no double-decrement.
        _fire(payments_mod, monkeypatch, event)
        rows2 = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert len(rows2) == 1, "redelivered refund.updated must not write a second row"
        assert _total_spent(USER_A) == 0

    def test_pending_refund_updated_writes_no_row(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 399)
        from app.routers import payments as payments_mod
        _mock_pi_user(monkeypatch, payments_mod)

        result = _fire(payments_mod, monkeypatch,
                       _refund_updated_event(re_id="re_pending1", status="pending", amount=399))
        assert result["status"] != "refund_recorded", result
        rows = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert rows == [], "a pending refund.updated must not write a row"
        assert _total_spent(USER_A) == 399

    def test_newer_refund_updated_event_type_also_handled(self, payments_env, monkeypatch):
        """Stripe sends `charge.refund.updated` on most/legacy API versions and
        `refund.updated` on newer ones; we pin no API version, so both are handled."""
        _seed_user_segment(USER_A, 399)
        from app.routers import payments as payments_mod
        _mock_pi_user(monkeypatch, payments_mod)

        result = _fire(payments_mod, monkeypatch,
                       _refund_updated_event(re_id="re_newev", amount=399,
                                             event_type="refund.updated"))
        assert result["status"] == "refund_recorded", result
        rows = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert [r["stripe_object_id"] for r in rows] == ["re_newev"]

    def test_refund_settles_after_charge_refunded_records_exactly_once(self, payments_env, monkeypatch):
        """The headline late-settle case: charge.refunded fires while the refund is
        still `pending` (skipped, no row), then charge.refund.updated fires once it
        settles to `succeeded` (writes the row). Keyed on the same re_ id, so a
        later charge.refunded redelivery is a no-op -- exactly one row, one bump."""
        _seed_user_segment(USER_A, 399)
        from app.routers import payments as payments_mod
        _mock_pi_user(monkeypatch, payments_mod)

        # 1) charge.refunded while the refund is still pending -> no row.
        cr_event = _refund_event(charge_id="ch_late", pi_id="pi_late", amount_refunded=399)
        _mock_refund_list(monkeypatch, payments_mod, [_refund("re_late2", 399, status="pending")])
        _fire(payments_mod, monkeypatch, cr_event)
        assert [r for r in _payments_rows(USER_A) if r["kind"] == "refund"] == []
        assert _total_spent(USER_A) == 399, "pending refund must not decrement yet"

        # 2) charge.refund.updated once it settles -> writes the row exactly once.
        ru_event = _refund_updated_event(re_id="re_late2", charge_id="ch_late",
                                         pi_id="pi_late", status="succeeded", amount=399)
        _fire(payments_mod, monkeypatch, ru_event)
        rows = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert len(rows) == 1, "the settled refund must write exactly one row"
        assert rows[0]["stripe_object_id"] == "re_late2"
        assert _total_spent(USER_A) == 0

        # 3) charge.refunded redelivers, now seeing the succeeded refund -> no dup.
        _mock_refund_list(monkeypatch, payments_mod, [_refund("re_late2", 399, status="succeeded")])
        _fire(payments_mod, monkeypatch, cr_event)
        rows2 = [r for r in _payments_rows(USER_A) if r["kind"] == "refund"]
        assert len(rows2) == 1, "charge.refunded redelivery of a now-settled refund must not dup"
        assert _total_spent(USER_A) == 0


# ---------------------------------------------------------------------------
# SUM(amount_cents) per user matches the reconciler's Stripe net after a lost dispute
# ---------------------------------------------------------------------------


class TestLedgerSumMatchesReconciler:
    def test_sum_matches_reconciler_net_after_lost_dispute(self, payments_env, monkeypatch):
        _seed_user_segment(USER_A, 0)
        from app.routers import payments as payments_mod
        from app.services import revenue_reconciliation

        # Drive a purchase (pi) then a lost dispute for the same charge.
        pi_event = _pi_event(pi_id="pi_sum", amount_received=399, latest_charge="ch_sum")
        _fire(payments_mod, monkeypatch, pi_event)

        _mock_pi_user(monkeypatch, payments_mod)
        _fire(payments_mod, monkeypatch,
              _dispute_event(dp_id="dp_sum", charge_id="ch_sum", pi_id="pi_sum",
                             status="lost", amount=399))

        # Ledger SUM for the user.
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE user_id = %s", (USER_A,))
            ledger_sum = cur.fetchone()["s"]

        # Reconciler net for the same Stripe facts.
        recon_intent = {
            "id": "pi_sum", "status": "succeeded", "created": 1690001000,
            "metadata": {"user_id": USER_A},
            "amount_received": 399,
            "latest_charge": {"amount_captured": 399, "amount_refunded": 0,
                              "dispute": {"status": "lost", "amount": 399}},
        }
        agg = revenue_reconciliation.build_stripe_net_by_user([recon_intent])
        assert ledger_sum == agg[USER_A]["net_cents"] == 0, (
            f"ledger SUM {ledger_sum} must equal reconciler net {agg[USER_A]['net_cents']}"
        )
