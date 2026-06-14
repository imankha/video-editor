from ..base import BaseMigration


class V016CollectionShares(BaseMigration):
    version = 16
    description = "Add 'collection' share_type + collection_definition/collection_is_public to shares (T3620)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_share_type_check")
        cur.execute("""
            ALTER TABLE shares ADD CONSTRAINT shares_share_type_check
            CHECK (share_type IN ('video', 'game', 'annotation_playback', 'collection'))
        """)
        cur.execute("ALTER TABLE shares ADD COLUMN IF NOT EXISTS collection_definition JSONB")
        cur.execute(
            "ALTER TABLE shares ADD COLUMN IF NOT EXISTS collection_is_public BOOLEAN NOT NULL DEFAULT false"
        )
