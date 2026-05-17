from ..base import BaseMigration


class V003AnnotationPlaybackShareType(BaseMigration):
    version = 3
    description = "Add annotation_playback to shares.share_type CHECK constraint"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_share_type_check")
        cur.execute("""
            ALTER TABLE shares ADD CONSTRAINT shares_share_type_check
            CHECK (share_type IN ('video', 'game', 'annotation_playback'))
        """)
