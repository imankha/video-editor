# T126: Fly.io Suspend Mode + Graceful Shutdown

**Status:** TODO
**Impact:** 7
**Complexity:** 3

## Problem

The staging backend uses `auto_stop_machines = true` (which defaults to "stop"), causing full cold boots (~1-5s) on every wake. Additionally, there's no graceful shutdown handling — when Fly stops the machine, FastAPI gets SIGINT with only 5s before force-kill, which may not be enough time to sync SQLite to R2.

## Solution

1. Switch to `auto_stop_machines = "suspend"` for faster wake times (~100-500ms) via Firecracker snapshot restore
2. Add `kill_signal = "SIGTERM"` and `kill_timeout = 30` to allow graceful shutdown
3. Handle SIGTERM in FastAPI to flush pending writes and run WAL checkpoint before shutdown

## Context

### Current State
- `fly.staging.toml` has `auto_stop_machines = true` (equivalent to "stop")
- No `kill_signal` or `kill_timeout` configured (defaults: SIGINT, 5s)
- No signal handler in FastAPI for graceful shutdown
- Machine cold boots take 1-5s, causing slow first requests

### Target State
- Suspend mode: machine resumes from memory snapshot in ~100-500ms
- SIGTERM handler: flushes SQLite WAL, syncs to R2, then exits cleanly
- 30s grace period for shutdown tasks

### Relevant Files
- `src/backend/fly.staging.toml` — Add suspend + shutdown config
- `src/backend/app/main.py` — Add SIGTERM signal handler
- `src/backend/app/services/r2_storage.py` — May need sync-on-shutdown helper

### Related Tasks
- Depends on: T100 (Fly.io backend must be deployed)
- Related: T127 (R2 restore on startup — complementary)

### Technical Notes
- Suspend requires: memory <= 2GB (current config: 1024MB — fine)
- Suspend caveats: network connections are stale on resume (R2 client needs reconnect logic), clock may be briefly skewed
- SIGTERM handler should: close DB connections cleanly, run `PRAGMA wal_checkpoint(TRUNCATE)`, trigger R2 sync

## Implementation

### Steps
1. [ ] Update `fly.staging.toml`: change `auto_stop_machines = true` to `auto_stop_machines = "suspend"`
2. [ ] Add `kill_signal = "SIGTERM"` and `kill_timeout = 30` to `fly.staging.toml`
3. [ ] Add SIGTERM handler in `main.py` that performs WAL checkpoint and R2 sync
4. [ ] Test: verify machine suspends after idle period
5. [ ] Test: verify machine resumes quickly on next request
6. [ ] Test: verify data persists across suspend/resume cycles

### Logging Requirements
- Log on SIGTERM received: `[Shutdown] SIGTERM received, starting graceful shutdown`
- Log WAL checkpoint result: `[Shutdown] WAL checkpoint complete: {pages} pages`
- Log R2 sync status: `[Shutdown] R2 sync complete for {n} databases` or `[Shutdown] R2 sync failed: {error}`
- Log shutdown timing: `[Shutdown] Graceful shutdown completed in {n}s`
- Log on resume from suspend: `[Startup] Machine resumed (suspend mode)` with timestamp to detect clock skew

## Acceptance Criteria

- [ ] Machine suspends (not stops) after idle period
- [ ] Resume time < 1 second
- [ ] SIGTERM triggers clean SQLite WAL checkpoint
- [ ] R2 sync completes before machine fully shuts down
- [ ] No data loss across suspend/resume cycles
- [ ] All shutdown/resume events are logged with timing
