"""
v015: Add games.last_playhead_position for exact playhead resume.

viewed_duration is a high-water mark (furthest point reached) that drives the
review-progress indicator on game cards, so it must never move backward. That
makes it the wrong value to resume the playhead to: a user who scrubs back and
leaves would jump forward to the furthest point on reopen.

This column stores the *exact* last playhead position (it may move backward),
used solely to restore the playhead when a game is reopened in Annotate. NULL
means "never recorded" -- callers fall back to the legacy viewed_duration resume.

Idempotent: only adds the column when missing.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V015AddLastPlayheadPosition(BaseMigration):
    version = 15
    description = "Add games.last_playhead_position for exact playhead resume"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='games'"
        ).fetchone()
        if not has_table:
            return

        cols = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
        if "last_playhead_position" not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN last_playhead_position REAL")
            logger.info("[v015] added games.last_playhead_position")
