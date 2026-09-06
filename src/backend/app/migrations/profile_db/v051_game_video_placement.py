"""
v051 (T8870): game_videos gains `recorded_at TEXT NULL` + `offset_seconds REAL NULL`.

Overlap model (EPIC decision 7): every video of a game carries a position on the
game's real-time axis.
  - recorded_at: the video's embedded recording clock time (ISO-8601 UTC).
    Evidence only -- never recomputed after insert, never user-edited. NOT
    backfilled here: there is no historical source for a pre-existing row's
    recording time, and a NULL recorded_at is a legitimate "no timestamp
    evidence" state (the frontend/timeline already tolerate it).
  - offset_seconds: canonical placement (time zero = offset 0 = the earliest
    video). Written at insert by compute_video_offsets; afterwards ONLY the
    Fix-timing gesture (T8900) may update it.

BACKFILL (offset_seconds only): every existing row is set to the PREFIX-SUM of
the durations of the lower-sequence videos in its own game -- exactly the virtual
position today's concatenation math (compute_unified_clip_start's
SUM(duration) WHERE sequence < ...) gives it. This makes a migrated game render
BYTE-IDENTICALLY to before: compute_unified_clip_start's new offset branch reads
offset_seconds == the prefix sum, so single-clip in-match starts are unchanged
(test_t8870_overlap_schema.py asserts old-math == new-math for sequence-only
games). "Migrations MAKE the data correct" -- no runtime self-heal.

Modeled on v050_pending_uploads_kind.py / v049 (guarded PRAGMA table_info ALTER;
migration up(conn) rows are TUPLES under the runner's row factory -- index
positionally, row[1] == column name; v017 landmine). Idempotent: columns added
only when missing; the backfill only touches rows whose offset_seconds IS still
NULL, so a re-run never clobbers an insert-time-computed (possibly negative or
recorded_at-derived) offset. Applies automatically at the per-user JIT seam on
next access (T5083/T5085, hardened by T8190). PRAGMA user_version is bumped by
the runner, not here.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V051GameVideoPlacement(BaseMigration):
    version = 51
    description = "Add game_videos.recorded_at + offset_seconds; backfill offsets by prefix-sum (T8870)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_videos'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        if "recorded_at" not in cols:
            conn.execute("ALTER TABLE game_videos ADD COLUMN recorded_at TEXT")
            logger.info("[v051] added game_videos.recorded_at")
        if "offset_seconds" not in cols:
            conn.execute("ALTER TABLE game_videos ADD COLUMN offset_seconds REAL")
            logger.info("[v051] added game_videos.offset_seconds")

        # Backfill offset_seconds = prefix-sum of lower-sequence durations within
        # the same game (COALESCE so a NULL duration contributes 0, matching
        # compute_unified_clip_start's COALESCE(SUM(duration), 0)). Only rows still
        # NULL -- never overwrites an insert-time-computed offset.
        cur = conn.execute(
            """
            UPDATE game_videos
            SET offset_seconds = (
                SELECT COALESCE(SUM(g2.duration), 0)
                FROM game_videos g2
                WHERE g2.game_id = game_videos.game_id
                  AND g2.sequence < game_videos.sequence
            )
            WHERE offset_seconds IS NULL
            """
        )
        logger.info(f"[v051] backfilled offset_seconds for {cur.rowcount} game_videos rows")
