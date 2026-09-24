from ..base import BaseMigration


class V030PaymentsLedger(BaseMigration):
    version = 30
    description = (
        "T8620: append-only payments ledger -- one row per money event "
        "(purchase/refund/dispute), never updated or deleted; Stripe-captured "
        "amounts; pseudonymous (user_id only)."
    )

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS payments (
                id                 BIGSERIAL PRIMARY KEY,
                user_id            TEXT        NOT NULL,   -- opaque UUID, NEVER an email or name
                kind               TEXT        NOT NULL,   -- 'purchase' | 'refund' | 'dispute_lost' | 'dispute_won'
                amount_cents       INTEGER     NOT NULL,   -- signed: purchase > 0; refund/dispute_lost < 0; dispute_won > 0
                currency           TEXT        NOT NULL DEFAULT 'usd',
                stripe_object_id   TEXT        NOT NULL,   -- pi_... purchase; re_... refund; dp_... dispute
                stripe_charge_id   TEXT,                   -- ch_... when known (correlation across kinds)
                pack               TEXT,                   -- 'starter' | 'popular' | 'best_value' | NULL
                credits            INTEGER,                -- credits sold, purchase row only
                occurred_at        TIMESTAMPTZ NOT NULL,   -- Stripe's timestamp, not ours
                recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                source             TEXT        NOT NULL,   -- 'confirm_intent' | 'webhook' | 'verify' | 'backfill'
                account_deleted_at TIMESTAMPTZ             -- reserved for T8630; never filters revenue; never written by T8620
            )
        """)
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_object_kind "
            "ON payments(stripe_object_id, kind)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_payments_user "
            "ON payments(user_id, occurred_at DESC)"
        )
