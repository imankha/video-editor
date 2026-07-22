"""
v029: Add working_clips.rotation -- per-clip horizon-straighten angle (T5640).

Framing gains a single per-clip rotation angle (DEGREES, positive = rotate
content counter-clockwise) applied to the video BEFORE the crop in every render
path, so tilted handheld/off-axis footage can be leveled. The crop keyframes
stay in the ROTATED frame space, so rotation=0 is byte-identical to today and NO
crop-keyframe migration is needed -- this is a pure additive column.

Sequenced after T5630's v028 (export_jobs.stage/output_key); the two land in
order (v028 then v029).

Idempotent: only adds the column when missing. Runs MANUALLY post-deploy
(POST /api/admin/migrate) -- versioned migrations do NOT auto-run.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V029WorkingClipsRotation(BaseMigration):
    version = 29
    description = "Add working_clips.rotation for horizon straighten (T5640)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_clips'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()}
        if "rotation" not in cols:
            conn.execute("ALTER TABLE working_clips ADD COLUMN rotation REAL DEFAULT 0")
            logger.info("[v029] added working_clips.rotation")
