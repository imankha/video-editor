from ..base import BaseMigration


class V028BugReportsClientId(BaseMigration):
    version = 28
    description = (
        "T9400: add bug_reports.client_report_id + unique index for idempotent "
        "report submission (dedup retries so an ambiguous failure files once)"
    )

    def up(self, conn):
        cur = conn.cursor()
        # Nullable so any legacy insert path without a client id still works.
        cur.execute(
            "ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS client_report_id TEXT"
        )
        # Full unique index: Postgres treats multiple NULLs as distinct, so
        # historical/anonymous rows (client_report_id IS NULL) never collide,
        # while a real client (which always sends a UUID) is deduped via
        # INSERT ... ON CONFLICT (client_report_id).
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_bug_reports_client_id "
            "ON bug_reports(client_report_id)"
        )
