from ..base import BaseMigration


class V011DailyCountersTrackingGaps(BaseMigration):
    version = 11
    description = "Add sessions_started, invites_sent, shares_viewed, exports_started to daily_counters"

    def up(self, conn):
        cur = conn.cursor()
        for col in ["sessions_started", "invites_sent", "shares_viewed", "exports_started"]:
            cur.execute(f"ALTER TABLE daily_counters ADD COLUMN IF NOT EXISTS {col} INTEGER NOT NULL DEFAULT 0")
