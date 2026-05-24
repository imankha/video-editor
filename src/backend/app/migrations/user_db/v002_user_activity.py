from ..base import BaseMigration


class V002UserActivity(BaseMigration):
    version = 2
    description = "Add user_activity and user_activity_events tables"

    def up(self, conn) -> None:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_activity (
                user_id TEXT PRIMARY KEY,
                session_count INTEGER NOT NULL DEFAULT 0,
                pwa_session_count INTEGER NOT NULL DEFAULT 0,
                last_active_at TEXT,
                last_export_at TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_activity_events (
                event TEXT PRIMARY KEY,
                count INTEGER NOT NULL DEFAULT 0,
                first_at TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
