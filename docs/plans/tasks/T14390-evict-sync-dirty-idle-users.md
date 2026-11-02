# T14390: Idle users stay dirty, so the local DB cache rarely evicts them

**Status:** TODO
**Blocked By:** T14380 (LRU eviction, PR #694)
**Tier:** M (backend only)

## Problem

T14380 evicts a user's local DB files only when every file is CLEAN, meaning R2 holds every write.
Several paths write user.sqlite without ever uploading it. They are on `SKIP_SYNC_PATHS` in
`src/backend/app/middleware/db_sync.py`:
- `/api/auth` (heartbeat, session-close)
- `/api/quests/achievements`

Closing a tab fires session-close, so almost every user who leaves reads DIRTY until they come
back. Eviction correctly refuses DIRTY users, so it frees almost nothing and `/user_data` keeps
growing. This was seen live on 2026-11-02, with a 1-byte high water: every pass skipped the test
account as `recent` while its tab was open and as `dirty` after it closed. The T14380 review
(major finding M1) confirmed it.

A related gap existed before T14380: those writes carry no pending marker, so a crash or deploy
before the next synced write loses them.

## Solution (reviewer's proposal; confirm the design before building)

Add a sync-before-evict step in `run_eviction_pass` (`app/services/db_residency.py`), not inside
`_evict_user`. For a candidate that is DIRTY, has no `.sync_*` marker and no WAL sidecar:
1. Take `hold_user(user)` OUTSIDE `_EVICT_LOCK`, because the upload is slow I/O.
2. Call `sync_user_db_to_r2_explicit(user)` and `sync_db_to_r2_explicit(user, pid)` for each local
   DB. They already do the CAS and the checkpoint, and they capture the write sequence before the
   checkpoint.
3. Release the hold, then run the existing `_evict_user`. It re-proves CLEAN under the lock.
4. If an upload fails or hits a CAS conflict, the DB stays dirty, the primitive logs ERROR, and the
   user is kept.

This is a backend lifecycle write with CAS, not reactive editor persistence. Record that in
`.claude/knowledge/persistence-sync.md`.

Marking those paths pending instead does not work: a marked DB is never evicted either.

## Also fold in (T14380 review minor findings)

- **m1:** `_evict_user` globs, stats and unlinks while holding `_EVICT_LOCK`, and the event loop
  takes that lock in `acquire_hold`. Measure on staging, and keep any upload out of the lock.
- **m2:** `release_hold` silently clamps a release that has no matching hold. Log CRITICAL instead.
- **m3:** a pass logs one INFO line per skipped user, every 120 s. Log the aggregate, with
  per-user lines at DEBUG.
- **m4:** local DBs left over from before a restart are never in `_LAST_USED`, so they are never
  counted or evicted. Seed `_LAST_USED` with a startup scan.
- **m5:** add `-journal` to the sidecar refusal and to the unlink list.
- **m6:** a DDL-only migration does not move `total_changes`. If its post-migration sync fails, the
  DB can read CLEAN without having been uploaded. Nothing is lost, because the migration re-runs
  after the re-pull. Decide whether the proof should cover it.
- **m7:** `routers/privacy.py` `_safe_profiles` turns a profile-list failure into `[]`, so an
  export can be silently incomplete. Fail the export loudly instead.

## Acceptance Criteria

- [ ] A DIRTY idle user with no marker gets synced and then evicted in one pass (with the upload
      stubbed).
- [ ] A CAS conflict or a failed upload leaves the user DIRTY and resident, with an ERROR log.
- [ ] No upload runs while `_EVICT_LOCK` is held.
- [ ] Live check: with a small high water, an account whose tab was closed is evicted on the next
      pass after `MIN_IDLE_S`, and it re-pulls on its next visit with every row back.

## Relevant Files

- `src/backend/app/services/db_residency.py`
- `src/backend/app/middleware/db_sync.py`
- `src/backend/app/database.py`
- `src/backend/app/routers/privacy.py`
- `src/backend/tests/test_t14380_db_eviction.py`
- `.claude/knowledge/persistence-sync.md`
