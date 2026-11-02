# T14160 Design: evicting the local per-user SQLite cache

Status: AWAITING APPROVAL, for T14370 (split from T14160 on 2026-11-02; T14160 shipped the clobber guards below). Task file: [T14370-local-user-db-lru-eviction.md](T14370-local-user-db-lru-eviction.md).
Knowledge: persistence-sync.md (T5081 INV-P, T6160, T5083, T5920). Source: expert analysis, 2026-11-02.

## Two clobber bugs in the current code (no eviction needed to trigger them)

The expert reproduced both against the real boto pipeline, using `tests/r2_fake_transport.FakeR2Transport`.

1. **A deleted profile.sqlite with a cached version: R2 gets overwritten with an empty DB.** `ensure_database` trusts `get_local_db_version`, which returns the in-memory cached version even when the file is gone. The R2 restore is skipped, sqlite creates an empty DB, and the next upload passes CAS. user.sqlite already has a guard for this (T6910, `user_db.py` ~192); profile.sqlite does not.
2. **The file vanishes during the upload's CAS HEAD: a 0-byte DB is uploaded at version+1.** `storage._checkpoint_wal_or_refuse` calls `sqlite3.connect(path)`, which creates an empty file. The user.sqlite primitive has the same shape.

Eviction would turn both from rare races into routine events, so the guards ship first:

- `get_local_db_version`: if the file is missing, drop the cache entry and return None.
- `mode=rw` URI connects in `_checkpoint_wal_or_refuse`, `set_local_db_version`, `_clear_persisted_db_version` and `get_local_db_version`. Each of these can create an empty file today.

## Why a connection- or request-scoped refcount is not enough

A committed write is marked `.sync_pending` only after the handler returns. The export worker commits, then syncs minutes later. `_INFLIGHT` is keyed by the session user, so it misses foreign writes, `user_session_init`, SKIP_SYNC paths and background writers.

T14150's fingerprint (`db_may_differ_from_r2`) reads as dirty after every profile sync, because `set_local_db_version` writes the `db_version` row into the file.

## Design

**Eviction unit: the user.** user.sqlite and every profile.sqlite are evicted together.

**New module `app/services/db_residency.py`** (~130 LOC) holds `_EVICT_LOCK`, the `_HOLDS` refcount, `_LAST_USED`, `HeldConnection`, the eviction predicate, the evict pass, and the loop.

**Holds** are taken in these places:
- `get_db_connection` and `ensure_database`.
- user_db `ensure_user_database*` and `get_user_db_connection`. The hold comes before the per-user RLock.
- `materialization.ensure_profile_db_local`, plus `HeldConnection` for `_open_profile_db` and `open_profile_db_readonly`.
- The four sync primitives.
- `DBSyncMiddleware.dispatch`, for the whole request.

**Eviction predicate.** It is checked and acted on under `_EVICT_LOCK`, one user per acquisition. A user is evicted only if all of these hold:
- R2 is enabled.
- The user has no holds.
- The user has been idle for at least 300 s. This guards against thrash; it is not part of the safety proof.
- The user has no pending, failed or conflict marker in any scope.
- No DB of the user has WAL sidecars.
- Every DB of the user has a clean mark whose sequence equals the current write sequence.

Eviction is NOT INV-P clear reason (c). It refuses when any marker exists and never clears one.

**Write-sequence fixes** (storage.py and database.py):
- `TrackedConnection.commit()` and `close()` bump the sequence when `total_changes` moved.
- Both upload primitives capture the sequence BEFORE the WAL checkpoint, so a commit landing after the checkpoint reads as dirty.

**The evict step**, in order:
1. Unlink `-wal`, then `-shm`, then the main file.
2. Run `user_db.forget_user_db(u)`.
3. Pop the `_r2_restore_cooldowns` entries for the user (currently missing from `forget_local_db_state`).
4. Run `storage.forget_db_marks`.
5. Pop the user from `_LAST_USED`.

**Trigger.** A separate asyncio loop started in `main.py`'s lifespan, every 120 s, on a dedicated 1-worker executor (never the shared 32-thread pool, see T14100). The budget is in bytes, LRU, with `DB_CACHE_HIGH_WATER_BYTES` set from the prod measurement. A pass evicts down to 0.8× of high water. Each pass logs one INFO line with skip reasons, and a WARNING if it ends above high water.

**Sweep** (`sweep_scheduler.py`):
- Phase 2 pins (holds) every holder user from the ref count through the expire step.
- `_phase2_artifact_gate_missing` fails closed on a missing file: it logs ERROR and defers the hash. Today it skips the file, which lets the R2 delete proceed.
- `_expire_game_storage_in_profiles` logs CRITICAL on a missing file.
- Phase 1 holds per profile.

**Privacy export** (`routers/privacy.py` ~149) globs local profile files. Eviction would make CCPA exports miss data, so it switches to `get_profiles()` + `open_profile_db_readonly` (which has an R2 fallback).

## Files (~230 production LOC)

| File | Change |
|---|---|
| db_residency.py (new) | everything listed above for the new module |
| database.py | missing-file guards, holds, commit bump, cooldown pop |
| storage.py | sequence captured before checkpoint, `mode=rw`, `forget_db_marks` |
| user_db.py | holds |
| materialization.py | `HeldConnection`, holds |
| middleware/db_sync.py | dispatch hold |
| sweep_scheduler.py | Phase 2 pin, fail closed |
| main.py | lifespan start/stop |
| routers/privacy.py | export reads every profile via `open_profile_db_readonly` |

## Tests (`tests/test_t14160_db_eviction.py`, FakeR2, no credentials)

Reds on current code:
- A missing file with a cached version must restore, not clobber.
- A file vanishing mid-CAS must never be uploaded empty.
- Phase 2 defers when a holder's file goes missing after it was opened.
- A commit after the upload checkpoint must stay dirty.

Acceptance tests:
- Never evicts a held DB.
- Never evicts a DB with a pending, failed or conflict marker, or with an un-uploaded write.
- Eviction drops all in-memory state for the user.
- The sweep pin blocks eviction.
- No-op without R2.
- Disk stays bounded under a seeded 10K-profile touch pattern.

## Not provable in the container

The prod disk-per-user measurement needs Fly credentials. That is a human check:

```
fly ssh console -C "df -h / && du -sh /user_data"
```

It sets `DB_CACHE_HIGH_WATER_BYTES`.
