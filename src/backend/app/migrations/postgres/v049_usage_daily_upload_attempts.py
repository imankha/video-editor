"""
v049 (T16550): `user_usage_daily.game_uploads_attempted` -- today's upload starts
per user, so the pulse card can divide today's successes by today's ATTEMPTS. An
abandoned upload ends with neither outcome; successes + failures never saw it.

No backfill and no default on the ADD: every row written before this keeps NULL,
which reads as "attempts not recorded that day" and makes that day's pulse rate
empty instead of successes over a partial count. The default is set AFTER the
ADD so only rows created from here on start at 0. `_SCHEMA_DDL` matches (nullable,
DEFAULT 0). Code omits the column until this has run
(`analytics.usage_daily_has_upload_attempts`).
"""

from ..base import BaseMigration


class V049UsageDailyUploadAttempts(BaseMigration):
    version = 49
    description = "Add user_usage_daily.game_uploads_attempted (T16550)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_usage_daily ADD COLUMN IF NOT EXISTS game_uploads_attempted INTEGER")
        cur.execute("ALTER TABLE user_usage_daily ALTER COLUMN game_uploads_attempted SET DEFAULT 0")
