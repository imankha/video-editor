from ..base import BaseMigration


class V020GameLinkShareType(BaseMigration):
    version = 20
    description = "Add 'game_link' to shares.share_type CHECK + share_games.game_date snapshot (T5720)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_share_type_check")
        cur.execute("""
            ALTER TABLE shares ADD CONSTRAINT shares_share_type_check
            CHECK (share_type IN ('video', 'game', 'annotation_playback', 'collection', 'game_link'))
        """)
        cur.execute("ALTER TABLE share_games ADD COLUMN IF NOT EXISTS game_date TEXT")
