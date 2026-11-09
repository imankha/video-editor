"""v047 (T14980): user_resume_points -- one row per user naming the page/object
they were last on, written on navigation gestures and the exit beacon, read
once on /api/auth/me. Postgres (not user.sqlite): every per-user SQLite write
triggers an R2 sync upload, and this would be the most frequent write in the
app. Cascades on user deletion; no backfill needed (a user with no row simply
never had a resume point).
"""

from ..base import BaseMigration


class V047UserResumePoints(BaseMigration):
    version = 47
    description = "Add user_resume_points table (T14980 resume where you left off)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS user_resume_points (
                user_id    TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
                point      JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
