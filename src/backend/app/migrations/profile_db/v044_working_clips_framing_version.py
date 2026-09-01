"""
v044: Add working_clips.framing_version -- mutation counter for framing
actions' two-writer 409 conflict detection (T4330).

Framing (crop/segment/trim/rotation gesture actions) had NO version counter
until this task -- `working_clips.version` is the EXPORT version-row counter
(one row per exported version), not a mutation counter, so it cannot be
reused without corrupting export versioning. This is a NEW, purely additive
column, the `overlay_version` analogue for `working_clips`.

DEFAULT 0 is correct for every existing row -- no backfill needed. The first
framing action on an old row omits `expected_version` (actionClient's "omit
until first success" rule -- design doc docs/plans/tasks/T4330-design.md
section 2.5) and lands regardless; version threading then starts from the
first echoed `new_version`.

Modeled directly on v029_working_clips_rotation.py (same guarded
PRAGMA table_info ALTER; migration `up(conn)` rows are TUPLES under the
migration runner's row factory -- index positionally, never by name).

Idempotent: only adds the column when missing. Applies automatically at the
per-user JIT seam on next access (T5083/T5085, hardened by T8190) --
profile_db migrations no longer require a manual admin trigger (T5087
deleted the old bulk-sweep endpoint).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V044WorkingClipsFramingVersion(BaseMigration):
    version = 44
    description = "Add working_clips.framing_version for framing action conflict detection (T4330)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_clips'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()}
        if "framing_version" not in cols:
            conn.execute(
                "ALTER TABLE working_clips ADD COLUMN framing_version INTEGER NOT NULL DEFAULT 0"
            )
            logger.info("[v044] added working_clips.framing_version")
