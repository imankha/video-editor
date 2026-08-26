from ..base import BaseMigration


class V023RenamePendingShareRecipientEmail(BaseMigration):
    version = 23
    description = (
        "Rename pending_teammate_shares.recipient_email -> invited_email (T7550): "
        "the column is ADVISORY (who the share was emailed to), never a claim gate. "
        "Any link/id-holder can claim (open-by-token, matching game_link) -- the "
        "old name misled readers into thinking it authorized the claim."
    )

    def up(self, conn):
        cur = conn.cursor()
        # RENAME COLUMN carries the dependent indexes automatically -- Postgres
        # rewrites idx_pending_shares_email / idx_pending_shares_email_unresolved
        # to reference the new column name, and their index names are unchanged.
        # Guarded so a re-run (or a fresh DB already at head via _SCHEMA_DDL) is a
        # no-op rather than an error.
        cur.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'pending_teammate_shares'
              AND column_name = 'recipient_email'
            """
        )
        if cur.fetchone():
            cur.execute(
                "ALTER TABLE pending_teammate_shares "
                "RENAME COLUMN recipient_email TO invited_email"
            )
