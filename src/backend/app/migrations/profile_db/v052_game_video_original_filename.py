"""
v052 (T8892): game_videos gains `original_filename TEXT NULL`.

Angle naming (EPIC decision 8): an overlapping video ("angle") must show the
user's real filename ("sideline"), not the content-addressed R2 storage key
(`games/{blake3}.mp4`) it used to be derived from. The original filename is the
only honest source for that label, so we store it with the video.

  - original_filename: the user's filename WITH extension exactly as given
    (`sideline.mp4`). Evidence only -- never recomputed, never user-edited. The
    FRONTEND strips the path/extension for the displayed angle name (buildGameTimeline).
    NULL when the client never supplied one (legacy rows, resume-path uploads).

NO BACKFILL: the datum never existed for a pre-existing row -- there is no
historical source to recover it from, and a NULL is the correct, honest state
(buildGameTimeline shows the `Extra clip {n}` fallback for it, NOT a fabricated
name). "Migrations MAKE the data correct" does not license inventing data.

Modeled on v051_game_video_placement.py (guarded PRAGMA table_info ALTER;
migration up(conn) rows are TUPLES under the runner's row factory -- index
positionally, row[1] == column name; v017 landmine). Idempotent: the column is
added only when missing. Applies automatically at the per-user JIT seam on next
access (T5083/T5085, hardened by T8190). PRAGMA user_version is bumped by the
runner, not here.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V052GameVideoOriginalFilename(BaseMigration):
    version = 52
    description = "Add game_videos.original_filename (real angle names, T8892)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_videos'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        if "original_filename" not in cols:
            conn.execute("ALTER TABLE game_videos ADD COLUMN original_filename TEXT")
            logger.info("[v052] added game_videos.original_filename")
