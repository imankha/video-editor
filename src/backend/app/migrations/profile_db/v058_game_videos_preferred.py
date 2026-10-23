"""
T13280 -- v058 profile_db migration: add game_videos.preferred (INTEGER NOT NULL DEFAULT 0).

1 = within this video's span the user wants THIS source shown instead of the main
camera (an angle the user chose, or footage they dragged into overlap). 0 = the
main camera, today's behaviour. The user's words (2026-10-22): "once I switch the
source for a particular range, that value needs to stick ... it needs to persist
and be consistent with our sync strategy." It is written only by the placement
endpoint (PATCH /games/{id}/videos/{seq}/placement, body.preferred) on the pick /
drop gestures, through the same durable_sync path as offset_seconds, so it rides
the per-profile SQLite -> R2 CAS sync like every other game_videos column. Plain
ALTER, no inline REFERENCES (the codebase's ALTER-added-column convention, see
v056/v057). No backfill: every existing angle defaults to "main camera".

Idempotent: the ALTER is guarded by PRAGMA table_info. Applies automatically at
the per-user JIT seam on next access (T5083/T5085, hardened by T8190).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V058GameVideosPreferred(BaseMigration):
    version = 58
    description = "Add game_videos.preferred: show this source over the main camera within its span (T13280)"

    def up(self, conn) -> None:
        # PRAGMA table_info rows are TUPLES under the runner's row factory (v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        if not cols:
            return
        if "preferred" not in cols:
            conn.execute("ALTER TABLE game_videos ADD COLUMN preferred INTEGER NOT NULL DEFAULT 0")
            logger.info("[v058] added game_videos.preferred")
