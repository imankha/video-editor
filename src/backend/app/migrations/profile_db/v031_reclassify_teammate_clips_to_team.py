"""
v031: Reclassify teammate-tagged My-Athlete clips onto the Team layer (T5725).

Numbered v031, NOT v030: the sibling T5800 branch (cross-profile game attribution,
ahead of T5725 in the merge queue) already owns profile_db v030
(v030_games_source_reference.py). Two v030 files would collide on merge, and the
runner only applies versions GREATER than the DB's current user_version, so one
would be silently skipped on every existing DB. T5800 merges first, so a live DB
runs v030 then this v031 in order; a 29->31 gap on this branch in isolation is
harmless (the merge target carries v030).

Teammate tagging and the layer model contradicted each other: a clip could be on
the My Athlete layer (`my_athlete = 1`, or legacy `NULL`) yet carry teammate tags
(`raw_clips.tagged_teammates` and/or a `clip_teammates` join row), and the
per-player share selector joins on `clip_teammates` with NO layer predicate --
so a teammate tag on a My Athlete clip leaked that clip into another family's
share.

The product resolution (user, 2026-08-01): teammates can ONLY be tagged on Team
clips. The Annotate UI now hides the Teammates control on My Athlete clips, so no
NEW contradictory row can form. This migration heals EXISTING rows by MOVING each
teammate-tagged My-Athlete clip to the Team layer (`my_athlete = 0`).

Tags are PRESERVED -- the clip is reclassified, not stripped (the user's explicit
choice over clearing). We touch ONLY `my_athlete`; `tagged_teammates` and the
`clip_teammates` join rows are left untouched.

Accepted consequence (documented, no compensating logic): moved clips leave the
My Athlete layer and therefore leave reels / rankings / collections eligibility
(`exclude_teammate_reels_clause` keeps those on `my_athlete = 1`). Already-published
reels are unaffected.

Legacy-NULL rule: a NULL `my_athlete` means My Athlete, so it is a move candidate.

Idempotent: after the move, healed rows have `my_athlete = 0` and no longer match
the `my_athlete = 1 OR my_athlete IS NULL` candidate filter, so a re-run matches
nothing.

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory
(not ``sqlite3.Row``), so every row is indexed POSITIONALLY (``row[0]``), never by
column name -- string-indexing crashed the v017 backfill in prod.
"""

import logging

from app.utils.encoding import decode_data

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V031ReclassifyTeammateClipsToTeam(BaseMigration):
    version = 31
    description = "Move teammate-tagged My-Athlete clips to the Team layer (tags preserved)"

    def up(self, conn) -> None:
        has_raw_clips = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_clips'"
        ).fetchone()
        if not has_raw_clips:
            return

        cur = conn.cursor()
        cols = {r[1] for r in cur.execute("PRAGMA table_info(raw_clips)").fetchall()}
        # Base schema (and every prod DB) has both columns; guard defends only the
        # ancient below-baseline case and keeps the migration crash-free there.
        if "my_athlete" not in cols or "tagged_teammates" not in cols:
            return

        # Candidate clips = currently on the My Athlete layer (1 OR legacy NULL).
        # Decode each tag blob in Python -- an EMPTY list encodes to a non-NULL
        # blob, so "has teammates" cannot be tested in SQL alone. TUPLE row
        # factory: row[0] = id, row[1] = tagged_teammates blob (positional only).
        to_move: set[int] = set()
        cur.execute(
            "SELECT id, tagged_teammates FROM raw_clips "
            "WHERE my_athlete = 1 OR my_athlete IS NULL"
        )
        for row in cur.fetchall():
            teammates = decode_data(row[1])  # None / [] -> falsy
            if teammates:
                to_move.add(row[0])

        # Belt-and-suspenders: also catch a candidate clip whose tag blob is
        # empty/desynced but that still carries a clip_teammates join row (the
        # two can drift). Same layer filter; positional read.
        has_join = cur.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='clip_teammates'"
        ).fetchone()
        if has_join:
            cur.execute(
                "SELECT DISTINCT ct.clip_id "
                "FROM clip_teammates ct "
                "JOIN raw_clips rc ON rc.id = ct.clip_id "
                "WHERE rc.my_athlete = 1 OR rc.my_athlete IS NULL"
            )
            for row in cur.fetchall():
                to_move.add(row[0])

        if not to_move:
            logger.info("[v031] no teammate-tagged My-Athlete clips to reclassify")
            return

        placeholders = ",".join("?" * len(to_move))
        cur.execute(
            f"UPDATE raw_clips SET my_athlete = 0 WHERE id IN ({placeholders})",
            tuple(to_move),
        )
        logger.info(
            f"[v031] reclassified {cur.rowcount} teammate-tagged clip(s) "
            f"from My Athlete to Team (tags preserved)"
        )
