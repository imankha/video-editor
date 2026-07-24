# T5850 — Sweep delete gate: honor "never delete on incomplete information" under transient sync failure

**Status:** STAGING (landed on master; auto-deploys staging)
**Tier:** M — backend, 3 files, no schema change
**Domain:** [export-pipeline](../../../.claude/knowledge/export-pipeline.md) (grace-deletion sweep), persistence-sync

## Background

The base fix for wrongful game-video deletion (`game_ref_counts.ref_count` drift →
sweep permanently deletes an R2 `games/{hash}.mp4` while a profile still holds a live
ref → "ready" game with a 404 video, lost imankh games 2/3/5) already landed on master
as commit **1678145a** ("fix(sweep): never delete a game video while a live storage ref
exists"). That commit added the Phase-2 authoritative gate: before the irreversible R2
delete, recount live `game_storage` refs across all profiles (the source of truth) and
abort if any exist.

A post-merge review found the gate did **not fully honor its own stated invariant**
("never delete on incomplete information").

## The hole (review MAJOR)

`_count_refs_all_profiles` relied on `count_refs_in_profile` *throwing* for an unreadable
profile in order to count it as a live ref. But a **transient R2 sync failure** in Phase 1
does not throw: `ensure_database` sets a retry cooldown and falls through to create a
fresh, empty-but-valid local `game_storage` table. Phase 2 then reads that empty DB, gets
`(0, 0)` live refs, and permanently deletes a video the un-downloaded profile still
references. Strictly narrower than the pre-fix behavior (not a regression), but it reopens
the exact irreversible-loss path when the counter drifted ≤0 **and** the true live ref
sits in the profile that failed to sync.

## Fix

- `app/database.py`: new `has_recent_sync_error(user_id, profile_id)` — True only when the
  last R2 restore for that profile failed transiently and the retry cooldown
  (`_r2_restore_cooldowns`, `RESTORE_COOLDOWN_SECONDS=30`) is still active. Distinct from
  "no data": a genuinely new/empty profile syncs cleanly (NOT_FOUND → version locked to 0,
  no cooldown) and is counted normally — so this does NOT over-block empty profiles.
- `app/services/sweep_scheduler.py`:
  - `_count_refs_all_profiles` now returns `(total, live, authoritative)`. A profile with
    a missing local DB **or** an active sync-error cooldown is counted as a live ref AND
    flips `authoritative=False`.
  - `do_sweep` Phase 2: on abort, only cancel the grace row + heal the counter when the
    count was **authoritative** (a real live ref found). When indeterminate, DEFER —
    leave the grace row queued and do not heal the counter to a wrong value, so the hash
    is re-evaluated next sweep once the profile syncs.

## Tests

`tests/test_sweep_scheduler.py::TestGraceDeletionLiveRefGuard::test_grace_delete_deferred_when_profile_not_authoritatively_synced`
— empty local DB + active cooldown → `r2_delete_object_global` NOT called, grace row kept,
counter NOT healed. Full file: **34 passed**.

## Deferred / not in scope

- The durable "derive don't duplicate" change (replace the redundant `game_ref_counts`
  counter with a derived ref-set so `ref_count = COUNT(*)` cannot drift) remains a
  follow-up in `.claude/retrospectives/game-video-refcount-drift-incident.md`.
- **Data recovery:** this only prevents *future* loss. Already-deleted videos (imankh
  games 2/3/5) need restore-from-local ([reference](../../../C:/Users/imank/.claude/projects/c--Users-imank-projects-video-editor/memory))
  or are unrecoverable.
- Review MINORs left as-is: the `no expiry => not live` branch is unreachable
  (`storage_expires_at` is NOT NULL); the abort-path two-commit non-atomicity is safe
  (video preserved either way).
