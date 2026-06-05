from ..base import BaseMigration


class V003ActionLog(BaseMigration):
    version = 3
    description = "Add user_action_log table for per-action timeline"

    def up(self, conn) -> None:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_action_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                context TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_action_log_action ON user_action_log(action)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_action_log_created ON user_action_log(created_at)"
        )
