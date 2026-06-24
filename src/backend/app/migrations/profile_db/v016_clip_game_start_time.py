"""
v016 (T3920): final_videos.clip_game_start_time -- unified two-half in-match
start, frozen so Reel Draft cards show the clip's soccer-notation game time.

clip_start_time (v010) is FILE-RELATIVE: a clip 5 min into the 2nd half stores
300, with no first-half offset, so it reads as 6' instead of ~50'. This column
freezes the unified value = clip_start_time + sum(durations of game-video halves
before the clip's half). game_videos rows + raw_clips both survive a reel's
project being archived, so the backfill resolves the offset for old reels.

Backfill gates on `clip_start_time IS NOT NULL AND clip_game_start_time IS NULL`:
only single-clip reels carry a clip_start_time (multi-clip stay NULL -> no card
mark), and the gate makes re-runs idempotent. Rows whose source clip / prior-half
duration can't be resolved fall back to the file-relative start (never invented);
the summary log surfaces how many got a real 2nd-half offset.
"""

import logging
import sqlite3

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V016ClipGameStartTime(BaseMigration):
    version = 16
    description = "Add final_videos.clip_game_start_time (unified two-half in-match start) + backfill"

    def up(self, conn) -> None:
        conn.row_factory = sqlite3.Row

        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if not has_table:
            return

        cols = {row[1] for row in
                conn.execute("PRAGMA table_info(final_videos)").fetchall()}
        if "clip_game_start_time" not in cols:
            conn.execute(
                "ALTER TABLE final_videos ADD COLUMN clip_game_start_time REAL")

        self._backfill(conn)

    def _backfill(self, conn) -> None:
        from app.services.collection_metadata import compute_unified_clip_start

        cursor = conn.cursor()
        rows = conn.execute(
            "SELECT id, source_clip_id, clip_start_time FROM final_videos "
            "WHERE clip_start_time IS NOT NULL AND clip_game_start_time IS NULL"
        ).fetchall()

        offset_applied = 0
        for row in rows:
            try:
                unified = compute_unified_clip_start(
                    cursor, row["source_clip_id"], row["clip_start_time"])
                conn.execute(
                    "UPDATE final_videos SET clip_game_start_time = ? WHERE id = ?",
                    (unified, row["id"]),
                )
                if unified is not None and unified > row["clip_start_time"]:
                    offset_applied += 1
            except Exception as e:
                logger.error(
                    f"[T3920/v016] final_video {row['id']} clip_game_start_time "
                    f"backfill failed: {type(e).__name__}: {e}"
                )

        logger.info(
            f"[T3920/v016] backfilled clip_game_start_time for {len(rows)} "
            f"single-clip reels ({offset_applied} got a 2nd-half offset)"
        )
