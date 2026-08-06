"""
v037: Add `user_settings.intro_min_duration_seconds` — the per-profile reel-length
floor below which the default intro card is not applied (T5215).

Verified 2026-08-06: master profile_db head is v036
(v036_null_dead_intro_card_title_text.py, T6620, merged); no unmerged sibling
branch claims v037. The runner applies ONLY versions GREATER than the DB's
current user_version, so a duplicate number is silently skipped and this column
would never get created (the T6340 class of bug) -- re-verify at implementation
time, not just here.

WHY: T5215's resolution helper (`app.services.intro_cards.resolve_intro_card_id`)
gates the "inherit the profile's default" path (`intro_card_id IS NULL`) on the
reel's duration -- a reel below this threshold resolves to no intro even when a
default exists (an EXPLICIT card id, or `0`, is never gated). The threshold must
be a real per-profile stored setting, not a constant, since the user edits it.

WHERE: a typed column on the existing `user_settings` SINGLETON row (`id=1`),
NOT the schemaless `collection_settings` key/value table and NOT the
user.sqlite `user_settings` KV (where parental consent lives) -- the threshold
is per-PROFILE data (epic decision 7, cards are per profile), and `user_settings`
here already exists on every profile DB (seeded by `ensure_database()`) with a
`settings_json` column that is currently unread by any consumer, so a typed
column disturbs nothing.

Default 20.0 (seconds), matching the acceptance criterion. `NOT NULL DEFAULT`
backfills the existing singleton row for free -- no separate data pass needed.

Idempotent: only adds the column when missing (mirrors v024/v025/v032).

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory
(not ``sqlite3.Row``), so `PRAGMA table_info` rows are indexed POSITIONALLY
(``row[1]`` for the column name) -- this migration reads no data rows at all,
only schema introspection, so the tuple-vs-Row distinction doesn't otherwise
bite here.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V037IntroMinDuration(BaseMigration):
    version = 37
    description = "Add user_settings.intro_min_duration_seconds (T5215 duration-gated default intro)"

    def up(self, conn) -> None:
        has_user_settings = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_settings'"
        ).fetchone()
        if not has_user_settings:
            return

        cols = {row[1] for row in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        if "intro_min_duration_seconds" not in cols:
            conn.execute(
                "ALTER TABLE user_settings ADD COLUMN "
                "intro_min_duration_seconds REAL NOT NULL DEFAULT 20.0"
            )
            logger.info("[v037] added user_settings.intro_min_duration_seconds")
