"""Stripe webhook double-delivery must not double-grant (T5840 regression).

Stripe redelivers webhook events (up to 3 days on failure). Before T5840 this
was guarded by a UNIQUE index on (user_id, source, reference_id) in SQLite,
caught via `except sqlite3.IntegrityError`. Now it's credit_ledger.grant()'s
UNIQUE(user_id, idempotency_key) -- no exception handling needed, `applied`
just comes back False. Real Postgres via pg_conn since credits commit there now.
"""

import asyncio

import pytest

from app.pricing import CREDIT_PACKS

USER_ID = "user-a"


class _FakeRequest:
    def __init__(self, body=b"{}"):
        self.headers = {"stripe-signature": "sig"}
        self._body = body

    async def body(self):
        return self._body


# T8620: the ledger insert reads its amount from the captured Stripe fields
# directly (session.amount_total / intent.amount_received), never from the
# pack price table (design §2c) -- these fixtures set a realistic captured
# amount so the (now-unconditional) ledger write actually fires instead of
# logging CRITICAL and skipping (see payments.py's "no silent fallback" guard
# on a missing amount).
#
# T10220 prep: derive prices from CREDIT_PACKS (the single pricing source) so
# that when T10220 reprices a pack, BOTH the fixture's captured amount AND the
# revenue-once assertions below (which read the same map) move together and stay
# consistent -- never a hard-coded 699 that silently disagrees post-reprice.
_PACK_PRICE_CENTS = {key: pack["price_cents"] for key, pack in CREDIT_PACKS.items()}


def _checkout_event(session_id="cs_dup_1", credits=40, pack="starter", payment_intent=None):
    return {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": session_id,
            "payment_intent": payment_intent or f"pi_for_{session_id}",
            "amount_total": _PACK_PRICE_CENTS.get(pack, 399),
            "currency": "usd",
            "metadata": {"user_id": USER_ID, "credits": str(credits), "pack": pack},
        }},
    }


def _pi_event(pi_id="pi_dup_1", credits=40, pack="starter"):
    return {
        "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": pi_id,
            "amount_received": _PACK_PRICE_CENTS.get(pack, 399),
            "currency": "usd",
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
    # T8620: increment_total_spent no longer exists as a standalone function --
    # its body moved into payments_ledger.bump_total_spent, called only when the
    # ledger insert is new (see design §6). No stub needed: it runs for real
    # against pg_conn's test Postgres and is harmless here (these tests assert
    # on credit-grant idempotency, not on total_spent/ledger state).


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
    has committed at read time). grant() refuses the second credit atomically.

    T8620: the ledger insert (and the cache bump it drives,
    payments_ledger.bump_total_spent) is deliberately NOT gated on grant()'s
    `applied` anymore (design §4, ruling 4) -- it runs on every observation, so
    a redelivery reaching a prior failed insert can retry it. The
    double-counting protection this test guards is now enforced by the
    `payments` table's UNIQUE(stripe_object_id, kind) index: both racing
    deliveries key on the SAME Stripe object id, so only the first INSERT
    succeeds (`inserted=True`) and only that one calls bump_total_spent; the
    second is an `ON CONFLICT DO NOTHING` no-op. `record_milestone` is
    unaffected -- it is still gated on `applied`, which grant()'s own atomic
    idempotency key still guarantees fires at most once.

    Deliberately does NOT stub bump_total_spent to a no-op -- that would hide
    exactly what this test proves. Instead a counting spy proves it ran
    EXACTLY ONCE.
    """

    def _spies(self, monkeypatch):
        from app.routers import payments as payments_mod

        spent_calls = []
        milestone_calls = []
        monkeypatch.setattr(payments_mod.payments_ledger, "bump_total_spent",
                            lambda cur, uid, cents: spent_calls.append((uid, cents)))
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
        assert spent_calls == [(USER_ID, _PACK_PRICE_CENTS["popular"])], f"revenue double-counted: {spent_calls}"
        assert [m for m in milestone_calls if m[1] == "credit_purchased"] == [(USER_ID, "credit_purchased")]

    def test_payment_intent_race_counts_revenue_once(self, monkeypatch):
        from app.services.credit_ledger import get_credit_balance

        payments_mod, spent_calls, milestone_calls = self._spies(monkeypatch)
        event = _pi_event(pi_id="pi_race_2", credits=40, pack="popular")
        monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))
        asyncio.run(payments_mod.stripe_webhook(_FakeRequest()))

        assert get_credit_balance(USER_ID)["balance"] == 40, "grant is atomic; balance must not double"
        assert spent_calls == [(USER_ID, _PACK_PRICE_CENTS["popular"])], f"revenue double-counted: {spent_calls}"
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
