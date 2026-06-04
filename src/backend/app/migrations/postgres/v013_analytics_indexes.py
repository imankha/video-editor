from ..base import BaseMigration


class V013AnalyticsIndexes(BaseMigration):
    version = 13
    description = "Add indexes for admin dashboard query performance"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_segments_last_active "
            "ON user_segments (last_active_at DESC NULLS LAST)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_actions_action_user "
            "ON user_actions (action, user_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_segments_acquired_origin "
            "ON user_segments (acquired_at, origin)"
        )
