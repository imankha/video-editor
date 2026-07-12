"""
v024: Add final_videos.poster_filename for share-link preview images (T4890).

Stores the poster object's BASENAME ({final_video_filename}.jpg). The full
per-profile R2 key is final_videos/posters/{poster_filename}. NULL means "no
poster" (pre-existing reels until the admin backfill runs via
POST /api/admin/backfill-share-posters). This is a pure additive column --
data backfill is NOT performed here.

Idempotent: only adds the column when missing.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V024AddPosterFilename(BaseMigration):
    version = 24
    description = "Add final_videos.poster_filename for share-link preview images (T4890)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if not has_table:
            return

        cols = {row[1] for row in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
        if "poster_filename" not in cols:
            conn.execute("ALTER TABLE final_videos ADD COLUMN poster_filename TEXT")
            logger.info("[v024] added final_videos.poster_filename")
