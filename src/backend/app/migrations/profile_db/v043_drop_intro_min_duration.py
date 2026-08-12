"""
v043: Drop `user_settings.intro_min_duration_seconds` (T6850) -- the dead
reel-length threshold added by v041 (T5215).

WHY: The column gated the "inherit the profile's default intro" path
(`app.services.intro_cards.resolve_intro_card_id`'s old `NULL -> default`
branch). T6680 removed that path entirely -- every intro is now explicitly
attached per reel/collection, so the threshold has gated nothing since. It
still occupied a NOT NULL column and round-tripped through a settings
GET/PATCH endpoint pair that T6850 also removes. Pure dead weight.

ORDERING: code stops reading the column FIRST (T6850's application-code
changes ship in the same deploy as this migration) -- the two GET/PATCH
endpoints, the service helpers, and the frontend store/UI are all removed
outright, not left column_exists-guarded. This migration then drops the
column. Because the reads are removed rather than merely guarded, there is
no post-deploy window where live code SELECTs the dropped column.

Idempotent / absent-column-safe: mirrors v041's `if col not in cols` ADD
guard in reverse (`if col in cols` before DROP) -- safe to re-apply on an
already-migrated DB (no-op) and safe on a FRESH DB that never had the column
at all (post-T6850 `database.py` DDL omits it entirely).

SQLite `ALTER TABLE ... DROP COLUMN` requires 3.35+ (container + prod both
run 3.46.1, confirmed at design time).

Row-factory note: same as v041 -- the migration runner hands `up(conn)` a
TUPLE row factory (not `sqlite3.Row`), so `PRAGMA table_info` rows are
indexed POSITIONALLY (`row[1]` for the column name).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V043DropIntroMinDuration(BaseMigration):
    version = 43
    description = "Drop dead user_settings.intro_min_duration_seconds (T6850; gate removed by T6680)"

    def up(self, conn) -> None:
        has_user_settings = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_settings'"
        ).fetchone()
        if not has_user_settings:
            return

        cols = {row[1] for row in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        if "intro_min_duration_seconds" in cols:
            conn.execute(
                "ALTER TABLE user_settings DROP COLUMN intro_min_duration_seconds"
            )
            logger.info("[v043] dropped user_settings.intro_min_duration_seconds")
