# Pending Tasks

## Completed Tasks

### ~~Task 1: Direct Browser-to-R2 Video Uploads~~ ✅ COMPLETED

**Priority:** High (Performance)
**Complexity:** Medium
**Status:** COMPLETED

#### Implementation Summary

**Backend Changes** ([games.py](../../src/backend/app/routers/games.py)):
- Added `GET /api/games/{game_id}/upload-url` - Returns presigned PUT URL for direct R2 upload
- Added `POST /api/games/{game_id}/confirm-video` - Confirms upload completed and updates game record

**Frontend Changes** ([useGames.js](../../src/frontend/src/hooks/useGames.js)):
- Updated `uploadGameVideo()` to:
  1. First request presigned URL from backend
  2. If R2 enabled, upload directly to R2 (bypasses backend)
  3. Confirm upload with backend
  4. Fall back to traditional upload if R2 not available

**Benefits:**
- ~50% faster uploads for large files (no double-transfer through backend)
- Progress tracking still works (XHR upload progress)
- Automatic fallback for non-R2 environments

---

### ~~Task 2: Games List Not Refreshing After Upload~~ ✅ COMPLETED

**Priority:** Medium (UX Bug)
**Complexity:** Low
**Status:** COMPLETED

#### Root Cause
Each `useGames()` hook call creates an independent state instance. When AnnotateContainer's `uploadGameVideo()` completed and called `fetchGames()`, it only updated its own state - ProjectsScreen had a separate instance that didn't get notified.

#### Implementation Summary

**New Store** ([gamesStore.js](../../src/frontend/src/stores/gamesStore.js)):
- Created minimal Zustand store with `gamesVersion` counter
- `invalidateGames()` increments version to signal changes

**useGames.js Changes**:
- Now calls `invalidateGames()` after any mutation (create, upload, update, delete)
- This notifies all components using `useGames()` that data has changed

**ProjectsScreen Changes**:
- Watches `gamesVersion` from the store
- When version changes, refetches games list
- Games list now updates immediately after upload completes

---

### ~~Task 3: Durable Export Architecture~~ ✅ COMPLETED

**Priority:** High (Reliability)
**Complexity:** High
**Status:** COMPLETED

#### Implementation Summary

Created a robust export system that survives browser closes and page refreshes:

**Database** ([database.py](../../src/backend/app/database.py)):
- Added `export_jobs` table tracking job state (pending/processing/complete/error)
- Jobs indexed by project_id and status for fast queries

**Export Jobs Router** ([exports.py](../../src/backend/app/routers/exports.py)):
- `POST /api/exports` - Start export job, returns job_id immediately
- `GET /api/exports/{job_id}` - Get job status
- `GET /api/exports/active` - List all active (pending/processing) exports
- `GET /api/exports/recent` - List exports from last N hours
- `DELETE /api/exports/{job_id}` - Cancel pending/processing job
- Automatic cleanup of stale exports (>15 minutes in processing state)

**Export Worker** ([export_worker.py](../../src/backend/app/services/export_worker.py)):
- Background task processing via FastAPI BackgroundTasks
- WebSocket progress updates (fire-and-forget, doesn't block if disconnected)
- Only 2 DB writes per job: started + completed/error
- Progress is ephemeral (WebSocket only), state is durable (database)

**Frontend Recovery** ([useExportRecovery.js](../../src/frontend/src/hooks/useExportRecovery.js)):
- On app load, queries `/api/exports/active` to find running exports
- Reconnects WebSocket for progress tracking
- Shows GlobalExportIndicator for any active exports

---

### ~~Task 4: Unit Test Improvements~~ ✅ COMPLETED

**Priority:** Medium (Quality)
**Complexity:** Low
**Status:** COMPLETED

Fixed all unit tests (264 passing, 0 skipped, 0 failures):

- Fixed `test_version_filtering.py` - Added missing `game_id` and `source_type` columns to test fixture
- Fixed `test_sr_models.py` - Renamed `test_model` to `run_model_test` (it's a CLI utility, not a test)
- Fixed `test_ffmpeg_errors.py` - Added dynamic FFmpeg detection instead of hardcoded skip
- Fixed `test_highlight_image_validation.py` - Dynamic database lookup for test data
- Fixed `test_api.py` integration tests - Updated endpoints, removed Unicode chars, added server checks
- Deleted redundant tests from `test_highlight_persistence_bug.py`

---

### ~~Task 5: Documentation Update~~ ✅ COMPLETED

**Priority:** Low (Maintenance)
**Complexity:** Low
**Status:** COMPLETED

Updated documentation to match current codebase:

- **README.md**: Added missing stores, hooks, routers, database columns, tables
- **MANUAL_TEST.md**: Updated test count (31 tests), status table, features list
- **DEVELOPMENT.md**: Fixed broken Unicode characters in section headers
- Removed references to non-existent files (prompt_preamble, CODE_SMELLS.md)
- Fixed incorrect file path references

---

## Future Tasks

### Resumable Uploads for Very Large Files
For files >5GB, consider implementing multipart uploads with resume capability.

### Upload Progress in Status Bar
Show global upload progress indicator when video upload is in progress.

### Cloud Deployment (Modal GPU + Fly.io)
See [cloud_migration/PLAN.md](cloud_migration/PLAN.md) for detailed migration plan:
- Phase 2: Modal GPU integration (current focus)
- Phase 3: Fly.io + Cloudflare Pages deployment
  - Task 16: Performance profiling
  - Task 17: Stale session detection (reject conflicting writes, UI feedback)
- Phase 4: User management & payments (optional)

**Note**: The durable export infrastructure (Task 3 above) is already in place. Modal integration should:
- Add `MODAL_ENABLED` environment variable toggle
- Modify `export_worker.py` to call Modal functions when enabled
- Keep WebSocket progress updates (Modal can send progress via callbacks)
- Fall back to local FFmpeg when `MODAL_ENABLED=false`
