# T1154: Atomic Dual-DB Sync (profile + user)

**Status:** MEASURING (precursor log landed 2026-04-13; revisit after 30d of data)
**Impact:** 5
**Complexity:** 6
**Created:** 2026-04-13
**Updated:** 2026-04-13

## Measurement Phase (Active)

Phase 1 of this task requires measured frequency of partial-success sync events. Historical logs could not supply this because:
1. The existing `[SYNC] ... -> R2 sync FAILED` line ([db_sync.py:333](../../src/backend/app/middleware/db_sync.py#L333)) does not distinguish which of profile/user failed — both collapse into one message.
2. No log retention infra (no fly.toml log shipping, no external sink) — `fly logs` is live-tail only.

**Precursor commit landed on `feature/T1154-log-partial-sync`:** added `[SYNC_PARTIAL]` warning at [db_sync.py:~295](../../src/backend/app/middleware/db_sync.py) that fires only when `profile_ok != user_ok` in the parallel branch. Fields: `user`, `profile_ok`, `user_ok`, `path`, `method`.

**Next step (deferred ~30d from deploy):** grep prod logs for `[SYNC_PARTIAL]`, count events/day and events/1000 requests, cross-reference against credit writes, then write `T1154-recommendation.md` per acceptance criteria below.

**Note:** without log retention infra, measurement requires either (a) ad-hoc capture windows via `fly logs` during high traffic, or (b) a separate infra task to ship logs. Flag this when resuming.

## Problem

The middleware syncs `profile.sqlite` and `user.sqlite` in parallel via a ThreadPoolExecutor ([src/backend/app/middleware/db_sync.py:227-250](src/backend/app/middleware/db_sync.py#L227-L250)). If one upload succeeds and the other fails, R2 holds a mismatched pair:

- Credit deducted in `user.sqlite` (uploaded) but export record in `profile.sqlite` (not uploaded) → user paid for nothing.
- Export record in `profile.sqlite` (uploaded) but credit not deducted in `user.sqlite` (not uploaded) → free export.

The `.sync_pending` marker does cause retry, but between the partial-success moment and the retry landing, any read from a second device sees an inconsistent snapshot.

## Solution

Several options; the right one depends on how often this actually matters.

### Option A: Only mark `.sync_pending` clear on BOTH success
Currently done. The inconsistency window still exists on R2 but resolves on retry. Document that reads from R2 mid-sync may be inconsistent, add a read-side version check that tolerates it.

### Option B: Sequential sync, fail-fast
Drop the ThreadPoolExecutor. Sync profile first; only sync user.sqlite if profile succeeded. On profile failure, skip user entirely (marker triggers full retry).

**Pros:** eliminates one-succeeded-one-failed split.
**Cons:** gives up parallelism (roughly 2x sync latency in the hot path).

### Option C: Single "transaction ID" per sync pair
Upload both with a common txn_id. Reads verify txn_id matches between the two; mismatch triggers re-fetch or waits.

**Pros:** correct even with parallel uploads.
**Cons:** requires R2 metadata, read-side verification, version scheme changes.

### Option D: Merge into single DB file
Put user.sqlite content inside profile.sqlite (or vice versa). Single upload = atomic.

**Pros:** simplest correctness.
**Cons:** large refactor; user.sqlite is intentionally separate for multi-profile scenarios where user-level data (credits, account) crosses profiles.

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py:227-271` — parallel sync block
- `src/backend/app/database.py:1396` `sync_db_to_r2_explicit`
- `src/backend/app/database.py:1428` `sync_user_db_to_r2_explicit`
- `src/backend/app/storage.py` — version tracking

### Related Tasks
- Depends on: T1150, T1152 (marker-as-truth)
- Related: T1153 (write-ahead sync — Option B there subsumes this)

### Technical Notes
- Parallel sync was added for latency (see PROFILING log in middleware). Measure actual impact before reverting to sequential.
- Cross-device read of mismatched pair is rare: user would have to switch devices in the <1s window between upload 1 and upload 2. Not zero, but not frequent.
- Credit system is the highest-stakes data in user.sqlite; export records are highest-stakes in profile.sqlite. Both flow through the same request handler — consider whether these two specific write classes ever co-occur in practice.

## Acceptance Criteria

- [ ] Measured frequency of partial-success events in last 30 days of logs
- [ ] Recommendation documented: which option, or "accept"
- [ ] If implementing: split into follow-up task with concrete scope
- [ ] Tests cover chosen semantics (partial failure path, retry convergence)
