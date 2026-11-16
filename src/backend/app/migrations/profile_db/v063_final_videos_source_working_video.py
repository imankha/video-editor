"""
T16520 -- v063 profile_db migration: add final_videos.source_working_video_id (INTEGER, nullable).

The server finish (services/finish_highlight.py) links the final video it makes to the
sharpened working video it was made from, so a retried finish finds the row it already
wrote instead of making a second one. The spotlight render stamps the same link. NULL on
pre-existing rows means "not linked": a later finish of that working video makes its own
final video, which is the pre-T16520 behaviour. No backfill.

Idempotent: the ALTER is guarded by PRAGMA table_info.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V063FinalVideosSourceWorkingVideo(BaseMigration):
    version = 63
    description = "Add final_videos.source_working_video_id: server finish idempotency link (T16520)"

    def up(self, conn) -> None:
        # PRAGMA table_info rows are TUPLES under the runner's row factory (v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
        if not cols:
            return
        if "source_working_video_id" not in cols:
            conn.execute("ALTER TABLE final_videos ADD COLUMN source_working_video_id INTEGER")
            logger.info("[v063] added final_videos.source_working_video_id")
