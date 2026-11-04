"""
v042 (T15050): upload observability.

- `upload_failures.flow_id`: the client's per-upload correlation id, so a failure
  row can be tied to the rest of its flow in app.log.
- `user_usage_daily.game_uploads_succeeded/failed`: the same outcomes as
  `daily_counters`, at user grain, so the pulse card can say how many PEOPLE a
  failure spike came from. An exception to the analytics epic's "No new Postgres
  data" directive, approved by the owner 2026-11-04: nothing else holds per-user
  per-day upload outcomes, and these are aggregates on an existing row, not events.

Additive and idempotent, no backfill: successes cannot be reconstructed, and
backfilling failures alone would invent a collapse. `_SCHEMA_DDL` has all three in
its CREATE TABLEs. Code omits them until this has run
(`upload_failures._has_flow_id_column`, `analytics.usage_daily_has_upload_outcomes`).
"""

from ..base import BaseMigration


class V042UploadObservability(BaseMigration):
    version = 42
    description = "Add upload_failures.flow_id + user_usage_daily upload outcomes (T15050)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE upload_failures ADD COLUMN IF NOT EXISTS flow_id TEXT")
        cur.execute(
            "ALTER TABLE user_usage_daily "
            "ADD COLUMN IF NOT EXISTS game_uploads_succeeded INTEGER NOT NULL DEFAULT 0"
        )
        cur.execute(
            "ALTER TABLE user_usage_daily "
            "ADD COLUMN IF NOT EXISTS game_uploads_failed INTEGER NOT NULL DEFAULT 0"
        )
