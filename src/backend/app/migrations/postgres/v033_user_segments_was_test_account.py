from ..base import BaseMigration


class V033UserSegmentsWasTestAccount(BaseMigration):
    """T8630 round 5: snapshot each account's `is_test_account` flag onto its
    `user_segments` row at the moment the account is deleted.

    A real deletion drops the `users` row but KEEPS the de-identified
    `user_segments` row (v032) so the payments ledger's channel/cohort revenue
    still attributes to the payer's real origin. But the admin test-exclusion
    join (`NOT u.is_test_account`) reads the flag off `users`, which is now gone,
    so a deleted payer fell out of every `exclude_test=true` view (the dashboard
    DEFAULT) and their revenue leaked into the Unattributed remainder.

    This column lets the exclusion predicate fall back to the value the account
    had WHILE it was live: `NOT COALESCE(u.is_test_account, s.was_test_account,
    false)` -- prefer the live `users` flag, else the snapshot, else treat as
    not-test. Live rows keep it NULL (they are joined to `users.is_test_account`
    directly and never read this column); the deletion paths set it right before
    `DELETE FROM users`.

    Nullable with no default: NULL means "no snapshot" (a live row, or a row that
    predates this column), which the COALESCE reads as not-a-test-account.
    Idempotent (ADD COLUMN IF NOT EXISTS); mirrored in `pg.py` `_SCHEMA_DDL`.
    """

    version = 33
    description = (
        "T8630 r5: add user_segments.was_test_account snapshot so a deleted "
        "payer keeps the exact test-exclusion status it had while live"
    )

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            "ALTER TABLE user_segments "
            "ADD COLUMN IF NOT EXISTS was_test_account BOOLEAN"
        )
