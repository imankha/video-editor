from ..base import BaseMigration


class V019Credits(BaseMigration):
    version = 19
    description = (
        "Add credits, credit_transactions, credit_reservations, credit_migration_state "
        "(T5840: move money out of the per-user SQLite last-write-wins blob)"
    )

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS credits (
                user_id     TEXT PRIMARY KEY,
                balance     INTEGER     NOT NULL DEFAULT 0 CHECK (balance >= 0),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS credit_transactions (
                id              BIGSERIAL PRIMARY KEY,
                user_id         TEXT        NOT NULL,
                amount          INTEGER     NOT NULL CHECK (amount <> 0),
                source          TEXT        NOT NULL,
                idempotency_key TEXT        NOT NULL,
                reference_id    TEXT,
                video_seconds   REAL,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_idem "
            "ON credit_transactions(user_id, idempotency_key)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created "
            "ON credit_transactions(user_id, created_at DESC, id DESC)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_credit_tx_source ON credit_transactions(source)"
        )
        cur.execute("""
            CREATE TABLE IF NOT EXISTS credit_reservations (
                job_id        TEXT PRIMARY KEY,
                user_id       TEXT        NOT NULL,
                profile_id    TEXT,
                amount        INTEGER     NOT NULL,
                video_seconds REAL,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_credit_reservations_user "
            "ON credit_reservations(user_id)"
        )
        cur.execute("""
            CREATE TABLE IF NOT EXISTS credit_migration_state (
                id               INTEGER PRIMARY KEY CHECK (id = 1),
                ready_at         TIMESTAMPTZ,
                backfilled_users INTEGER NOT NULL DEFAULT 0,
                last_report      JSONB,
                last_report_at   TIMESTAMPTZ
            )
        """)
