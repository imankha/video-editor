# T2460: Pending Status Recovery

**Status:** TODO
**Impact:** 8
**Complexity:** 1
**Created:** 2026-05-04
**Updated:** 2026-05-04

## Problem

`auto_export_game()` sets `auto_export_status = 'pending'` before starting work, then skips re-entry if status is already `pending` or `complete`. If the machine dies mid-export (Fly.io auto-suspend, OOM, deploy), the game is stuck at `pending` forever — no retry on any future sweep.

This was observed on 2026-05-04: Fly.io auto-suspended the staging machine during a 20-minute download, leaving the game at `pending` with no recap and no brilliant clips.

## Solution

On app startup, reset any `pending` auto_export_status back to `NULL` so the next sweep retries them. This is safe because:

- `pending` means "in progress on this machine" — after a restart, no work is in progress
- Any partial uploads from a killed export are harmless (orphaned R2 objects get overwritten on retry)
- The sweep is idempotent — re-running auto_export for a game that partially completed just redoes the work

## Context

### Relevant Files
- `src/backend/app/services/auto_export.py:47-53` — the `pending` guard and status set
- `src/backend/app/services/sweep_scheduler.py:38-42` — `start_sweep_loop()` called from app startup
- `src/backend/app/main.py:325-327` — startup event that calls `start_sweep_loop()`

### Related Tasks
- T2450 (Presigned URL) — reduces export time so pending-death window shrinks
- T2470 (Sweep Keepalive) — prevents auto-suspend that causes the death

## Implementation

### Steps
1. [ ] In `start_sweep_loop()` (or a new `_reset_stale_pending()` helper), before starting the loop: query all profile DBs for `auto_export_status = 'pending'` and reset to `NULL`
2. [ ] Log each reset so it's visible: `[Sweep] Reset stale pending export: game={id}`

### Alternative (simpler)
Instead of querying profile DBs at startup, change the guard in `auto_export_game()` to only skip `complete` (not `pending`). This means re-entry always retries pending exports. The downside is duplicate work if the sweep runs twice concurrently — but it's single-threaded via `do_sweep()`, so this can't happen.

## Acceptance Criteria

- [ ] After machine restart, games stuck at `pending` are retried by the next sweep
- [ ] Games at `complete` are still skipped (no duplicate work)
- [ ] Reset is logged for observability
