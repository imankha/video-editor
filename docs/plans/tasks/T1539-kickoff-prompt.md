# T1539 Kickoff Prompt — R2 Concurrent-Write Rate Limit

Copy everything below the line into a fresh Claude Code session.

---

## Task

Implement T1539: R2 Concurrent-Write Rate Limit. Read the task file at `docs/plans/tasks/T1539-r2-concurrent-write-rate-limit.md` and CLAUDE.md before doing anything.

## Problem Summary

Cloudflare R2 returns 429 ("Reduce your concurrent request rate for the same object") when multiple PutObject calls land on the same `profile.sqlite` key within a short window. This puts the user in degraded state (`.sync_pending` marker), and subsequent writes trigger `retry_pending_sync` on top of their own sync — failure begets more concurrency begets more 429s. A single unlucky 429 can cascade into multi-second stalls.

## Architecture You Must Understand First

Read these files before designing anything:

| File | What to look for |
|------|-----------------|
| `CLAUDE.md` | "Persistence: Gesture-Based, Never Reactive" section — **non-negotiable constraints** |
| `src/backend/app/middleware/db_sync.py` | The full request sync pipeline — per-user write lock (lines ~118-139), retry_pending_sync (lines ~466-479), parallel upload via asyncio.gather (lines ~573-576), sync_pending marker lifecycle |
| `src/backend/app/storage.py` | `sync_database_to_r2_with_version()` (lines ~748-841) — optimistic locking with HEAD check, `retry_r2_call()` with TIER_1 (4 attempts, exponential backoff), fast-timeout sync client (3s connect, 10s read) |
| `.claude/references/coding-standards.md` | Persistence rules (lines ~286-352) |

### How sync works today (simplified)

```
RequestContextMiddleware.dispatch()
  -> _maybe_write_lock()          # per-user asyncio.Lock, serializes WRITE methods
     -> _sync_aware_flow()
        1. If has_sync_pending AND method is WRITE:
           -> asyncio.to_thread(retry_pending_sync)
              -> sync_database_to_r2_with_version()  # PutObject to same key
              -> sync_user_db_to_r2_with_version()
        2. Process the actual request (call_next)
        3. If handler wrote to DB (has_writes flag):
           -> mark_sync_pending()
           -> asyncio.gather(
                asyncio.to_thread(sync_db_to_r2_explicit),    # PutObject #1
                asyncio.to_thread(sync_user_db_to_r2_explicit) # PutObject #2
              )
           -> Clear marker on success, set on failure
```

### Why 429s happen despite the per-user lock

The per-user asyncio.Lock serializes *handler execution*, but R2 uploads run in worker threads via `asyncio.to_thread()`. The critical issue: **step 1 (retry_pending_sync) and step 3 (post-handler sync) can overlap** in specific scenarios:

- Request A finishes handler, starts uploading (step 3) in a worker thread
- The asyncio lock releases after step 3 starts but before the upload completes
- Request B acquires the lock, sees `.sync_pending` (from A's mark), starts retry_pending_sync (step 1) in another worker thread
- Both threads hit PutObject on the same R2 key simultaneously -> 429

Also: the asyncio.gather in step 3 fires TWO concurrent PutObjects (profile.sqlite + user.sqlite) — these target different keys so shouldn't 429 each other, but confirm this assumption.

### Key log markers

- `[WRITE_LOCK_WAIT]` — writer waited >50ms for per-user lock
- `[R2_CALL]` — individual R2 operation with client, op, status, elapsed_ms
- `[SYNC]` — retry attempts, success/failure, conflict detection
- `[SYNC_PARTIAL]` — profile sync result != user sync result
- `[SLOW DB SYNC]` — sync took >500ms

### Retry strategy

- `retry_r2_call()` in `app/utils/retry.py` — TIER_1 = 4 attempts, 1s initial backoff, 2x exponential, 50-150% jitter
- Transient errors retried: timeout, 429, 500/502/503
- Non-transient errors fail fast: 404, 403

## Hard Constraints (from CLAUDE.md, non-negotiable)

1. **Atomic gesture commit.** When a write request returns 200, the change is durably in R2 — readable by the next request from any client. No "will be saved soon."
2. **No silent loss under crash.** `.sync_pending` marker behavior is the floor.
3. **No new write paths.** Solution applies uniformly to all write handlers. No "fast" vs "slow" modes.
4. **Cross-user fairness.** A hot user must not stall unrelated users. Per-user lock granularity is the minimum.
5. **Per-user serialization at least as strong as today.** Two writes from the same user need correct ordering.
6. **Observable.** Keep `[R2_CALL]` / `[SYNC]` / `[WRITE_LOCK_WAIT]` logs or equivalents.

## What is NOT allowed

- Background-only sync (violates constraint 1)
- Debouncing writes across gestures (violates constraint 1)
- Batching/coalescing pending writes in a queue (violates constraint 1, crash risk)
- "Ack then flush" pattern (violates constraint 1)
- Replacing SQLite or moving off R2 (out of scope)
- Per-row locking (out of scope, see T1538)

## Investigation Phase (do this FIRST)

Before designing, gather evidence:

1. **Re-read `[R2_CALL]` logging** in storage.py (lines ~48-77) to understand what's already instrumented
2. **Trace the lock lifecycle** in db_sync.py — does the asyncio.Lock hold through the R2 upload, or release before? This is the key question. Find the exact lines where the lock acquires and releases relative to the asyncio.to_thread upload calls
3. **Check if retry_pending_sync can race with post-handler sync** — trace through the code to confirm or deny the race condition described above
4. **Check the asyncio.gather call** — do the two PutObjects target different R2 keys? (profile.sqlite vs user.sqlite at different paths)
5. **Look at T1538 (Per-Resource Locks) task file** at `docs/plans/tasks/T1538-per-resource-locks.md` — understand how it intersects

## Design Considerations

The core insight is likely: **the per-user lock must hold through the R2 upload, not just through the handler.** If the lock releases before the upload thread completes, that's the race window.

Possible approaches to explore (not prescriptive — investigate first):

- **Extend lock scope** to cover the full upload, not just the handler. Trade-off: higher lock contention = higher `[WRITE_LOCK_WAIT]` times, but eliminates concurrent PutObject on the same key entirely.
- **Upload serialization separate from handler lock** — a per-user upload semaphore/lock that ensures only one PutObject per key at a time, without blocking handler execution.
- **Eliminate retry_pending_sync as a separate code path** — if the post-handler sync already handles pending state, the retry path may be redundant and a source of races.

Whatever you propose, show how it handles these scenarios:
1. Normal single write (happy path)
2. Two rapid writes from same user (lock contention)
3. Write fails mid-upload (crash recovery)
4. Write succeeds but retry_pending_sync fires on next request (stale marker)

## Workflow

Follow the project workflow in CLAUDE.md:

1. **Classify** the task (stack layers, files, LOC, test scope, agents)
2. **Branch**: `git checkout -b feature/T1539-r2-concurrent-write-rate-limit`
3. **Code Expert phase**: Read the files listed above, trace the exact race condition
4. **Architecture phase**: Produce a design doc at `docs/plans/tasks/T1539-design.md` with current-state diagrams, target-state diagrams, and implementation plan — then STOP and wait for approval
5. Do NOT implement until the design is approved

## Files likely touched

- `src/backend/app/middleware/db_sync.py` — lock lifecycle, sync pipeline
- `src/backend/app/storage.py` — upload functions, retry config
- `src/backend/app/utils/retry.py` — retry tiers if tuning needed
- Tests: `src/backend/tests/` — look for existing sync/middleware tests to extend
