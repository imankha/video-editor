"""
v046: Add working_videos.framing_snapshot and working_videos.highlight_carry_note
(T4350 -- re-export/re-transform highlights).

framing_snapshot (BLOB, nullable, no default) will hold a msgpack snapshot of
the per-clip framing that a working-video version was rendered with, so a
future re-export can transform carried highlights from the OLD framing to the
NEW framing instead of blindly carrying them verbatim.

highlight_carry_note (TEXT, DEFAULT NULL) is a short status code surfaced to
the user when highlights were dropped or reset during a carry
("dropped:{n}" / "multiclip_reset" / "legacy_uncertain"); NULL means nothing
to surface.

NO BACKFILL for framing_snapshot on existing rows -- this is intentional, not
an oversight. A backfilled snapshot would be a FABRICATED claim about what an
OLD render actually used: if a user changed framing after that render without
re-exporting, a synthesized "current framing" snapshot would make T4350's
byte-equal fast-path fire and carry highlights verbatim against the WRONG
framing -- a silent mis-timing bug. Leaving framing_snapshot NULL is the
honest state: the first post-migration re-export has no prior snapshot to
compare against, so it takes T4350's `legacy_uncertain` path (carry verbatim
+ a loud "verify your highlights" notice via highlight_carry_note) rather
than silently asserting an unverifiable claim. This follows CLAUDE.md's
"no silent fallbacks / correct data, not workarounds" rule. Production carry
logic that reads/writes these columns is owned by a separate stream -- this
migration only adds the columns.

Modeled on v044_working_clips_framing_version.py (guarded PRAGMA table_info
ALTER, idempotent). PRAGMA table_info rows are TUPLES under the migration
runner's row factory -- index positionally (row[1] == column name).

Applies automatically at the per-user JIT seam on next access (T5083/T5085,
hardened by T8190) -- profile_db migrations no longer require a manual admin
trigger (T5087 deleted the old bulk-sweep endpoint).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V046WorkingVideoFramingSnapshot(BaseMigration):
    version = 46
    description = (
        "Add working_videos.framing_snapshot and highlight_carry_note for "
        "re-export/re-transform highlights (T4350)"
    )

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_videos'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(working_videos)").fetchall()}

        if "framing_snapshot" not in cols:
            # No default -- NULL on all existing rows. See module docstring:
            # backfilling this would fabricate a claim about an old render.
            conn.execute("ALTER TABLE working_videos ADD COLUMN framing_snapshot BLOB")
            logger.info("[v046] added working_videos.framing_snapshot")

        if "highlight_carry_note" not in cols:
            conn.execute(
                "ALTER TABLE working_videos ADD COLUMN highlight_carry_note TEXT DEFAULT NULL"
            )
            logger.info("[v046] added working_videos.highlight_carry_note")
