from ..base import BaseMigration


class V007ClearStaleStripeCustomers(BaseMigration):
    """Clear stored Stripe customer ids minted in test mode.

    T4940 go-live: prod switched from test to live Stripe keys on 2026-07-22.
    Every existing stripe_customers row was created against test mode, and
    live Stripe rejects those ids with 400 "No such customer", breaking all
    purchases. Delete them; the purchase endpoints create a customer on
    demand when none is stored (_get_or_create_customer in payments.py), so
    the next purchase mints a live-mode customer.

    Idempotent (unconditional DELETE). Safe on dev/staging too: those envs
    stay in test mode and simply get fresh test-mode customers on the next
    purchase attempt.
    """

    version = 7
    description = "Clear test-mode Stripe customer ids after live-mode switch"

    def up(self, conn) -> None:
        conn.execute("DELETE FROM stripe_customers")
