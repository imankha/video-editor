# T1710: Fix duplicate _sync_after_export causing R2 sync failure after export

**Status:** TODO
**Impact:** 10
**Complexity:** 2
**Created:** 2026-04-23
**Updated:** 2026-04-23

## Problem

Every successful export silently fails to sync the profile database to R2. Users' framing/overlay data is lost on machine restart.

In `export_worker.py`, a second definition of `_sync_after_export(user_id, profile_id, config)` at line 217 **shadows** the first `_sync_after_export(config)` at line 113. Python uses the last definition at module level.

When `process_export_job` calls `_sync_after_export(config)` at line 191:
1. It invokes the 3-arg version (line 217) with `user_id=config` (a dict)
2. `profile_id` and `config` are missing -> **TypeError**
3. The TypeError is caught by the `except Exception` at line 193
4. `update_job_error(job_id, ...)` overwrites the "complete" status set at line 185
5. `_sync_after_export(config)` is called again at line 214 in the except block -> same TypeError
6. **R2 sync never happens**

The export succeeds locally (video uploaded to R2 as a separate step, DB committed to local SQLite), but the profile.sqlite (containing `working_video_id`, export job status, etc.) is never uploaded to R2. On machine restart (Fly.io has no persistent volume), the stale R2 copy is restored -- framing data is lost.

**Reported by:** sarkarati@gmail.com -- reels reverted to "Not Started" after machine redeployment on 2026-04-23.

## Solution

Delete the dead second definition at line 217. The first definition (line 113) correctly reads `user_id` and `profile_id` from ContextVars and handles both profile and user DB sync.

Also: the TypeError in `_sync_after_export` causes the except block to overwrite the job's "complete" status with an error. This means export jobs are marked as "failed" even though the export succeeded. After removing the duplicate, exports will correctly stay marked as "complete".

## Context

### Relevant Files
- `src/backend/app/services/export_worker.py` - Lines 113-139 (correct definition), 191 (call site), 214 (call site in except), 217-238 (duplicate definition to delete)

### Related Tasks
- T940: Original task that added R2 sync after export
- T1539: Per-resource R2 upload locks (interacts with sync)

### Technical Notes
- The first definition (line 113) uses ContextVars (`get_current_user_id()`, `get_current_profile_id()`) which are set by the middleware before the background task is dispatched
- The second definition (line 217) was likely a refactor attempt that was never wired up -- no caller passes 3 args
- Orphaned R2 video files exist for affected users (videos uploaded during export, but no DB rows reference them after R2 restore)

## Implementation

### Steps
1. [ ] Delete the duplicate `_sync_after_export` definition at lines 217-238
2. [ ] Verify import check passes
3. [ ] Write a test that verifies `_sync_after_export(config)` calls `sync_db_to_r2_explicit` (not TypeError)
4. [ ] Deploy to production

## Acceptance Criteria

- [ ] Only one `_sync_after_export` definition exists
- [ ] `_sync_after_export(config)` successfully syncs profile.sqlite to R2
- [ ] Export jobs remain marked as "complete" (not overwritten to "error")
- [ ] Import check passes
- [ ] Backend test covers the fix
