"""
v027 (T8370): daily_counters gains `clips_uploaded INTEGER NOT NULL DEFAULT 0`.

T7860 reserved the `clip_uploaded` FLOW_EVENT name + funnel position but
deliberately left `daily_col=None` to avoid a dead column until the
direct-upload feature actually shipped. T8370 ships it (POST /api/clips/upload
records the `clip_uploaded` milestone per clip) and adds the column here.
`clip_created` (annotation-sourced) is untouched -- this is a distinct origin
dimension, not a replacement.

Additive, idempotent (IF NOT EXISTS), no backfill: no clip_uploaded events
exist before this column does, so a zero default is correct history.
"""

from ..base import BaseMigration


class V027DailyCountersClipsUploaded(BaseMigration):
    version = 27
    description = "Add daily_counters.clips_uploaded (T8370 clip_uploaded daily rollup)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            "ALTER TABLE daily_counters ADD COLUMN IF NOT EXISTS "
            "clips_uploaded INTEGER NOT NULL DEFAULT 0"
        )
