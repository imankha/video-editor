from ..base import BaseMigration


class V005UserMilestones(BaseMigration):
    version = 5
    description = "Create user_milestones table with cohort dimensions and backfill"

    def up(self, conn):
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_milestones (
                user_id TEXT PRIMARY KEY REFERENCES users(user_id),

                -- Cohort dimensions (set at signup, immutable)
                install_day DATE NOT NULL DEFAULT CURRENT_DATE,
                origin_type TEXT NOT NULL DEFAULT 'organic'
                    CHECK (origin_type IN ('organic', 'viral', 'ad_campaign')),
                origin_channel TEXT,
                signup_method TEXT CHECK (signup_method IN ('google', 'otp')),

                -- Journey milestones (NULL = not reached yet)
                signup_completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                first_game_created_at TIMESTAMPTZ,
                first_clip_created_at TIMESTAMPTZ,
                first_export_completed_at TIMESTAMPTZ,
                first_share_completed_at TIMESTAMPTZ,
                first_credit_purchase_at TIMESTAMPTZ,
                pwa_installed_at TIMESTAMPTZ,

                -- Lifetime counts
                game_created_count INTEGER NOT NULL DEFAULT 0,
                clip_created_count INTEGER NOT NULL DEFAULT 0,
                export_completed_count INTEGER NOT NULL DEFAULT 0,
                export_failed_count INTEGER NOT NULL DEFAULT 0,
                share_completed_count INTEGER NOT NULL DEFAULT 0,
                credit_purchase_count INTEGER NOT NULL DEFAULT 0,
                credits_consumed_count INTEGER NOT NULL DEFAULT 0,

                -- Activity
                session_count INTEGER NOT NULL DEFAULT 0,
                pwa_session_count INTEGER NOT NULL DEFAULT 0,
                last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                last_export_at TIMESTAMPTZ
            )
        """)

        cur.execute("CREATE INDEX IF NOT EXISTS idx_milestones_install_day ON user_milestones(install_day)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_milestones_origin ON user_milestones(origin_type)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_milestones_cohort ON user_milestones(install_day, origin_type)")

        # Backfill existing users with cohort dimensions from users + referrals
        cur.execute("""
            INSERT INTO user_milestones (user_id, install_day, origin_type, origin_channel, signup_method, signup_completed_at, last_active_at)
            SELECT
                u.user_id,
                u.created_at::date,
                CASE WHEN r.id IS NOT NULL THEN 'viral' ELSE 'organic' END,
                r.channel,
                CASE WHEN u.google_id IS NOT NULL THEN 'google' ELSE 'otp' END,
                u.created_at,
                COALESCE(u.last_seen_at, u.created_at)
            FROM users u
            LEFT JOIN referrals r ON u.user_id = r.referred_id
            ON CONFLICT (user_id) DO NOTHING
        """)

        # Backfill share milestones from existing shares table
        cur.execute("""
            UPDATE user_milestones m SET
                first_share_completed_at = s.first_share,
                share_completed_count = s.share_count
            FROM (
                SELECT sharer_user_id, MIN(shared_at) as first_share, COUNT(*) as share_count
                FROM shares WHERE revoked_at IS NULL
                GROUP BY sharer_user_id
            ) s
            WHERE m.user_id = s.sharer_user_id
        """)
