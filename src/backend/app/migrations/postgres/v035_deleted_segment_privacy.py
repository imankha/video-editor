from ..base import BaseMigration


class V035DeletedSegmentPrivacy(BaseMigration):
    """T8660: remove live-activity fields from retained deleted-user segments.

    Revenue attribution is retained, while activity/session information is not
    needed by aggregate reports and must not survive account erasure.
    """

    version = 35
    description = "T8660: clear activity fields on retained deleted-user segments"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments ALTER COLUMN last_active_at DROP NOT NULL")
        cur.execute("ALTER TABLE user_segments ALTER COLUMN total_usage_seconds DROP NOT NULL")
        cur.execute("""
            UPDATE user_segments s
               SET last_active_at = NULL, total_usage_seconds = NULL
             WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = s.user_id)
        """)
