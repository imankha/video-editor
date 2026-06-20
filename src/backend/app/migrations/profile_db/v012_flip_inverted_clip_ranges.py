"""
v012: Flip inverted raw_clips ranges so start_time <= end_time.

The annotation UI let a user set a clip's start/end boundaries independently,
which could produce an inverted range (start_time > end_time). An inverted range
breaks ffmpeg extraction (`-ss start -to end` reads nothing), which failed the
whole game's auto-export recap and left the expired-game card with no Highlights
or Annotations buttons (bug 23p).

The write paths now normalize on save, but existing rows still need fixing. This
swaps start_time/end_time for every inverted row. Where boundaries_version exists
it is bumped too, so any clip framed from the (broken) inverted range is flagged
stale and re-derived.

Idempotent: after the swap no row satisfies start_time > end_time, so a re-run
matches nothing.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V012FlipInvertedClipRanges(BaseMigration):
    version = 12
    description = "Flip inverted raw_clips ranges so start_time <= end_time"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_clips'"
        ).fetchone()
        if not has_table:
            return

        cur = conn.cursor()
        cols = {row[1] for row in cur.execute("PRAGMA table_info(raw_clips)").fetchall()}
        bump = ", boundaries_version = COALESCE(boundaries_version, 0) + 1" if "boundaries_version" in cols else ""

        # In SQL UPDATE every RHS is evaluated against the original row, so this
        # is a true swap (not start := end := end).
        cur.execute(
            f"""
            UPDATE raw_clips
            SET start_time = end_time,
                end_time = start_time{bump}
            WHERE start_time IS NOT NULL AND end_time IS NOT NULL
              AND start_time > end_time
            """
        )

        if cur.rowcount:
            logger.info(f"[v012] flipped {cur.rowcount} inverted clip ranges")
