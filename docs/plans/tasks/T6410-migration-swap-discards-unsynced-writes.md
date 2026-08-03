# T6410: migration swap discards unsynced local writes - and T6340 now publishes the result

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-03
**Found by:** T6340's fresh-context reviewer (out-of-scope note, filed separately per review)

## Problem

`_migrate_profile_db` (`src/backend/app/migrations/__init__.py`) decides swap-vs-keep by comparing
**schema** versions (`PRAGMA user_version`), which says nothing about data recency:

```python
r2_version = _read_sqlite_user_version(tmp_path)      # SCHEMA version of R2 copy
local_version = _read_sqlite_user_version(db_path)    # SCHEMA version of local copy
if local_version > r2_version:
    ...sync local up, keep local...
else:
    ...swap R2's bytes over the local file...          # <-- discards local DATA
```

A local file with **unsynced writes** (user made edits; the R2 upload is still pending or recently
failed - `.sync_pending` marker set) almost always has the SAME schema version as R2. The `else`
branch swaps R2's older bytes over it, discarding the pending writes.

**This is pre-existing** (the base code did the same `shutil.move`), but two things changed its
severity:

1. **Before T6340**, the discarded state stayed local and the CAS refusal meant the swapped file
   never reached R2 - the loss was bounded and often healed by the next re-pull anyway.
2. **After T6340**, the swap records a confirmed baseline and the migrated file **uploads at
   `r2_version + 1`** - the discard becomes the canonical copy. The pending-sync retry machinery
   (`.sync_pending` marker) survives the swap, but the data it was protecting is gone.

Window is small (migrations are admin-triggered, writes must be in-flight/failed at that moment)
but the failure is silent and permanent.

## Suggested direction (implementor verifies)

Before the swap branch, refuse the profile (new status, e.g. `sync_pending_busy`) when the local
copy holds unconfirmed writes - signals available:

- `.sync_pending` marker for the user (see `database.py` marker helpers)
- local **sync** baseline (`db_version` row / `get_local_db_version`) vs the R2 object's
  `x-amz-meta-db-version` - if local baseline == R2 sync version but a pending marker exists,
  local data is ahead of R2 with the same baseline

Do NOT try to merge; refuse and let the normal retry/heal path flush the pending write first, then
migrate on the next run. Mirrors T6340's `wal_busy` shape (refuse-and-retry, never guess).

## Context

- `src/backend/app/migrations/__init__.py` - `_migrate_profile_db` swap decision (post-T6340 shape)
- `src/backend/app/database.py` - `.sync_pending` marker helpers, `get_local_db_version`
- `.claude/knowledge/persistence-sync.md` - T6340 section (baseline invariant), T4110 (sync_pending)
- Sibling shape: T6340's `wal_busy` refusal + its test seeding a live WAL connection

## Acceptance Criteria

- [ ] A profile with a `.sync_pending` marker (or local-ahead-of-baseline state) is NOT swapped;
      the run reports a distinct refusal status for it, not `ok` and not a silent swap
- [ ] A test seeds unsynced local writes (same schema version as R2, pending marker set), runs
      `_migrate_profile_db`, and asserts the local writes survive and nothing uploaded
- [ ] Normal case (no pending writes) still migrates and uploads exactly as T6340 left it
- [ ] The refusal self-resolves: once the pending sync flushes, the next run migrates normally
