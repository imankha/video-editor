"""
v040 (T14140): the expiry sweep selects its candidates from Postgres instead of
walking every user's profiles.

- `idx_game_refs_expires` on `game_storage_refs(storage_expires_at)`: Phase 1's
  "expiring (user, profile) pairs" query and `get_next_expiry()`'s MIN.
- `r2_grace_deletions.queued_by_user_id` / `queued_by_profile_id`: the profile
  whose reclaim queued the grace row, where Phase 2 re-runs the artifact gate.
  Existing rows stay NULL (who queued them was never recorded); Phase 2 defers
  those rather than deleting blind.

Additive and idempotent; `_SCHEMA_DDL` carries the same statements.
"""

from ..base import BaseMigration


class V040SweepCandidateIndex(BaseMigration):
    version = 40
    description = "Add idx_game_refs_expires + r2_grace_deletions.queued_by_* (T14140 PG-driven sweep)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_game_refs_expires ON game_storage_refs(storage_expires_at)"
        )
        cur.execute("ALTER TABLE r2_grace_deletions ADD COLUMN IF NOT EXISTS queued_by_user_id TEXT")
        cur.execute("ALTER TABLE r2_grace_deletions ADD COLUMN IF NOT EXISTS queued_by_profile_id TEXT")
