from ..base import BaseMigration


class V014PlatformTracking(BaseMigration):
    version = 14
    description = "Add platform column to user_actions for mobile/desktop/pwa tracking"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_actions ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'unknown'")
        cur.execute("ALTER TABLE user_actions DROP CONSTRAINT IF EXISTS user_actions_pkey")
        cur.execute("ALTER TABLE user_actions ADD PRIMARY KEY (user_id, action, platform)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_actions_platform ON user_actions(platform)")
