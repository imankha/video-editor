"""Stripe webhook double-delivery must not double-grant (T5840 regression).

Stripe redelivers webhook events (up to 3 days on failure). Before T5840 this
was guarded by a UNIQUE index on (user_id, source, reference_id) in SQLite,
caught via `except sqlite3.IntegrityError`. Now it's credit_ledger.grant()'s
UNIQUE(user_id, idempotency_key) -- no exception handling needed, `applied`
just comes back False. Real Postgres via pg_conn since credits commit there now.
"""

import asyncio

import pytest

USER_ID = "user-a"


class _FakeRequest:
    def __init__(self, body=b"{}"):
        self.headers = {"stripe-signature": "sig"}
        self._body = body

    async def body(self):
        return self._body


def _checkout_event(session_id="cs_dup_1", credits=40, pack="starter"):
    return {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": session_id,
            "metadata": {"user_id": USER_ID, "credits": str(credits), "pack": pack},
        }},
    }


def _pi_event(pi_id="pi_dup_1", credits=40, pack="starter"):
    return {
        "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": pi_id,
            "metadata": {"user_id": USER_ID, "credits": str(credits), "pack": pack},
        }},
    }


def _pi_failed_event(pi_id="pi_failed_1", error_type="card_error", error_code="card_declined"):
    return {
        "type": "payment_intent.payment_failed",
        "data": {"object": {
            "id": pi_id,
            "metadata": {"user_id": USER_ID},
            "last_payment_error": {"type": error_type, "code": error_code},
        }},
    }


@pytest.fixture(autouse=True)
def _webhook_env(pg_conn, monkeypatch):
    from app.routers import payments as payments_mod
    monkeypatch.setattr(payments_mod, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)
    monkeypatch.setattr(payments_mod, "increment_total_spent", lambda *a, **k: None)


class TestCheckoutSessionWebhookDoubleDelivery:
    def test_redelivered_event_does_not_double_grant(self, monkeypatch):
        from app.routers import payments as payments_mod
        from app.services.credit_ledger import get_credit_balance

        event = _checkout_event()
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        first = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        second = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert first["status"] == "credits_granted"
        assert first["balance"] == 40
        assert second["status"] == "already_processed"
        assert get_credit_balance(USER_ID)["balance"] == 40, "redelivery must not double-grant"


class TestPaymentIntentWebhookDoubleDelivery:
    def test_redelivered_event_does_not_double_grant(self, monkeypatch):
        from app.routers import payments as payments_mod
        from app.services.credit_ledger import get_credit_balance

        event = _pi_event()
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        first = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        second = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert first["status"] == "credits_granted"
        assert first["balance"] == 40
        assert second["status"] == "already_processed"
        assert get_credit_balance(USER_ID)["balance"] == 40, "redelivery must not double-grant"

class TestWebhookRaceDoesNotDoubleCountRevenue:
    """MAJOR-1 regression: `has_processed_payment` is a plain UNLOCKED read, so
    two concurrent deliveries of the SAME event can both pass it (neither grant
    has committed at read time). grant() refuses the second credit atomically,
    but the revenue analytics (record_milestone / increment_total_spent) run
    AFTER the read and MUST be gated on grant()'s `applied` -- otherwise
    total_spent_cents is double-counted, which T5760 reconciliation misreads as
    revenue_drift and 'heals' in the wrong direction. Master short-circuited
    these paths (except sqlite3.IntegrityError) BEFORE recording analytics; Slice
    B deleted those short-circuits, so this gate restores the property.

    Deliberately does NOT stub increment_total_spent to a no-op -- that is what
    hid the bug (test_payments_webhook_idempotency's own fixture does). Instead a
    counting spy proves it ran EXACTLY ONCE.
    """

    def _spies(self, monkeypatch):
        from app.routers import payments as payments_mod

        spent_calls = []
        milestone_calls = []
        monkeypatch.setattr(payments_mod, "increment_total_spent",
                            lambda uid, cents: spent_calls.append((uid, cents)))
        monkeypatch.setattr(payments_mod, "record_milestone",
                            lambda uid, name, *a, **k: milestone_calls.append((uid, name)))
        # Force BOTH deliveries through the has_processed_payment gate: simulate
        # the race window where neither grant has committed at read time.
        monkeypatch.setattr(payments_mod, "has_processed_payment", lambda *a, **k: False)
        return payments_mod, spent_calls, milestone_calls

    def test_checkout_race_counts_revenue_once(self, monkeypatch):
        from app.services.credit_ledger import get_credit_balance

        payments_mod, spent_calls, milestone_calls = self._spies(monkeypatch)
        event = _checkout_event(session_id="cs_race_1", credits=40, pack="popular")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert get_credit_balance(USER_ID)["balance"] == 40, "grant is atomic; balance must not double"
        assert spent_calls == [(USER_ID, 699)], f"revenue double-counted: {spent_calls}"
        assert [m for m in milestone_calls if m[1] == "credit_purchased"] == [(USER_ID, "credit_purchased")]

    def test_payment_intent_race_counts_revenue_once(self, monkeypatch):
        from app.services.credit_ledger import get_credit_balance

        payments_mod, spent_calls, milestone_calls = self._spies(monkeypatch)
        event = _pi_event(pi_id="pi_race_2", credits=40, pack="popular")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert get_credit_balance(USER_ID)["balance"] == 40, "grant is atomic; balance must not double"
        assert spent_calls == [(USER_ID, 699)], f"revenue double-counted: {spent_calls}"
        assert [m for m in milestone_calls if m[1] == "credit_purchased"] == [(USER_ID, "credit_purchased")]


class TestConfirmIntentWebhookRace:
    def test_race_between_confirm_intent_and_webhook_is_safe(self, monkeypatch):
        """The frontend's /confirm-intent and the webhook can both fire for the
        same PI (T526 fallback design) -- both key on stripe:{pi_id}, so
        whichever lands second is a no-op, never a double-grant."""
        from app.routers import payments as payments_mod
        from app.services.credit_ledger import get_credit_balance, grant_credits

        pi_id = "pi_race_1"
        # Simulate /confirm-intent winning the race first.
        grant_credits(USER_ID, 40, "stripe_purchase", pi_id)
        assert get_credit_balance(USER_ID)["balance"] == 40

        event = _pi_event(pi_id=pi_id)
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)
        result = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert result["status"] == "already_processed"
        assert get_credit_balance(USER_ID)["balance"] == 40


class TestPaymentFailedWebhook:
    """T7510: payment_intent.payment_failed emits the taxonomy's failure outcome
    for the payment funnel action (payment_started already fires at intent
    creation)."""

    def test_card_decline_emits_refused_reason(self, monkeypatch):
        from app.routers import payments as payments_mod

        calls = []
        monkeypatch.setattr(
            payments_mod, "record_milestone",
            lambda user_id, event, context=None, reason=None: calls.append((user_id, event, reason)),
        )
        event = _pi_failed_event(error_type="card_error", error_code="card_declined")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        result = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert result["status"] == "payment_failed"
        assert result["reason"] == "refused"
        assert (USER_ID, "payment_failed", "refused") in calls

    def test_non_card_error_emits_unknown_reason(self, monkeypatch):
        from app.routers import payments as payments_mod

        calls = []
        monkeypatch.setattr(
            payments_mod, "record_milestone",
            lambda user_id, event, context=None, reason=None: calls.append((user_id, event, reason)),
        )
        event = _pi_failed_event(error_type="api_error", error_code="processing_error")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        result = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert result["reason"] == "unknown"
        assert (USER_ID, "payment_failed", "unknown") in calls

    def test_missing_user_id_metadata_does_not_crash(self, monkeypatch):
        from app.routers import payments as payments_mod

        event = _pi_failed_event()
        event["data"]["object"]["metadata"] = {}
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        result = asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        assert result["status"] == "error"
