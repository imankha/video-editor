"""
T12920 -- v057 profile_db migration: add games.plays_only_at (TIMESTAMP NULL).

Set = the game is in the "keep only marked plays" state (T12920 epic); NULL =
normal. Nothing else is stored: "restorable" is derived (plays_only_at IS NOT
NULL AND the storage ref is still live) and the preservation state is the
existing games.auto_export_status. Plain ALTER, no inline REFERENCES -- the
codebase's ALTER-added-column convention (see v056). No backfill: every
existing game is "normal".

Idempotent: the ALTER is guarded by PRAGMA table_info. Applies automatically at
the per-user JIT seam on next access (T5083/T5085, hardened by T8190).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V057GamesPlaysOnly(BaseMigration):
    version = 57
    description = "Add games.plays_only_at for the keep-only-marked-plays state (T12920)"

    def up(self, conn) -> None:
        # PRAGMA table_info rows are TUPLES under the runner's row factory (v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
        if not cols:
            return
        if "plays_only_at" not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN plays_only_at TIMESTAMP")
            logger.info("[v057] added games.plays_only_at")
