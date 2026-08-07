"""
v040: give every profile that owns intro cards exactly one default (T6640).

Verified 2026-08-07 at implementation time, across ALL live branches (the T6340
class of bug: the runner applies ONLY versions GREATER than the DB's current
user_version, so a duplicate number is silently skipped and this backfill would
never run). At that moment: master head v036; this branch v038; T5215's branch
v037; T6630's branch v039. v040 is the first free number.

WHY: T6640 made "exactly one default while cards exist" an invariant, but only
enforced it on the two paths that can change the set -- create (first card for a
profile becomes the default, `intro_cards.py` create) and delete (deleting the
default promotes another). Cards that already existed when that code shipped were
never touched, so a profile created before T6640 has cards with `is_default = 0`
across the board. The user hit exactly this: every card in their library offered
"Set as default" and none showed the Default badge, because the badge is DERIVED
from `is_default` and no row had it.

The UI is already correct (badge when default, promote button when not, never
both). The defect is in the DATA, so this is where it gets fixed -- per CLAUDE.md,
"migrations MAKE it correct", rather than teaching the reader to guess a default
at runtime (which would be a fixup the app then has to re-derive on every load).

WHICH card wins: the EARLIEST (created_at, then id). The user's words were "the
first card should just be the default", and the earliest row is the stable answer
-- it does not change as cards are added or renamed. Note this deliberately
differs from the DELETE path, which promotes the NEWEST remaining card; that is a
"closest thing to what you were just using" choice for an interactive gesture,
while this is a one-time repair of history where "the first one" is what the user
asked for.

Only profiles with cards but NO default are touched. A profile that already has a
default keeps it, and a profile with no cards stays defaultless (the invariant is
"exactly one default WHILE CARDS EXIST" -- zero cards means zero defaults).

Idempotent: after it runs, every card-owning profile has a default, so the guard
`WHERE NOT EXISTS (... is_default = 1)` makes a re-run a no-op. Table-guarded so a
below-head DB with no intro_cards table is a safe skip.

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory (not
``sqlite3.Row``), so rows are indexed POSITIONALLY (the v017 landmine).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V040BackfillIntroCardDefault(BaseMigration):
    version = 40
    description = "Backfill exactly one default intro card per card-owning profile (T6640)"

    def up(self, conn) -> None:
        has_intro_cards = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='intro_cards'"
        ).fetchone()
        if not has_intro_cards:
            # Below-head DB with no card table yet -- nothing to backfill.
            return

        # One profile DB == one profile's cards, so "does this profile have a
        # default" is a table-wide question here.
        already_default = conn.execute(
            "SELECT 1 FROM intro_cards WHERE is_default = 1 LIMIT 1"
        ).fetchone()
        if already_default:
            return

        # Earliest card wins -- "the first card should just be the default".
        # Rows are TUPLES under the runner's row factory -> index positionally.
        earliest = conn.execute(
            "SELECT id FROM intro_cards ORDER BY created_at ASC, id ASC LIMIT 1"
        ).fetchone()
        if earliest is None:
            # Cards table exists but is empty: no cards, so no default. Correct.
            return

        card_id = earliest[0]
        conn.execute("UPDATE intro_cards SET is_default = 1 WHERE id = ?", (card_id,))
        logger.info(f"[v040] promoted earliest intro card {card_id} to default")
