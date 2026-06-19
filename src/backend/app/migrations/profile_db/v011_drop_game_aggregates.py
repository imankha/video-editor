"""
v011: Drop the denormalized aggregate columns from games.

clip_count / brilliant_count / good_count / interesting_count / mistake_count /
blunder_count / aggregate_score were a cached copy of values derived from
raw_clips. They had to be re-maintained at every write site and drifted (a
shared game showed "0 clips" because materialization never refreshed them).

The list/detail endpoints now derive these live from raw_clips, so the stored
columns are dead. Drop them -- the source of truth is raw_clips alone.

Idempotent: only drops columns that still exist (safe to re-run). Requires
SQLite >= 3.35 for ALTER TABLE DROP COLUMN (deploys run 3.40+).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V011DropGameAggregates(BaseMigration):
    version = 11
    description = "Drop dead denormalized aggregate columns from games (derived on read now)"

    _COLUMNS = [
        "clip_count", "brilliant_count", "good_count", "interesting_count",
        "mistake_count", "blunder_count", "aggregate_score",
    ]

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='games'"
        ).fetchone()
        if not has_table:
            return

        existing = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
        for col in self._COLUMNS:
            if col in existing:
                conn.execute(f"ALTER TABLE games DROP COLUMN {col}")
                logger.info(f"[v011] dropped games.{col}")
