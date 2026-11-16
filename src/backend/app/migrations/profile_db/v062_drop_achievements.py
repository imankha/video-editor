"""v062: drop the quest `achievements` table (T11185).

The quest system was deleted; `achievements` held its non-derivable step
completions (e.g. opened_framing_editor) and nothing reads or writes it now.
Idempotent (DROP TABLE IF EXISTS); fresh DBs never create it. version = 62.
"""

from ..base import BaseMigration


class V062DropAchievements(BaseMigration):
    version = 62
    description = "T11185: drop the quest achievements table"

    def up(self, conn) -> None:
        conn.execute("DROP TABLE IF EXISTS achievements")
