# T1539 Kickoff Prompt — R2 Concurrent-Write Rate Limit

Copy everything below the line into a fresh Claude Code session.

---

## Task

Verify and test T1539: R2 Concurrent-Write Rate Limit. This task is in TESTING status -- implementation is complete, unit tests pass. Read `CLAUDE.md` before doing anything.

## Status

- **Branch:** `feature/T1539-r2-concurrent-write-rate-limit` (merged to master)
- **Status:** TESTING
- **Design doc:** `docs/plans/tasks/T1539-design.md`
- **Task file:** `docs/plans/tasks/T1539-r2-concurrent-write-rate-limit.md`
- **Tests:** `src/backend/tests/test_upload_lock.py` (11 tests, all passing)

## Problem Summary

Cloudflare R2 returns 429 ("Reduce your concurrent request rate for the same object") when multiple PutObject calls land on the same `profile.sqlite` key within a short window. This puts the user in degraded state (`.sync_pending` marker), and subsequent writes trigger `retry_pending_sync` on top of their own sync -- failure begets more concurrency begets more 429s. A single unlucky 429 can cascade into multi-second stalls.

## Root Cause (discovered during investigation)

**The original hypothesis was wrong.** The kickoff prompt assumed the per-user asyncio.Lock released before the R2 upload completed, allowing request-to-request races. Investigation proved this false:

- `_maybe_write_lock` (db_sync.py:142-157) uses `async with lock:` which holds through the entire `_sync_aware_flow`
- `_sync_aware_flow` `await`s `asyncio.gather` for the uploads (db_sync.py:573)
- Therefore the lock holds through the R2 upload -- **request-to-request races are impossible**

**The actual race is export worker vs middleware sync:**

- `export_worker.py` calls `sync_db_to_r2_explicit()` directly after completing an export job (lines 129, 229)
- This runs in a FastAPI `BackgroundTask` -- outside the request middleware, outside the per-user write lock
- When an export finishes while the user is making edits, both hit PutObject on the same `profile.sqlite` key concurrently -> R2 429

**Secondary race:** Shutdown sync in `main.py` (lines 206-227) also runs outside the lock, but this is low risk since shutdown is rare.

**The two parallel PutObjects in asyncio.gather target different R2 keys** -- confirmed safe:
- profile.sqlite: `{env}/users/{uid}/profiles/{pid}/profile.sqlite`
- user.sqlite: `{env}/users/{uid}/user.sqlite`

## What Was Implemented

### Per-user per-key upload lock (`threading.Lock`)

A `threading.Lock` per `(user_id, db_type)` inside the two upload functions. Every sync path (middleware, export worker, shutdown, retry) goes through these functions, so the lock is universal.

**Why `threading.Lock` not `asyncio.Lock`:** Callers run on different thread types -- asyncio executor threads (middleware sync), background task threads (export worker), and main thread (shutdown). `threading.Lock` works across all of them.

### Files Changed

| File | What changed |
|------|-------------|
| `src/backend/app/storage.py` | Added `get_upload_lock(user_id, db_type)` factory. Wrapped the `retry_r2_call(client.upload_file, ...)` call in both `sync_database_to_r2_with_version` and `sync_user_db_to_r2_with_version` with the upload lock. Added `[UPLOAD_LOCK_WAIT]` logging when lock wait exceeds 50ms. |
| `src/backend/app/middleware/db_sync.py` | Added tryLock optimization to `retry_pending_sync` path -- if the upload lock is already held (export worker uploading), skip the retry instead of blocking. Avoids redundant PutObject. |
| `src/backend/tests/test_upload_lock.py` | 11 unit tests covering lock identity, serialization, parallel different-key uploads, lock-held-during-upload, lock-released-on-failure, and tryLock optimization. |

### Key Design Decisions

1. **Separate locks for profile vs user keys** -- preserves `asyncio.gather` parallelism in the middleware. A single per-user lock would serialize profile + user uploads, adding ~300-1000ms to every write.

2. **Lock inside the upload function, not at the caller level** -- minimal scope (only PutObject is serialized, not HEAD check or version calculation), and universal (every sync path goes through these functions automatically).

3. **tryLock optimization** -- `retry_pending_sync` does `profile_lock.acquire(blocking=False)`. If it fails (someone else is uploading), skip the retry. The in-progress upload will either succeed (clearing the pending state) or fail (leaving the marker for the next request). This avoids blocking a write request behind a potentially slow export upload.

### New Observability

- `[UPLOAD_LOCK_WAIT] user={user_id} db={profile|user} waited_ms={N}` -- logged when a sync waited for the upload lock (threshold: 50ms)
- Existing `[R2_CALL]`, `[SYNC]`, `[WRITE_LOCK_WAIT]` logs unchanged

### How It Handles Key Scenarios

| Scenario | Behavior |
|----------|----------|
| Normal single write | Lock uncontested, no latency change |
| Two rapid writes from same user | Already serialized by asyncio write lock; upload lock is uncontested |
| Export worker sync races with request sync | Upload lock serializes them; request waits ~300-1000ms instead of 429 |
| Write fails mid-upload | `with` statement guarantees lock release; `.sync_pending` marker remains for next request retry |
| Stale `.sync_pending` + export uploading | tryLock skips retry; export upload handles it |

### Worst Case

If `retry_r2_call` exhausts all TIER_1 retries (4 attempts, exponential backoff, 3s connect / 10s read timeouts), the lock could be held for ~30-50s. Other uploads for that same user+key wait. This is still better than the 429 cascade it replaces.

## Relationship to T1538 (Per-Resource Locks)

T1539's `get_upload_lock()` is the "R2 push lock" that T1538 needs for its Option 2b. T1538 can reuse it directly for handler-level parallelism without building a separate R2 serialization mechanism. T1538 has been updated to reflect this (complexity reduced from 6 to 4).

## Hard Constraints (from CLAUDE.md, non-negotiable)

1. **Atomic gesture commit.** When a write request returns 200, the change is durably in R2 -- readable by the next request from any client.
2. **No silent loss under crash.** `.sync_pending` marker behavior is the floor.
3. **No new write paths.** Solution applies uniformly to all write handlers.
4. **Cross-user fairness.** A hot user must not stall unrelated users.
5. **Per-user serialization at least as strong as today.**
6. **Observable.** Keep `[R2_CALL]` / `[SYNC]` / `[WRITE_LOCK_WAIT]` / `[UPLOAD_LOCK_WAIT]` logs.

## Testing Checklist

- [x] Unit tests pass: `cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_upload_lock.py -v`
- [x] Import check passes: `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`
- [ ] Manual test: trigger export while making rapid edits, watch logs for `[UPLOAD_LOCK_WAIT]` (lock working) and absence of `[R2_CALL].*status=429`
- [ ] Verify existing sync tests still pass: `cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_sync_pending.py tests/test_sync_retry.py tests/test_export_worker_sync.py tests/test_sync_status.py -v`
- [ ] Deploy to staging and monitor `[UPLOAD_LOCK_WAIT]` frequency and `[R2_CALL]` 429 rate

## Log Markers to Watch

```
[UPLOAD_LOCK_WAIT]    # NEW -- proves lock contention occurred (export vs request race caught)
[R2_CALL].*status=429 # OLD -- should no longer appear for same-user same-key races
[SYNC] Skipping retry  # NEW -- tryLock optimization fired
[WRITE_LOCK_WAIT]     # EXISTING -- per-user asyncio write lock contention
```
