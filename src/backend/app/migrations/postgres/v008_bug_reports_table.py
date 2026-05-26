from ..base import BaseMigration


class V008BugReportsTable(BaseMigration):
    version = 8
    description = "Create bug_reports table for structured bug tracking"

    def up(self, conn):
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS bug_reports (
                id SERIAL PRIMARY KEY,
                reporter_email TEXT,
                description TEXT,
                page_url TEXT,
                user_agent TEXT,
                build TEXT,
                editor_context JSONB,
                actions JSONB,
                console_logs JSONB,
                screenshot_r2_key TEXT,
                logs_r2_key TEXT,
                status TEXT NOT NULL DEFAULT 'new',
                duplicate_of INTEGER REFERENCES bug_reports(id),
                admin_notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                resolved_at TIMESTAMPTZ
            )
        """)

        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_bug_reports_status
            ON bug_reports(status)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_bug_reports_created
            ON bug_reports(created_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_bug_reports_duplicate
            ON bug_reports(duplicate_of)
        """)
