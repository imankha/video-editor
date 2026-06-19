from ..base import BaseMigration


class V018ShareSharerSport(BaseMigration):
    version = 18
    description = "Add shares.sharer_default_sport snapshot so share invites carry sport inheritance (T2915)"

    def up(self, conn):
        conn.cursor().execute(
            "ALTER TABLE shares ADD COLUMN IF NOT EXISTS sharer_default_sport TEXT"
        )
