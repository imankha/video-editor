"""T8660: Stripe receipt_email must be set server-side from the user's account
email on both purchase paths, so Stripe sends a receipt on capture. Never
sourced from the client -- receipt_email is absent from both request models.
"""

import asyncio

import pytest

USER_ID = "user-a"


@pytest.fixture(autouse=True)
def _setup(pg_conn, monkeypatch):
    from app.routers import payments as payments_mod
    from app.services.auth_db import create_user
    from app.services.user_db import set_stripe_customer_id
    from app.user_context import reset_user_id, set_current_user_id

    # Both endpoints 503 on a falsy STRIPE_SECRET_KEY before any patched Stripe
    # call runs. Branch CI has no .env (only local dev does), so without this
    # every test here would pass locally and fail red in CI.
    monkeypatch.setattr(payments_mod, "STRIPE_SECRET_KEY", "sk_test_dummy")

    create_user(USER_ID, email="a@test.com")
    set_stripe_customer_id(USER_ID, "cus_test123")
    set_current_user_id(USER_ID)
    yield
    reset_user_id()


class TestCreatePaymentIntentReceiptEmail:
    def test_receipt_email_sourced_from_account(self, monkeypatch):
        from app.routers import payments as payments_mod

        captured = {}

        def _fake_create(**kwargs):
            captured.update(kwargs)

            class _Intent:
                id = "pi_new_1"
                client_secret = "secret_1"

            return _Intent()

        monkeypatch.setattr(payments_mod.stripe.PaymentIntent, "create", _fake_create)
        monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)

        asyncio.run(payments_mod.create_payment_intent(payments_mod.CreateIntentRequest(pack="starter")))

        assert captured["receipt_email"] == "a@test.com"

    def test_no_resolvable_user_omits_receipt_rather_than_crashing(self, monkeypatch):
        """`users.email` is NOT NULL for any real account, so the only way
        get_user_by_id() returns no email is no Postgres row at all (e.g. a
        deleted account racing a stale session). Must degrade gracefully, not
        500 on a Stripe purchase."""
        from app.routers import payments as payments_mod
        from app.user_context import reset_user_id, set_current_user_id

        set_current_user_id("user-no-pg-row")
        try:
            from app.services.user_db import set_stripe_customer_id
            set_stripe_customer_id("user-no-pg-row", "cus_test456")

            captured = {}

            def _fake_create(**kwargs):
                captured.update(kwargs)

                class _Intent:
                    id = "pi_new_2"
                    client_secret = "secret_2"

                return _Intent()

            monkeypatch.setattr(payments_mod.stripe.PaymentIntent, "create", _fake_create)
            monkeypatch.setattr(payments_mod, "record_milestone", lambda *a, **k: None)

            asyncio.run(payments_mod.create_payment_intent(payments_mod.CreateIntentRequest(pack="starter")))

            assert captured["receipt_email"] is None
        finally:
            reset_user_id()


class TestCreateCheckoutReceiptEmail:
    def test_receipt_email_sourced_from_account(self, monkeypatch):
        from app.routers import payments as payments_mod

        captured = {}

        def _fake_create(**kwargs):
            captured.update(kwargs)

            class _Session:
                url = "https://checkout.stripe.com/session_1"

            return _Session()

        monkeypatch.setattr(payments_mod.stripe.checkout.Session, "create", _fake_create)

        asyncio.run(payments_mod.create_checkout(payments_mod.CheckoutRequest(pack="starter")))

        assert captured["payment_intent_data"] == {"receipt_email": "a@test.com"}

    def test_no_resolvable_user_sends_no_payment_intent_data(self, monkeypatch):
        from app.routers import payments as payments_mod
        from app.services.user_db import set_stripe_customer_id
        from app.user_context import reset_user_id, set_current_user_id

        set_current_user_id("user-no-pg-row-2")
        try:
            set_stripe_customer_id("user-no-pg-row-2", "cus_test789")

            captured = {}

            def _fake_create(**kwargs):
                captured.update(kwargs)

                class _Session:
                    url = "https://checkout.stripe.com/session_2"

                return _Session()

            monkeypatch.setattr(payments_mod.stripe.checkout.Session, "create", _fake_create)

            asyncio.run(payments_mod.create_checkout(payments_mod.CheckoutRequest(pack="starter")))

            assert captured["payment_intent_data"] == {"receipt_email": None}
        finally:
            reset_user_id()


class TestClientCannotSupplyReceiptEmail:
    """The request models are the only place a client-controlled value could
    reach receipt_email. Pydantic's default extra='ignore' drops unknown
    fields, so a client-supplied receipt_email never survives parsing -- this
    pins that mechanism directly, since neither router test above sends a
    request body built from raw client JSON."""

    def test_create_intent_request_drops_unknown_receipt_email(self):
        from app.routers import payments as payments_mod

        parsed = payments_mod.CreateIntentRequest.model_validate(
            {"pack": "starter", "receipt_email": "attacker@evil.com"}
        )
        assert not hasattr(parsed, "receipt_email")
        assert parsed.pack == "starter"

    def test_checkout_request_drops_unknown_receipt_email(self):
        from app.routers import payments as payments_mod

        parsed = payments_mod.CheckoutRequest.model_validate(
            {"pack": "starter", "receipt_email": "attacker@evil.com"}
        )
        assert not hasattr(parsed, "receipt_email")
        assert parsed.pack == "starter"
