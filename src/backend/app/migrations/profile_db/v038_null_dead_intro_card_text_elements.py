"""
v038: NULL the now-dead `intro_cards.text_elements` column (T6640).

Verified 2026-08-06 by the supervisor: origin/master profile_db head is v036; the
T5215 worker's branch (in flight) takes v037 (v037_intro_min_duration.py). This
branch is the only one adding v038. The runner applies ONLY versions GREATER than
the DB's current user_version, so a duplicate number is silently skipped and this
cleanup would never run (the T6340 class of bug) -- re-verify at implementation
time on any further rebase, not just here.

WHY: epic decision 12 (2026-08-06, T6640) makes the TEMPLATE own every card text
element's font/colour/size/weight/shadow/stroke/spacing -- the user no longer
styles a slot. `player_intro._select_elements` and its frontend mirror
(`introCardPreviewElements.buildPreviewElements`) both stopped reading
`text_elements` entirely (styling now resolves from a fixed ROLE via
`intro_card_geometry.ROLE_FOR_SLOT`, never from anything stored on the card). The
per-slot styling editor was also removed from the card rail (`IntroCardRail.jsx`),
so nothing writes this column going forward either.

This migration makes the STORED data match that decision (CLAUDE.md: "migrations
MAKE it correct; one canonical location per datum; no dead data a future reader
mistakes for meaningful") -- the exact precedent T6620 set for `title_text` in
v036. It NULLs every populated `text_elements` blob so nothing looks like a live
styling override. It does NOT drop the column (a SQLite column drop is a full
table rebuild; the column is harmless once empty + commented DEAD in
database.py). Behaviour is UNCHANGED by this step -- the code already ignores
`text_elements` regardless of its value -- so this is a pure cleanup, not a
functional change.

Idempotent: `SET text_elements = NULL WHERE text_elements IS NOT NULL` re-runs to
a no-op. Column-guarded so a below-head DB (no intro_cards table yet) is a safe
skip.

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory
(not ``sqlite3.Row``), so `PRAGMA table_info` rows are indexed POSITIONALLY
(``row[1]`` == column name; the v017 landmine).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V038NullDeadIntroCardTextElements(BaseMigration):
    version = 38
    description = "NULL the dead intro_cards.text_elements (T6640: template owns typography)"

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
        if "text_elements" not in cols:
            return
        cur = conn.execute("UPDATE intro_cards SET text_elements = NULL WHERE text_elements IS NOT NULL")
        logger.info(f"[v038] nulled dead text_elements on {cur.rowcount} intro_card row(s)")
