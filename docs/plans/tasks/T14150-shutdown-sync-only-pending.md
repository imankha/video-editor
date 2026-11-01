# T14150: Deploy shutdown uploads every local DB in a 30 s window

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

On SIGTERM, `main.py` ~439-476 globs EVERY local `profile.sqlite` (and ~484 every `user.sqlite`) and, one by one, WAL-checkpoints, HEADs and PUTs each, with no dirty check. Fly kills the machine at `kill_timeout = 30` s, there is no volume (`[mounts]`), so local disk and any `.sync_pending` markers vanish on deploy. Glob order ignores pending state, so a DB with a real un-synced change can sit behind hundreds of clean ones and never upload: silent data loss on deploy, which exists today at small scale and grows with the number of local DBs (T14140 makes that all of them). It also re-uploads unchanged DBs and bumps their version for nothing.

## Solution

Sync only DBs with a `.sync_pending` marker or in an in-process dirty set, oldest pending first, and log CRITICAL for any pending DB not synced before the deadline (fail loudly, persistence rule 7). Infrastructure depth 2 (sync/persistence): this outranks the performance items.

## Context

### Relevant Files
- `src/backend/app/main.py` (shutdown handler)
- `src/backend/app/middleware/db_sync.py` / `src/backend/app/storage.py` (dirty tracking, mark_sync_pending)
- `src/backend/tests/` (shutdown selection test)

### Notes
Load: persistence-sync.md (CAS / SyncResult, sync_pending), backend-services.md.

## Acceptance Criteria

- [ ] Test: 2,000 clean local DBs + 1 pending: shutdown uploads only the pending one, in under 5 s
- [ ] Pending DBs are synced oldest-first; an unsynced pending DB at the deadline logs CRITICAL
- [ ] No version bump for unchanged DBs on deploy
