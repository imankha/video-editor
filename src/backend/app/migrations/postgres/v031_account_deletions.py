from ..base import BaseMigration


class V031AccountDeletions(BaseMigration):
    version = 31
    description = (
        "T8630: account deletion audit table + payments append-only trigger; "
        "deletion stamps account_deleted_at and records who/when/which-path/"
        "how-much, ledger rows preserved."
    )

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS account_deletions (
                id           BIGSERIAL   PRIMARY KEY,
                user_id      TEXT        NOT NULL,
                deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                actor        TEXT        NOT NULL,   -- 'self' | 'admin' | 'script'
                -- 'privacy_endpoint' | 'delete_user_script' | 'reset_test_account'
                -- | 'reset_test_user_script' | 'copy_user_between_envs'
                path         TEXT        NOT NULL,
                had_payments BOOLEAN     NOT NULL,
                net_cents    INTEGER     NOT NULL DEFAULT 0,  -- SUM(payments.amount_cents) at deletion
                note         TEXT
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_deletions_user_id "
            "ON account_deletions (user_id, deleted_at)"
        )

        cur.execute("""
            CREATE OR REPLACE FUNCTION payments_append_only() RETURNS trigger AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'payments is append-only: DELETE is forbidden';
              END IF;
              -- UPDATE: raise if any immutable column changed
              IF NEW.id IS DISTINCT FROM OLD.id
                 OR NEW.user_id IS DISTINCT FROM OLD.user_id
                 OR NEW.kind IS DISTINCT FROM OLD.kind
                 OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
                 OR NEW.currency IS DISTINCT FROM OLD.currency
                 OR NEW.stripe_object_id IS DISTINCT FROM OLD.stripe_object_id
                 OR NEW.pack IS DISTINCT FROM OLD.pack
                 OR NEW.credits IS DISTINCT FROM OLD.credits
                 OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
                 OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
                 OR NEW.source IS DISTINCT FROM OLD.source THEN
                RAISE EXCEPTION 'payments is append-only: immutable column changed';
              END IF;
              IF NEW.stripe_charge_id IS DISTINCT FROM OLD.stripe_charge_id
                 AND OLD.stripe_charge_id IS NOT NULL THEN
                RAISE EXCEPTION 'payments.stripe_charge_id is write-once (NULL->value only)';
              END IF;
              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        """)
        cur.execute("DROP TRIGGER IF EXISTS trg_payments_append_only ON payments")
        cur.execute("""
            CREATE TRIGGER trg_payments_append_only
              BEFORE UPDATE OR DELETE ON payments
              FOR EACH ROW EXECUTE FUNCTION payments_append_only()
        """)

        cur.execute("""
            CREATE OR REPLACE FUNCTION payments_no_truncate() RETURNS trigger AS $$
            BEGIN
              IF current_setting('reelballers.allow_payments_purge', true) = 'on' THEN
                RETURN NULL;
              END IF;
              RAISE EXCEPTION 'payments is append-only: TRUNCATE is forbidden';
            END;
            $$ LANGUAGE plpgsql;
        """)
        cur.execute("DROP TRIGGER IF EXISTS trg_payments_no_truncate ON payments")
        cur.execute("""
            CREATE TRIGGER trg_payments_no_truncate
              BEFORE TRUNCATE ON payments
              FOR EACH STATEMENT EXECUTE FUNCTION payments_no_truncate()
        """)
