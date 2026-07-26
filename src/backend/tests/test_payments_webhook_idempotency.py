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
