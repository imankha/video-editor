# T248: Framing Export Sync Failure — Working Video Not Persisted

## Status: TODO

## Problem Statement

After a framing export completes successfully (WebSocket reports `{progress: 100, status: complete}`), the `has_working_video` flag on the project remains false. The UI shows "Loading working video..." and "Sync failed — click to retry".

This is a **real backend bug** separate from E2E test reliability (T20). T20 works around this by mocking the export pipeline; this task fixes the actual issue.

## Evidence

From E2E test run (Feb 19, 2026):

```
[Browser] log: [ExportButtonContainer] Export completed via WebSocket: {progress: 100, status: complete}
[Full] No working video found yet (attempt 1/5), waiting...
[Full] No working video found yet (attempt 2/5), waiting...
... (all 5 attempts fail)
```

Screenshot shows:
- "Loading working video..." spinner
- "Sync failed — click to retry" badge
- "Export required for overlay mode" message

## Suspected Root Cause

The framing export endpoint (`framing.py:785-820`) does this after processing:

```python
# 1. Insert working_videos record
# 2. UPDATE projects SET working_video_id = ?
# 3. conn.commit()
# 4. Send WebSocket {progress: 100, status: complete}
```

The WebSocket `complete` message was received (step 4), which means step 3 likely succeeded. But `GET /api/projects` still shows `has_working_video=false`. Possible causes:

1. **R2 sync failure corrupts or rolls back local DB** — The "Sync failed" badge suggests R2 sync ran after the commit and may have overwritten the local DB with a stale version from R2
2. **Race condition**: The sync process downloads a stale DB from R2 after the local commit, overwriting the `working_video_id` update
3. **The test user's DB was never synced to R2**, so when sync tries to download after export, it fails and the error cascades

## Investigation Steps

1. Check backend logs during the export to see if sync runs during/after the DB commit
2. Check the R2 sync logic — does it download the DB from R2 and overwrite local? If so, does it handle concurrent writes?
3. Check if the E2E test user's DB exists in R2 at all (fresh user ID generated per test run)
4. Test manually: trigger a framing export, watch backend logs, check if `working_video_id` is set in the DB immediately after commit, then check if sync overwrites it

## Key Files

- `src/backend/app/routers/export/framing.py:785-820` — Post-export DB write
- `src/backend/app/routers/projects.py:279` — `has_working_video` query
- `src/backend/app/services/r2_storage.py` — R2 sync logic
- `src/backend/app/database.py` — DB connection and sync mechanism

## Classification

**Stack Layers:** Backend
**Files Affected:** ~2-3 files
**LOC Estimate:** Unknown (depends on root cause)
**Test Scope:** Backend + Frontend E2E (after T20 mocks are in place)

## Dependencies

- **Blocked by T20**: Need mock export mode working first so we can iterate on the real export path without 10-min waits
- After T20 is done, can test the real export path and debug this issue with actual GPU processing

## Success Metrics

- Framing export with real processing sets `has_working_video=true` on the project
- No "Sync failed" error after export completion
- `GET /api/projects` returns correct `has_working_video` within 5 seconds of export completion
