"""
v030: Add games.source_profile_id + games.source_game_id -- game REFERENCE columns
(T5800, cross-profile game attribution epic).

A game whose source_profile_id IS NOT NULL is a metadata-only REFERENCE to a game
owned by a SIBLING profile of the same user (the reel-move flow, T5810, materializes
one so a moved reel keeps its by-game grouping in the target profile's Gallery).
`source_game_id` is the owning game's id inside the owning profile's DB. Referenceness
is DERIVED from `source_profile_id IS NOT NULL` -- there is deliberately NO is_reference
boolean (no-redundant-state rule, EPIC decision 3).

Both columns are nullable and default NULL, so EVERY existing (real) game keeps NULL
source columns -- a pure additive migration, no backfill needed.

Sequenced after v029 (working_clips.rotation); the two land in order. Applies
automatically at the per-user JIT seam on next access (T5083/T5085, hardened
by T8190) -- profile_db migrations no longer require a manual admin trigger
(T5087 deleted the old bulk-sweep endpoint).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V030GamesSourceReference(BaseMigration):
    version = 30
    description = "Add games.source_profile_id + source_game_id for cross-profile references (T5800)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='games'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are TUPLES under the migration runner's row factory
        # -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
        if "source_profile_id" not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN source_profile_id TEXT DEFAULT NULL")
            logger.info("[v030] added games.source_profile_id")
        if "source_game_id" not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN source_game_id INTEGER DEFAULT NULL")
            logger.info("[v030] added games.source_game_id")
