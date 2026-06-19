from ..base import BaseMigration


class V017UserDefaultSport(BaseMigration):
    version = 17
    description = "Add users.default_sport mirror for sport inheritance through invite (T2915)"

    def up(self, conn):
        conn.cursor().execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS default_sport TEXT"
        )
