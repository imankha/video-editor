"""v045 (T15290): owner ruling 2026-11-07 on account deletion --

1. `account_deletions.email_hash` -- a keyed (HMAC-SHA256) hash of the deleted
   account's normalised email, written by `record_account_deletion` for the
   three REAL deletion paths (privacy endpoint, delete_user.py,
   copy_user_between_envs.py). Lets a later sign-up recognise a returning
   person without ever storing or restoring the plaintext email.
2. `user_segments.returning_after_deletion` -- set at sign-up when the new
   account's email hash matches a past deletion. Analytics only; never
   restores data, never blocks the sign-up.

Existing rows stay NULL / false: no past deletion or sign-up recorded either
signal before this change. Additive and idempotent. Until this runs,
record_account_deletion/create_user_segment probe for the columns and write
without them (logged), so neither a deletion nor a sign-up ever fails.
"""

from ..base import BaseMigration


class V045AccountDeletionHashAndReturning(BaseMigration):
    version = 45
    description = (
        "Add account_deletions.email_hash + user_segments.returning_after_deletion "
        "(T15290 account deletion keeps analytics)"
    )

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS email_hash TEXT")
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_deletions_email_hash "
            "ON account_deletions (email_hash)"
        )
        cur.execute(
            "ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS "
            "returning_after_deletion BOOLEAN NOT NULL DEFAULT false"
        )
