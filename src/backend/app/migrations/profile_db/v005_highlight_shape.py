from ..base import BaseMigration


class V005HighlightShape(BaseMigration):
    version = 5
    description = "Add highlight_shape column to working_videos"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_videos'"
        ).fetchone()
        if not has_table:
            return

        try:
            conn.execute("ALTER TABLE working_videos ADD COLUMN highlight_shape TEXT DEFAULT 'body'")
        except Exception:
            pass
