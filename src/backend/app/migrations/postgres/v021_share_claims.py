from ..base import BaseMigration


class V021ShareClaims(BaseMigration):
    version = 21
    description = "share_claims table: per-claimer record of a public game-link claim (T5730)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS share_claims (
                id SERIAL PRIMARY KEY,
                share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
                claimer_user_id TEXT NOT NULL,
                claimer_profile_id TEXT,
                include_annotations BOOLEAN NOT NULL DEFAULT false,
                local_game_id INTEGER,
                claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        # Idempotency: at most one claim row per (share, claimer). A re-claim
        # updates this row in place (see sharing_db.record_share_claim), so a
        # second claim resolves to the SAME local game rather than a new copy.
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_share_claims_unique "
            "ON share_claims(share_id, claimer_user_id)"
        )
        # Funnel query (T5740): claims per share.
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_share_claims_share ON share_claims(share_id)"
        )
