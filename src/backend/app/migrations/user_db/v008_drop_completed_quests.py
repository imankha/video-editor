from ..base import BaseMigration


class V008DropCompletedQuests(BaseMigration):
    """T11185: the quest system was deleted, so drop its user.sqlite state.

    Drops the `completed_quests` table and deletes the `quest_panel_collapsed`
    user_settings row (the T8120 Help-panel collapse flag). Nothing reads either
    any more. Credits a user earned from quests live in Postgres
    `credit_transactions` (frozen `quest_reward` / `quest_upfront` rows) and are
    untouched.

    Idempotent: DROP TABLE IF EXISTS + a DELETE. A fresh DB never
    had the table (it left _USER_DB_SCHEMA in the same change).
    """

    version = 8
    description = "T11185: drop completed_quests and the quest panel setting"

    def up(self, conn) -> None:
        conn.execute("DROP TABLE IF EXISTS completed_quests")
        # The seam migrates a restored file before the schema script runs, so
        # an old copy may predate user_settings.
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_settings'"
        ).fetchone() is not None:
            conn.execute("DELETE FROM user_settings WHERE key = 'quest_panel_collapsed'")
