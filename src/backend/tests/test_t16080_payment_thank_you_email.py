"""T16080: every completed credit purchase sends one thank-you email (Discord +
tutorial links, reply-able from hello@reelballers.com). Driven through the real
payment handlers (confirm-intent, verify, webhook) down to the Resend HTTP call;
only the network transport and Stripe SDK calls are faked.
"""
import asyncio

import pytest
from starlette.background import BackgroundTasks

from app.pricing import CREDIT_PACKS

USER_ID = "user-a"
USER_EMAIL = "payer@test.com"

_PACK_PRICE_CENTS = {key: pack["price_cents"] for key, pack in CREDIT_PACKS.items()}


class _FakeResp:
    status_code = 200
    text = "ok"


class _FakeResend:
    """Stands in for httpx.AsyncClient inside app.services.email; records every POST."""

    def __init__(self, behaviour="ok"):
        self.posts = []
        self.behaviour = behaviour

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        self.posts.append({"url": url, "headers": headers, "json": json})
        if self.behaviour == "raise":
            raise RuntimeError("resend down")
        return _FakeResp()


@pytest.fixture
def resend(monkeypatch):
    from app.services import email as email_service
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    fake = _FakeResend()
    monkeypatch.setattr(email_service.httpx, "AsyncClient", fake)
    return fake


@pytest.fixture(autouse=True)
def _setup(pg_conn, monkeypatch):
    from app.routers import payments as payments_mod
    from app.services.auth_db import create_user

    async def _no_charge_id_fill(*a, **k):
        return None

    monkeypatch.setattr(payments_mod, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(payments_mod, "STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)
    # Irrelevant to this task: avoid a real Stripe network call from the
    # unrelated charge-id backfill when draining background tasks below.
    monkeypatch.setattr(payments_mod.payments_ledger, "schedule_charge_id_fill", _no_charge_id_fill)
    create_user(USER_ID, email=USER_EMAIL)


class _FakeWebhookRequest:
    def __init__(self, body=b"{}"):
        self.headers = {"stripe-signature": "sig"}
        self._body = body

    async def body(self):
        return self._body


class _FakeVerifyRequest:
    def __init__(self, session_id):
        self._session_id = session_id

    async def json(self):
        return {"session_id": self._session_id}


def _checkout_event(session_id, credits=40, pack="starter", payment_intent=None):
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


def _run_webhook(monkeypatch, event):
    """Run the webhook handler and drain its fire-and-forget background task
    (webhook has no BackgroundTasks param, see _queue_payment_thank_you_email),
    the same way a live uvicorn event loop eventually would."""
    from app.routers import payments as payments_mod
    monkeypatch.setattr(payments_mod.stripe.Webhook, "construct_event", lambda *a, **k: event)

    async def _drive():
        before = asyncio.all_tasks()
        result = await payments_mod.stripe_webhook(_FakeWebhookRequest())
        new_tasks = asyncio.all_tasks() - before
        if new_tasks:
            await asyncio.gather(*new_tasks)
        return result

    return asyncio.run(_drive())


def _run_verify_session(session, session_id):
    from app.routers import payments as payments_mod
    from app.user_context import reset_user_id, set_current_user_id

    async def _drive():
        set_current_user_id(USER_ID)
        try:
            bt = BackgroundTasks()
            result = await payments_mod.verify_session(_FakeVerifyRequest(session_id), background_tasks=bt)
            await bt()
            return result
        finally:
            reset_user_id()

    import app.routers.payments as payments_mod_ref
    payments_mod_ref.stripe.checkout.Session.retrieve = staticmethod(lambda *a, **k: session)
    return asyncio.run(_drive())


def _assert_is_thank_you(post, to):
    from app.services import email as email_service
    payload = post["json"]
    assert payload["to"] == [to]
    assert "hello@reelballers.com" in payload["from"]
    assert payload["subject"] == "Thank you for your purchase"
    html = payload["html"]
    assert email_service.TUTORIAL_URL in html
    assert dict(email_service.SOCIAL_LINKS)["Discord"] in html


class _FakeSession:
    def __init__(self, session_id, pack="starter", credits=40):
        self.id = session_id
        self.payment_status = "paid"
        self.payment_intent = f"pi_for_{session_id}"
        self.amount_total = _PACK_PRICE_CENTS.get(pack, 399)
        self.currency = "usd"
        self.created = 1700000000
        self.metadata = {"user_id": USER_ID, "credits": str(credits), "pack": pack}


class TestVerifySessionSendsThankYou:
    def test_one_email_per_completed_session(self, resend, monkeypatch):
        session_id = "cs_thanks_1"
        result = _run_verify_session(_FakeSession(session_id), session_id)

        assert result["status"] == "credits_granted"
        assert len(resend.posts) == 1
        _assert_is_thank_you(resend.posts[0], USER_EMAIL)
        assert resend.posts[0]["headers"]["Idempotency-Key"] == f"payment-thank-you:{session_id}"


class TestWebhookSendsThankYou:
    def test_checkout_completed_sends_one_email(self, resend, monkeypatch):
        event = _checkout_event("cs_thanks_2")
        result = _run_webhook(monkeypatch, event)

        assert result["status"] == "credits_granted"
        assert len(resend.posts) == 1
        _assert_is_thank_you(resend.posts[0], USER_EMAIL)
        assert resend.posts[0]["headers"]["Idempotency-Key"] == "payment-thank-you:cs_thanks_2"

    def test_redelivered_event_sends_no_second_email(self, resend, monkeypatch):
        event = _checkout_event("cs_thanks_3")
        _run_webhook(monkeypatch, event)
        _run_webhook(monkeypatch, event)

        assert len(resend.posts) == 1, "a redelivered webhook must not send a second thank-you email"

    def test_two_purchases_send_two_emails(self, resend, monkeypatch):
        _run_webhook(monkeypatch, _checkout_event("cs_thanks_4a"))
        _run_webhook(monkeypatch, _checkout_event("cs_thanks_4b"))

        assert len(resend.posts) == 2, "a second purchase gets its own thank-you email"


class TestEmailFailureDoesNotFailPayment:
    def test_resend_failure_still_grants_credits(self, resend, monkeypatch):
        resend.behaviour = "raise"
        event = _checkout_event("cs_thanks_5")

        result = _run_webhook(monkeypatch, event)

        assert result["status"] == "credits_granted"
        assert result["balance"] == 40
