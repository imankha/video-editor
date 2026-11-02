# T14160: A missing local profile.sqlite can overwrite R2 with an empty DB

**Status:** WIP
**Impact:** 9
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-31
**Updated:** 2026-11-02

Originally "Local user-DB cache grows without limit". On 2026-11-02 the expert design for eviction (see [T14160-design.md](T14160-design.md)) grew to L tier, and the user chose to split it. This task keeps the prerequisite guards; the eviction itself moved to [T14370](T14370-local-user-db-lru-eviction.md).

## Problem

The expert reproduced two clobbers on current code, using FakeR2Transport. No eviction is needed to trigger either.

1. **A cached version for a missing file.** `get_local_db_version` returned the in-memory version even when profile.sqlite was gone, so `ensure_database` skipped the R2 restore and sqlite created an empty DB. The next upload passed CAS and overwrote R2. user.sqlite already had this guard (T6910).
2. **A file vanishing during the upload's CAS HEAD.** The storage primitive's `exists()` check comes before the HEAD, and `_checkpoint_wal_or_refuse` then ran `sqlite3.connect`, which created an empty file. That file was uploaded at version+1.

Separately, sweep Phase 2's artifact gate skipped a profile whose DB was missing. That made the irreversible R2 delete proceed, which eviction would make routine.

## Solution

- `get_local_db_version`: if the file is missing, drop the cached version and return None. The next access then restores from R2.
- `mode=rw` URI connects, which never create a file, in `storage._checkpoint_wal_or_refuse` (an open failure is already the loud, retryable refuse), `get_local_db_version`, `set_local_db_version` and `_clear_persisted_db_version`.
- Sweep: `_phase2_artifact_gate_missing` fails closed on a missing DB (ERROR, defer). `_expire_game_storage_in_profiles` logs CRITICAL instead of skipping silently.

## Acceptance Criteria

- [ ] T14160:C1 A missing file with a cached version restores from R2, and the next sync keeps every row (`tests/test_t14160_missing_db_guards.py`)
- [ ] T14160:C2 A file vanishing during the CAS HEAD never uploads an empty DB, and R2 keeps the last good copy
- [ ] T14160:C3 Phase 2 defers the R2 delete when a holder's DB is missing at the artifact gate
