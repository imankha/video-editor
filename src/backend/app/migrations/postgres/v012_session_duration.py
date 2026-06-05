from ..base import BaseMigration


class V012SessionDuration(BaseMigration):
    version = 12
    description = "Add total_usage_seconds and current_session_start to user_segments for session duration tracking"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS total_usage_seconds INTEGER NOT NULL DEFAULT 0")
        cur.execute("ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS current_session_start TIMESTAMPTZ")
