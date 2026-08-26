from ..base import BaseMigration


class V024AttemptOutcomeCounters(BaseMigration):
    version = 24
    description = (
        "T7510: add attempt/outcome/failure daily_counters columns "
        "(game_uploads_succeeded/_failed, clips_attempted/_failed)"
    )

    def up(self, conn):
        cur = conn.cursor()
        for col in [
            "game_uploads_succeeded",
            "game_uploads_failed",
            "clips_attempted",
            "clips_failed",
        ]:
            cur.execute(
                f"ALTER TABLE daily_counters ADD COLUMN IF NOT EXISTS {col} INTEGER NOT NULL DEFAULT 0"
            )
