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

### Task 6: Unified Notification System

**Priority:** High (UX/Architecture)
**Complexity:** Medium-High
**Status:** PLANNED

#### Problem

The app currently has fragmented notification approaches:
- `ExportWebSocketManager` - dedicated WebSocket per export job
- `/ws/extractions` - broadcast WebSocket for clip extraction events
- Polling in some places (legacy)
- Scattered UI indicators (progress bars in project cards, global export indicator, etc.)
- No persistent notification history or "inbox"

This leads to:
- Duplicate WebSocket connection logic
- Inconsistent user feedback across features
- No way to see past notifications or missed events
- Complex debugging when notifications fail

#### Solution: Consolidated Notification Service

##### 1. Backend: Unified WebSocket Hub (`/ws/notifications`)

Single WebSocket connection per client that receives ALL notification types:

```python
# Notification types
class NotificationType(str, Enum):
    # Extraction
    EXTRACTION_STARTED = "extraction_started"
    EXTRACTION_PROGRESS = "extraction_progress"
    EXTRACTION_COMPLETE = "extraction_complete"
    EXTRACTION_FAILED = "extraction_failed"

    # Export (framing/overlay)
    EXPORT_STARTED = "export_started"
    EXPORT_PROGRESS = "export_progress"
    EXPORT_COMPLETE = "export_complete"
    EXPORT_FAILED = "export_failed"

    # Upload
    UPLOAD_STARTED = "upload_started"
    UPLOAD_PROGRESS = "upload_progress"
    UPLOAD_COMPLETE = "upload_complete"
    UPLOAD_FAILED = "upload_failed"

    # General
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"

# Message format
{
    "id": "uuid",
    "type": "extraction_complete",
    "timestamp": "2024-01-15T10:30:00Z",
    "title": "Clip Extracted",
    "message": "Brilliant Interception is ready",
    "data": {
        "clip_id": 260,
        "project_id": 45,
        "filename": "abc123.mp4"
    },
    "progress": null,  # or 0-100 for progress events
    "dismissible": true,
    "auto_dismiss_ms": 5000,  # null = persistent
    "actions": [  # optional action buttons
        {"label": "Open Project", "action": "open_project", "payload": {"id": 45}}
    ]
}
```

##### 2. Backend: Notification Service

```
src/backend/app/services/notification_service.py
```

- `NotificationManager` class (singleton)
- `broadcast(notification)` - send to all connected clients
- `send_to_user(user_id, notification)` - when multi-user (future)
- `send_progress(task_id, progress, message)` - helper for progress updates
- Connection tracking with heartbeat/keepalive
- Optional: Store notifications in DB for history (last 24h)

##### 3. Frontend: NotificationStore (Zustand)

```
src/frontend/src/stores/notificationStore.js
```

```javascript
const useNotificationStore = create((set, get) => ({
  // Connection state
  connected: false,
  reconnecting: false,

  // Active notifications (shown in UI)
  notifications: [],  // { id, type, title, message, progress, timestamp, ... }

  // Progress tracking (by task ID)
  activeProgress: {},  // { taskId: { progress, message, type } }

  // Notification history (persisted in localStorage)
  history: [],  // last 50 notifications

  // Unread count (for badge)
  unreadCount: 0,

  // Actions
  connect: () => { /* WebSocket connection */ },
  disconnect: () => {},
  addNotification: (notification) => {},
  dismissNotification: (id) => {},
  markAllRead: () => {},
  clearHistory: () => {},
}));
```

##### 4. Frontend: NotificationService

```
src/frontend/src/services/NotificationService.js
```

- Singleton WebSocket manager
- Auto-reconnect with exponential backoff
- Heartbeat/keepalive
- Dispatches to `notificationStore`
- Initializes on app mount, persists across navigation

##### 5. Frontend: UI Components

**NotificationToast** - Individual toast notification
```jsx
<NotificationToast
  notification={notification}
  onDismiss={handleDismiss}
  onAction={handleAction}
/>
```

**NotificationContainer** - Toast stack (bottom-right)
```jsx
<NotificationContainer maxVisible={5} position="bottom-right" />
```

**NotificationBell** - Header icon with unread badge
```jsx
<NotificationBell />  // Shows badge, opens dropdown/panel on click
```

**NotificationPanel** - Slide-out panel with history
```jsx
<NotificationPanel />  // Full notification history, mark as read, clear
```

**ProgressIndicator** - Reusable progress component
```jsx
<ProgressIndicator
  taskId="export-123"
  showInline={true}  // or as toast
/>
```

##### 6. Migration Path

1. **Phase 1: Create infrastructure**
   - Add `NotificationService` and `notificationStore`
   - Add `/ws/notifications` endpoint
   - Add basic toast UI components

2. **Phase 2: Migrate extraction notifications**
   - Remove `/ws/extractions` endpoint
   - Update `modal_queue.py` to use `NotificationService`
   - Update `ProjectsScreen` to use `notificationStore`

3. **Phase 3: Migrate export notifications**
   - Keep `ExportWebSocketManager` temporarily for progress
   - Route completion/error events through unified system
   - Eventually consolidate all progress into unified WebSocket

4. **Phase 4: Add notification panel**
   - Add `NotificationBell` to header
   - Add `NotificationPanel` with history
   - Add localStorage persistence

##### 7. Benefits

- **Single WebSocket connection** - reduced server load, simpler debugging
- **Consistent UX** - all notifications look and behave the same
- **Notification history** - users can see what they missed
- **Action buttons** - "Open Project", "Retry", etc.
- **Progress consolidation** - one place to see all active tasks
- **Extensible** - easy to add new notification types

##### 8. Files to Create/Modify

**New Files:**
- `src/backend/app/services/notification_service.py`
- `src/frontend/src/services/NotificationService.js`
- `src/frontend/src/stores/notificationStore.js`
- `src/frontend/src/components/notifications/NotificationToast.jsx`
- `src/frontend/src/components/notifications/NotificationContainer.jsx`
- `src/frontend/src/components/notifications/NotificationBell.jsx`
- `src/frontend/src/components/notifications/NotificationPanel.jsx`
- `src/frontend/src/components/notifications/ProgressIndicator.jsx`

**Modify:**
- `src/backend/app/main.py` - add `/ws/notifications` endpoint
- `src/backend/app/services/modal_queue.py` - use notification service
- `src/backend/app/services/export_worker.py` - use notification service
- `src/frontend/src/App.jsx` - initialize NotificationService, add NotificationContainer
- `src/frontend/src/screens/ProjectsScreen.jsx` - remove extraction WebSocket, use store

**Deprecate (eventually):**
- `src/backend/app/websocket.py` - merge into notification_service
- `src/frontend/src/services/ExportWebSocketManager.js` - merge into NotificationService

---

### Task 7: Remove Outline from Yellow Highlight Overlay

**Priority:** Medium (Visual Polish)
**Complexity:** Low
**Status:** PLANNED

#### Problem
The yellow highlight overlay that gets baked into exported videos currently has a thick outline/border. This outline is not desired.

#### Solution
Remove the stroke/outline from the yellow highlight rendering in the overlay baking process. The highlight should be a solid yellow fill without any border.

---

### Task 8: Store Consolidation - Eliminate Duplicate State

**Priority:** High (Architecture/Bug Prevention)
**Complexity:** Medium
**Status:** PLANNED

#### Problem
Multiple Zustand stores contain duplicate state (`workingVideo`, `clipMetadata`) causing sync bugs when one store is written to but another is read from. This has caused multiple bugs where data is written to `projectDataStore` but read from `overlayStore`.

#### Solution
Establish single source of truth:
- Project-level data (`workingVideo`, `clipMetadata`, `clips`) → `projectDataStore` only
- Mode-specific UI state (`effectType`, `highlightRegions`) → `overlayStore`
- Remove duplicates, update all consumers to read from the owning store

See [cloud_migration/tasks/store-consolidation.md](cloud_migration/tasks/store-consolidation.md) for detailed implementation plan.

---

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
