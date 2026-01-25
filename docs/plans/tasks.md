# Pending Tasks

## ~~Task 1: Direct Browser-to-R2 Video Uploads~~ ✅ COMPLETED

**Priority:** High (Performance)
**Complexity:** Medium
**Status:** COMPLETED

### Implementation Summary

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

## ~~Task 2: Games List Not Refreshing After Upload~~ ✅ COMPLETED

**Priority:** Medium (UX Bug)
**Complexity:** Low
**Status:** COMPLETED

### Root Cause
Each `useGames()` hook call creates an independent state instance. When AnnotateContainer's `uploadGameVideo()` completed and called `fetchGames()`, it only updated its own state - ProjectsScreen had a separate instance that didn't get notified.

### Implementation Summary

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

## Future Tasks

### Resumable Uploads for Very Large Files
For files >5GB, consider implementing multipart uploads with resume capability.

### Upload Progress in Status Bar
Show global upload progress indicator when video upload is in progress.
