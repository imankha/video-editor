"""
v037 (T13910): users gains `email_opted_out_at` + `email_unsubscribe_token`.

Subscriber email (release notes and ad-hoc announcements) goes to every user
whose `email_opted_out_at IS NULL`. The unsubscribe link in each email carries
the user's own random token, so no signing secret has to exist in any env.

Additive and idempotent. The token column's volatile DEFAULT fills a distinct
value into every EXISTING row as it is added, so no separate backfill runs and
no user is ever left without a token. NULL opted-out is correct history: no one
could opt out before this column existed.
"""

from ..base import BaseMigration


class V037EmailSubscription(BaseMigration):
    version = 37
    description = "Add users.email_opted_out_at / email_unsubscribe_token (T13910 subscriber email)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opted_out_at TIMESTAMPTZ")
        # Inline UNIQUE: same constraint name (users_email_unsubscribe_token_key)
        # as a fresh _SCHEMA_DDL table, and skipped with the column on a re-run.
        cur.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_unsubscribe_token "
            "TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text"
        )
