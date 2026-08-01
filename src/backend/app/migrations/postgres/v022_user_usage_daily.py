from ..base import BaseMigration


class V022UserUsageDaily(BaseMigration):
    """T5770: per-user per-day engaged-usage buckets.

    Complements the all-time running total (user_segments.total_usage_seconds)
    with time-bucketed data so the admin dashboard can show a trailing "last 7
    days" figure. History is NOT backfilled (per-day usage was never recorded) —
    the column becomes accurate ~7 days after this migration runs and honestly
    under-reports until then. Written only via analytics.add_usage_seconds.

    NOTE ON VERSION: the postgres head on master is v019 (credits). Siblings
    v020 (T5720 public-game-link) and v021 (T5730 claim-import) are in flight on
    unmerged branches, so this lands at v022 to stay strictly greater than the
    DB's current version — the runner silently skips any version <= current.
    """

    version = 22
    description = "Add user_usage_daily per-user per-day engaged-usage buckets (T5770)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_usage_daily (
                user_id TEXT NOT NULL,
                day DATE NOT NULL,
                seconds INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, day)
            )
        """)
