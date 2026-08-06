"""
v036: NULL the now-dead `intro_cards.title_text` column (T6620).

Verified 2026-08-06: master profile_db head is v035 (v035_intro_card_subtitle.py);
this branch (feature/T6620-shadow-blur-inert-and-title-override) is the only one
adding v036. The runner applies ONLY versions GREATER than the DB's current
user_version, so a duplicate number is silently skipped and this cleanup would
never run (the T6340 class of bug) -- re-verify at implementation time, not just
here.

WHY: T6570 made the card title come from the profile's Full Name and removed the
per-card title text box; a pre-T6570 `title_text` was kept as a grandfathered
OVERRIDE. But removing the only UI that could clear it turned that override into
a trap -- a card created before T6570 (e.g. one still holding "New card 1")
ignored the profile's name forever with no escape hatch ("I added my player's
name but it won't pull into the card"). T6620 makes the profile ALWAYS win and
deletes every read of `title_text` (player_intro._select_elements,
introCardPreviewElements.resolveTitleText). The column is now dead data.

This migration makes the STORED data match that decision (CLAUDE.md: "migrations
MAKE it correct; one canonical location per datum; no dead data a future reader
mistakes for meaningful"). It NULLs every populated `title_text` so nothing looks
like a live override. It does NOT drop the column (a SQLite column drop is a full
table rebuild; the column is harmless once empty + commented DEAD). Behaviour is
UNCHANGED by this step -- the code already ignores `title_text` regardless of its
value -- so this is a pure cleanup, not a functional change.

Idempotent: `SET title_text = NULL WHERE title_text IS NOT NULL` re-runs to a
no-op. Column-guarded so a below-head DB (no intro_cards table / no column yet)
is a safe skip.

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory
(not ``sqlite3.Row``), so `PRAGMA table_info` rows are indexed POSITIONALLY
(``row[1]`` == column name; the v017 landmine).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V036NullDeadIntroCardTitleText(BaseMigration):
    version = 36
    description = "NULL the dead intro_cards.title_text (T6620: profile Full Name always wins)"

    def up(self, conn) -> None:
        has_intro_cards = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='intro_cards'"
        ).fetchone()
        if not has_intro_cards:
            # Below-head DB with no card table yet -- nothing to clean.
            return
        # PRAGMA table_info rows are TUPLES under the runner's row factory ->
        # index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(intro_cards)").fetchall()}
        if "title_text" not in cols:
            return
        cur = conn.execute("UPDATE intro_cards SET title_text = NULL WHERE title_text IS NOT NULL")
        logger.info(f"[v036] nulled dead title_text on {cur.rowcount} intro_card row(s)")
