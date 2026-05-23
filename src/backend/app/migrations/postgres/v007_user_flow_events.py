from ..base import BaseMigration


class V007UserFlowEvents(BaseMigration):
    version = 7
    description = "Create user_flow_events table and add daily_counters columns for new flow events"

    def up(self, conn):
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_flow_events (
                user_id TEXT NOT NULL REFERENCES users(user_id),
                event TEXT NOT NULL,
                first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                count INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (user_id, event)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_flow_events_event
            ON user_flow_events(event)
        """)

        # Backfill existing events from user_milestones wide columns
        backfill_events = [
            ("game_created",     "first_game_created_at",     "game_created_count"),
            ("clip_created",     "first_clip_created_at",     "clip_created_count"),
            ("export_completed", "first_export_completed_at", "export_completed_count"),
            ("export_failed",    None,                        "export_failed_count"),
            ("share_completed",  "first_share_completed_at",  "share_completed_count"),
            ("credit_purchased", "first_credit_purchase_at",  "credit_purchase_count"),
            ("credits_consumed", None,                        "credits_consumed_count"),
            ("pwa_installed",    "pwa_installed_at",           None),
        ]

        for event_name, first_col, count_col in backfill_events:
            if first_col and count_col:
                cur.execute(f"""
                    INSERT INTO user_flow_events (user_id, event, first_at, count)
                    SELECT user_id, %s, {first_col}, GREATEST({count_col}, 1)
                    FROM user_milestones
                    WHERE {first_col} IS NOT NULL
                    ON CONFLICT (user_id, event) DO NOTHING
                """, (event_name,))
            elif first_col:
                cur.execute(f"""
                    INSERT INTO user_flow_events (user_id, event, first_at, count)
                    SELECT user_id, %s, {first_col}, 1
                    FROM user_milestones
                    WHERE {first_col} IS NOT NULL
                    ON CONFLICT (user_id, event) DO NOTHING
                """, (event_name,))
            elif count_col:
                cur.execute(f"""
                    INSERT INTO user_flow_events (user_id, event, first_at, count)
                    SELECT user_id, %s, signup_completed_at, {count_col}
                    FROM user_milestones
                    WHERE {count_col} > 0
                    ON CONFLICT (user_id, event) DO NOTHING
                """, (event_name,))

        # Add new daily_counters columns for T3040 flow events
        new_columns = [
            "annotations_completed",
            "framing_exports",
            "overlay_exports",
            "video_downloads",
        ]
        for col in new_columns:
            cur.execute(f"""
                ALTER TABLE daily_counters
                ADD COLUMN IF NOT EXISTS {col} INTEGER NOT NULL DEFAULT 0
            """)
