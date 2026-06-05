from ..base import BaseMigration


class V004SessionDuration(BaseMigration):
    version = 4
    description = "Add total_usage_seconds to user_activity for session duration tracking"

    def up(self, conn) -> None:
        conn.execute("ALTER TABLE user_activity ADD COLUMN total_usage_seconds INTEGER NOT NULL DEFAULT 0")
