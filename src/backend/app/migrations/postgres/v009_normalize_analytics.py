from ..base import BaseMigration


class V009NormalizeAnalytics(BaseMigration):
    version = 9
    description = "Replace user_milestones with user_segments, rename user_flow_events to user_actions"

    def up(self, conn):
        cur = conn.cursor()

        # 1. Create user_segments table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_segments (
                user_id TEXT PRIMARY KEY REFERENCES users(user_id),
                acquired_at DATE NOT NULL DEFAULT CURRENT_DATE,
                origin TEXT NOT NULL DEFAULT 'organic',
                referrer_id TEXT REFERENCES users(user_id),
                signup_method TEXT CHECK (signup_method IN ('google', 'otp')),
                total_spent_cents INTEGER NOT NULL DEFAULT 0,
                last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_segments_acquired ON user_segments(acquired_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_segments_origin ON user_segments(origin)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_segments_referrer ON user_segments(referrer_id)")

        # Check which tables exist (fresh deploy has user_actions from DDL; existing DB has user_flow_events)
        cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_milestones') AS exists")
        has_milestones = cur.fetchone()["exists"]
        cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_flow_events') AS exists")
        has_flow_events = cur.fetchone()["exists"]
        cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_actions') AS exists")
        has_actions = cur.fetchone()["exists"]

        # 2. Backfill user_segments from user_milestones (existing DB only)
        if has_milestones:
            cur.execute("""
                INSERT INTO user_segments (user_id, acquired_at, origin, referrer_id, signup_method, last_active_at)
                SELECT
                    m.user_id,
                    m.install_day,
                    CASE
                        WHEN m.origin_type = 'ad_campaign' THEN COALESCE(m.origin_channel, 'organic')
                        WHEN m.origin_type = 'viral' THEN 'organic'
                        ELSE 'organic'
                    END,
                    (SELECT r.referrer_id FROM referrals r WHERE r.referred_id = m.user_id LIMIT 1),
                    m.signup_method,
                    m.last_active_at
                FROM user_milestones m
                ON CONFLICT (user_id) DO NOTHING
            """)

            # 3. Viral origin inheritance
            for _ in range(10):
                cur.execute("""
                    UPDATE user_segments AS child
                    SET origin = parent.origin
                    FROM user_segments AS parent
                    WHERE child.referrer_id = parent.user_id
                      AND child.referrer_id IS NOT NULL
                      AND child.origin != parent.origin
                """)
                if cur.rowcount == 0:
                    break

        # 4. Handle user_flow_events -> user_actions rename
        if has_flow_events and not has_actions:
            # Existing DB: backfill session_started, then rename
            if has_milestones:
                cur.execute("""
                    INSERT INTO user_flow_events (user_id, event, count, first_at)
                    SELECT user_id, 'session_started', session_count, signup_completed_at
                    FROM user_milestones
                    WHERE session_count > 0
                    ON CONFLICT (user_id, event) DO NOTHING
                """)
            cur.execute("ALTER TABLE user_flow_events RENAME TO user_actions")
            cur.execute("ALTER TABLE user_actions RENAME COLUMN event TO action")
            cur.execute("DROP INDEX IF EXISTS idx_flow_events_event")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_actions_action ON user_actions(action)")
        elif has_flow_events and has_actions:
            # Fresh deploy: user_actions already exists from DDL, just drop the old table
            cur.execute("DROP TABLE IF EXISTS user_flow_events")
            cur.execute("DROP INDEX IF EXISTS idx_flow_events_event")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_actions_action ON user_actions(action)")

        # 5. Ensure every user has a segment row (INNER JOIN in admin depends on this)
        cur.execute("""
            INSERT INTO user_segments (user_id)
            SELECT u.user_id FROM users u
            WHERE NOT EXISTS (SELECT 1 FROM user_segments s WHERE s.user_id = u.user_id)
        """)

        # 6. Drop user_milestones
        if has_milestones:
            cur.execute("DROP TABLE IF EXISTS user_milestones")
