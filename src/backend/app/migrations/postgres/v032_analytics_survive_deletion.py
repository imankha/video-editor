from ..base import BaseMigration


class V032AnalyticsSurviveDeletion(BaseMigration):
    """T8630 round 4: a real account deletion now KEEPS the user's analytics rows
    (de-identified, under the same opaque user_id) instead of deleting them, so
    the payments ledger's channel/cohort attribution still resolves (a deleted
    payer attributes to their real channel instead of dropping out).

    For those rows to survive `DELETE FROM users`, the analytics tables must stop
    referencing `users` -- exactly like the `payments` ledger (T8620), which has
    no FK to `users` precisely so it outlives account deletion. This drops EVERY
    FK from `user_segments`, `user_actions`, and `referrals` to `users(user_id)`.
    `user_usage_daily` never had one.

    NAME-AGNOSTIC by design: the constraints are looked up from `pg_constraint`
    and dropped by whatever name they actually carry, NOT by a guessed
    `<table>_<col>_fkey`. This matters because `user_actions` was created in v007
    as `user_flow_events` (FK auto-named `user_flow_events_user_id_fkey`) and
    RENAMED to `user_actions` in v009 -- Postgres does not rename a table's
    dependent constraints, so on any real upgraded DB the live FK is still named
    `user_flow_events_user_id_fkey`. A hardcoded `DROP CONSTRAINT IF EXISTS
    user_actions_user_id_fkey` would silently no-op there and leave the FK in
    place, breaking every real deletion. Querying `pg_constraint` drops the FK
    regardless of its history.

    PKs, the `referrals.referred_id` UNIQUE constraint, and every non-FK index
    are untouched -- only the referential constraints to `users` go. Idempotent
    (a second run finds no such FKs and drops nothing); mirrored in `pg.py`
    `_SCHEMA_DDL` (fresh DBs are created without these FKs).
    """

    version = 32
    description = (
        "T8630 r4: drop analytics->users FKs so user_segments/user_actions/"
        "referrals rows survive account deletion (de-identified, kept for "
        "channel/cohort revenue attribution), matching the payments ledger."
    )

    @staticmethod
    def _val(row, key, idx):
        # Tolerate either RealDictCursor (dict rows) or a plain cursor (tuples).
        return row[key] if isinstance(row, dict) else row[idx]

    def up(self, conn):
        cur = conn.cursor()
        # `regclass` casts raise on an absent relation, so guard each table (and
        # `users`) with to_regclass, which returns NULL instead. In a real
        # postgres run all of these exist; the guard just keeps the migration
        # safe on a partial/scratch DB.
        cur.execute("SELECT to_regclass('public.users') AS oid")
        if self._val(cur.fetchone(), "oid", 0) is None:
            return
        for table in ("user_segments", "user_actions", "referrals"):
            cur.execute("SELECT to_regclass(%s) AS oid", (f"public.{table}",))
            if self._val(cur.fetchone(), "oid", 0) is None:
                continue
            # Every FK from this table to `users`, by ACTUAL name (see class
            # docstring for the user_flow_events->user_actions rename hazard).
            cur.execute(
                """
                SELECT conname FROM pg_constraint
                WHERE contype = 'f'
                  AND confrelid = 'users'::regclass
                  AND conrelid = %s::regclass
                """,
                (table,),
            )
            for row in cur.fetchall():
                conname = self._val(row, "conname", 0)
                cur.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS "{conname}"')
