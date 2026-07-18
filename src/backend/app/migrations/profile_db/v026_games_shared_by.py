"""
v026: Add games.shared_by + backfill provenance for materialized shares (T5330).

Onboarding (quest_1) is a function of the user's OWN content only. A game
materialized from a teammate share must be invisible to the DB-derived quest
counts, which requires provenance on the copied game row (raw_clips already carry
shared_by). This migration:

1. Adds `games.shared_by TEXT DEFAULT NULL` (own games stay NULL; only shared
   games get a marker). Without it, `quests._check_all_steps`'
   `SELECT ... FROM games WHERE shared_by IS NULL` would raise `no such column`
   on every below-head profile (the T5110 landmine) -- so this is a required
   migration, not an optional backfill.

2. BACKFILLS shared_by for already-materialized shared games by deriving it, in
   this same profile SQLite (no Postgres), from the game's own shared clips: a
   materialized game's clips carry raw_clips.shared_by. Each still-NULL game that
   has >=1 shared clip adopts that clip's provenance. Own games (no shared clips)
   stay NULL -- correct, they must keep counting toward upload_game.

Residual (accepted, T5330 design): a legacy *game-only* share (materialized with
zero clips) has no in-profile signal, so it stays NULL and its recipient's
upload_game reads pre-checked. quest_1 as a whole is still correctly incomplete
(no shared clips to count either), so the NUF still surfaces. The "lost" sentinel
is a runtime materialization fallback (materialization.SHARED_PROVENANCE_LOST);
this migration only ever writes a value a shared clip already carries.

Row-factory note (migrations/__init__.py): up(conn) gets a TUPLE row factory --
the PRAGMA table_info read below indexes POSITIONALLY (row[1]); the backfill is a
pure-SQL correlated UPDATE with no Python-side row reads. Tested WITH data
(test_t5330_games_shared_by_migration.py), not just the empty case.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V026GamesSharedBy(BaseMigration):
    version = 26
    description = "Add games.shared_by + backfill share provenance from clips (T5330)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='games'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
        if "shared_by" not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN shared_by TEXT DEFAULT NULL")
            logger.info("[v026] added games.shared_by")

        # Backfill: a materialized game adopts the provenance of its shared clips.
        # Idempotent -- only touches still-NULL games that have a shared clip.
        conn.execute(
            """
            UPDATE games
               SET shared_by = (
                   SELECT rc.shared_by FROM raw_clips rc
                    WHERE rc.game_id = games.id AND rc.shared_by IS NOT NULL
                    ORDER BY rc.id LIMIT 1)
             WHERE shared_by IS NULL
               AND EXISTS (
                   SELECT 1 FROM raw_clips rc
                    WHERE rc.game_id = games.id AND rc.shared_by IS NOT NULL)
            """
        )
        logger.info("[v026] backfilled games.shared_by from shared clips")
