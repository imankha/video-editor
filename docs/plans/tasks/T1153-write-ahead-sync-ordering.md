# T1153: Investigate Write-Ahead Sync Ordering

**Status:** WONT_DO
**Impact:** 6
**Complexity:** 7
**Created:** 2026-04-13
**Updated:** 2026-04-13

## Problem

Writes commit to local SQLite **before** R2 upload is attempted. If the process crashes or the Fly.io machine is recycled between commit and upload, data is local-only. The `.sync_pending` marker helps — but only if the same machine comes back with the same local volume. Volume loss = data loss.

For high-impact writes (export completion, credit deductions, purchase confirmations) the cost of loss is higher than the cost of latency.

## Solution (research task, not implementation)

Several options, each with tradeoffs. This task is to **evaluate**, not implement — pick one and spin up an implementation task.

### Option A: Write-through for critical actions
Specific endpoints (exports, purchases, credits) block on R2 upload before returning 200. Non-critical writes keep current async-sync behavior.

**Pros:** minimal blast radius, latency cost only where it matters.
**Cons:** requires classifying every action; surgical changes per endpoint.

### Option B: WAL-style action log uploaded first
Before commit, append the gesture-action JSON to an R2-backed log. On recovery, replay the log against the restored SQLite snapshot.

**Pros:** crash-safe with single-round-trip latency; matches gesture-based architecture.
**Cons:** replay engine is real complexity; log compaction needed; schema drift between log and DB.

### Option C: Fly.io volume replication / snapshot frequency
Rely on infrastructure: more-frequent volume snapshots, multi-machine replication.

**Pros:** zero app code changes.
**Cons:** Fly.io volumes don't replicate synchronously; still a loss window.

### Option D: Accept the risk, improve observability
Do nothing structural. Add metrics on sync latency and failure rate; alert if pending markers accumulate.

**Pros:** no work.
**Cons:** actual data loss risk unchanged.

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py` — current commit-then-sync flow
- `src/backend/app/database.py:1396` `sync_db_to_r2_explicit`
- `src/backend/app/storage.py` — R2 upload mechanics, version tracking
- `fly.toml` — volume config

### Related Tasks
- Builds on: T1150, T1151, T1152 (the reactive-retry story needs to be solid before deciding if write-through is warranted)
- Related: T1190 (session/machine pinning — if sessions stick to machines, local-disk risk concentrates on single-machine failures)

### Technical Notes
- Measure first: how often do sync failures actually occur? How often does a Fly.io machine recycle with pending markers? If p99.9 data loss rate is already tolerable, Option D wins.
- Gesture-based sync makes Option B more tractable than it would be for a full-state system.
- Latency budget for export: users already tolerate multi-second export waits, so Option A on exports is ~free.

## Acceptance Criteria

- [ ] Document actual sync-failure rate from logs (last 30 days)
- [ ] Document actual machine-recycle-with-pending rate
- [ ] Recommendation written up: which option, or "accept risk"
- [ ] If implementing: spawn follow-up task with concrete scope
