from ..base import BaseMigration


class V006BackfillCurrentMode(BaseMigration):
    version = 6
    description = "Backfill NULL current_mode to 'framing' on existing projects"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'"
        ).fetchone()
        if not has_table:
            return

        conn.execute(
            "UPDATE projects SET current_mode = 'framing' WHERE current_mode IS NULL"
        )
