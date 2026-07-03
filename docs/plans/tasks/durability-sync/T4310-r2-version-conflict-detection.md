# T4310: R2 Version-Conflict Detection (CAS Uploads)

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-07-03
**Epic:** [durability-sync](EPIC.md) · Audit item B2

## Problem

The T950-era version-conflict check exists (`storage.py:884-897`, compares R2 `x-amz-meta-db-version` before upload) but **every production call site bypasses it**: `middleware/db_sync.py:271-272, 284-285`, `database.py:1163-1165, 1236-1239, 1277, 1345`, `main.py:268` — all pass `skip_version_check=True`.

Failure mode: machine pinning is a cookie + circuit breaker (`db_sync.py:447-471`). When the pinned machine dies mid-session, another machine serves the user from a freshly downloaded DB copy. If both machines hold the DB across any window (e.g., an in-flight export worker on machine A syncs after machine B took over), both compute `new_version = local + 1` and upload — **the loser's writes vanish silently and version metadata shows no anomaly**. The per-user write lock (`db_sync.py:188-211`) is per-process only. Data at risk: the user's entire profile DB.

## Solution

Reinstate the check as compare-and-swap, in two stages:

1. **Stage 1 — background/worker syncs** (not latency-sensitive): post-export syncs, shutdown sync, retry worker. HEAD the object, compare `x-amz-meta-db-version` against the version the local DB was loaded from (NOT just local counter — read how versions are tracked in `db_sync.py`/`storage.py` first; the sync-version note in memory "Migrations: PRAGMA user_version vs db_version" is about a DIFFERENT version counter — don't conflate). On mismatch: do NOT upload; log CRITICAL with both versions + machine id, set a `sync_conflict` state the existing `sync_failed` UX (T4110) can surface. Losing a conflict loudly beats winning it silently.
2. **Stage 2 — request-path deferred syncs**: same CAS, but failure feeds the existing retry/`.sync_pending` machinery with conflict status instead of blind retry (a conflicted retry must re-download + reconcile or escalate, never overwrite).
3. **Recovery path decision (document in this file's log before implementing):** on conflict, the safe default is freeze-and-escalate (stop syncing that user, surface admin alert). Automatic merge is out of scope.

## Context

- Files: `src/backend/app/storage.py`, `src/backend/app/middleware/db_sync.py`, `src/backend/app/database.py`, `src/backend/app/main.py`
- **Why the check was bypassed** — find out first (`git log -S "skip_version_check"`): if it was latency (HEAD per upload) or false-positive conflicts, the fix must address that cause, not just flip the flag. Do NOT re-introduce the T2720 blocking-sync regression: the CAS HEAD happens inside the already-async upload path, never on the request thread.
- Related: memory "Fire-and-forget deferred" — session/machine pinning constraints; T1190.

## Steps

1. [ ] Archaeology: why `skip_version_check=True` everywhere? Write the answer in the Progress Log.
2. [ ] Map the version-tracking flow (loaded-from version must be recorded at download time if it isn't).
3. [ ] Test first: simulate two writers (upload with stale loaded-version) → assert second upload is refused + conflict state set, first machine's data intact in R2.
4. [ ] Stage 1, then Stage 2; each with the T4120 sync-failure seams for in-container verification.

## Acceptance Criteria

- [ ] No profile-DB upload can overwrite a version it didn't load from
- [ ] Conflicts are loud (CRITICAL log + user-visible sync state + admin visibility), never silent
- [ ] p50 request latency unchanged (measure before/after — profiling runbook)
- [ ] Two-writer test passes; forced-conflict verified in a container
