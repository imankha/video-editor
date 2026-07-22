"""
v028: Add export_jobs.stage + export_jobs.output_key — durable per-stage
checkpoints for the unified, resumable export finalize (T5630).

The multi-clip finalizer now records WHICH stage an export reached
(queued -> rendering -> rendered -> detecting -> persisting -> complete | error)
and persists the render's R2 key (`output_key`) as soon as the video exists,
so recovery can complete ONLY the missing stages instead of writing a lossy
minimal row (the Brilliant-Control incident). Both columns are additive and
nullable; nothing reads them until the finalize path is wired.

BACKFILL (set-based, so the v017 tuple-row-factory landmine does not apply --
no per-row Python read; the only row read is the PRAGMA column check, indexed
positionally r[1]):
  - status='complete'                -> stage='complete'
  - status IN ('pending','processing') -> infer from what was persisted:
        output_video_id set  => 'persisting'  (a working_video row already exists)
        else modal_call_id set => 'rendering'  (dispatched, render maybe in flight)
        else                    => 'queued'
  - status='error'                   -> left at the column default ('queued');
                                        error is tracked by `status`, not `stage`.
  - output_key stays NULL for every existing row -> recovery falls back to
    modal_result.output_key for pre-v028 jobs.

Runs MANUALLY post-deploy (POST /api/admin/migrate) — versioned migrations do
NOT auto-run. Idempotent: re-running only re-applies the ALTERs when absent and
re-derives the same backfill.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V028ExportJobStages(BaseMigration):
    version = 28
    description = "Add export_jobs.stage + output_key with stage backfill (T5630)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='export_jobs'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(export_jobs)").fetchall()}

        if "stage" not in cols:
            conn.execute("ALTER TABLE export_jobs ADD COLUMN stage TEXT DEFAULT 'queued'")
            logger.info("[v028] added export_jobs.stage")
        if "output_key" not in cols:
            conn.execute("ALTER TABLE export_jobs ADD COLUMN output_key TEXT")
            logger.info("[v028] added export_jobs.output_key")

        # Set-based backfill (no per-row Python read).
        conn.execute("UPDATE export_jobs SET stage = 'complete' WHERE status = 'complete'")
        conn.execute(
            """
            UPDATE export_jobs
            SET stage = CASE
                WHEN output_video_id IS NOT NULL THEN 'persisting'
                WHEN modal_call_id IS NOT NULL THEN 'rendering'
                ELSE 'queued'
            END
            WHERE status IN ('pending', 'processing')
            """
        )
        logger.info("[v028] backfilled export_jobs.stage from status/output_video_id/modal_call_id")
