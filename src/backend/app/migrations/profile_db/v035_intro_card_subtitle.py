"""
v035: Add `intro_cards.subtitle_text` — the card's free-text SUBTITLE (T6570).

Verified 2026-08-05: master profile_db head is v034 (v034_intro_card_library.py);
`git ls-remote --heads origin` shows only `master` and the sibling branch
`feature/T6560-overlay-preview-image-and-copy`, and NEITHER claims v035 (both top
out at v034). The runner applies ONLY versions GREATER than the DB's current
user_version, so a duplicate number is silently skipped and this column would
never get created (the T6340 class of bug) -- re-verify at implementation time,
not just here.

Why a column (not a user_settings KV like the profile facts): a subtitle is a
property of THIS CARD (e.g. a tournament name), not of the athlete -- it varies
card to card, so it belongs on the `intro_cards` row. That is the exact opposite
of the Full Name (T6570), which IS a property of the athlete and therefore lives
once on the profile. Do NOT repurpose `title_text` for it: a column named
title_text holding a subtitle would mislead the next reader (and title_text is
DEAD as of T6620 — the title is the profile Full Name always; the column is no
longer read and is nulled by v036).

One purely additive, nullable column. NULL = no subtitle (the common case and
every legacy row) -> the slot is omitted-and-logged by the renderer, never drawn
blank. No backfill.

Deploy->migrate window: hot reads/writes of this column in
routers/intro_cards.py are COLUMN-GUARDED (PRAGMA table_info / row.keys()) so a
below-head profile DB serves cards without 500ing and a create/update that
mentions the subtitle degrades gracefully until this migration runs.

Idempotent: only adds the column when missing (mirrors v024/v032/v034).

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory
(not ``sqlite3.Row``), so `PRAGMA table_info` rows are indexed POSITIONALLY
(``row[1]`` == column name; the v017 landmine). This migration only introspects
schema, but the discipline is kept.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V035IntroCardSubtitle(BaseMigration):
    version = 35
    description = "Add intro_cards.subtitle_text (free-text card subtitle, T6570)"

    def up(self, conn) -> None:
        has_intro_cards = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='intro_cards'"
        ).fetchone()
        if not has_intro_cards:
            # Below-head DB with no card table yet (fresh DBs get subtitle_text
            # straight from ensure_database()); nothing to alter here.
            return
        # PRAGMA table_info rows are TUPLES under the runner's row factory ->
        # index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(intro_cards)").fetchall()}
        if "subtitle_text" not in cols:
            conn.execute("ALTER TABLE intro_cards ADD COLUMN subtitle_text TEXT")
            logger.info("[v035] added intro_cards.subtitle_text")
