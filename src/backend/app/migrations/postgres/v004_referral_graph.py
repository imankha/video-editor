from ..base import BaseMigration


class V004ReferralGraph(BaseMigration):
    version = 4
    description = "Add referrals table and invite_code column on users"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code VARCHAR(8)")
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code "
            "ON users(invite_code) WHERE invite_code IS NOT NULL"
        )

        cur.execute("""
            CREATE TABLE IF NOT EXISTS referrals (
                id SERIAL PRIMARY KEY,
                referrer_id TEXT NOT NULL REFERENCES users(user_id),
                referred_id TEXT NOT NULL REFERENCES users(user_id) UNIQUE,
                channel VARCHAR(20) NOT NULL,
                source_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_referrals_channel ON referrals(channel)"
        )
