# Durable Export Architecture

## Problem Statement

The current export system requires the browser to stay open during the entire export process. If the user closes their browser:
- The export continues on the backend but the frontend loses visibility
- When the user returns, there's no way to discover completed exports
- Progress is ephemeral (WebSocket-only), not persisted to database
- Dual WebSocket connections (ExportButton + useExportWebSocket) cause race conditions

**User expectation:** Start an export, close browser, return next week, see the completed video.

## Design Principle

**WebSocket is optional, not required.**
- If connected: send real-time progress updates (nice UX)
- If disconnected: export continues silently, no errors logged
- When user returns: they see completed export in UI

The export must succeed regardless of WebSocket state.

## Current Architecture (Fragile)

```
┌─────────────┐    WebSocket     ┌─────────────┐
│  Frontend   │◄────────────────►│   Backend   │
│             │                  │             │
│ ExportButton│──HTTP POST──────►│ /api/export │
│ (local WS)  │◄───────────────── │   (sync)    │
│             │   video blob      │             │
│             │                  │             │
│ App.jsx     │                  │             │
│ (global WS) │◄───WebSocket─────│             │
└─────────────┘                  └─────────────┘
        │                               │
        └── Both WebSockets connect ────┘
            to same endpoint (redundant)
```

**Problems:**
1. Export is synchronous - HTTP request blocks until video is ready
2. Progress only visible via WebSocket (not persisted)
3. Dual WebSocket connections cause race conditions
4. No way to resume/discover exports after browser close
5. No way to cancel an export

## Target Architecture (Durable)

```
┌─────────────┐                  ┌─────────────┐
│  Frontend   │                  │   Backend   │
│             │                  │             │
│ Start Export│──POST /exports──►│ Create job  │
│             │◄─── job_id ──────│ Return ID   │
│             │                  │             │
│  WebSocket  │◄── progress ─────│ (optional)  │
│  (optional) │                  │             │
│             │                  │             │
│ On Return   │──GET /projects──►│ Check jobs  │
│             │◄── status ───────│             │
└─────────────┘                  └─────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  Background     │
                              │  Task Worker    │
                              │                 │
                              │ - Process video │
                              │ - Update DB     │
                              │ - Send WS prog  │
                              │   (if connected)│
                              └─────────────────┘
```

## Database Schema

### New Table: `export_jobs`

```sql
CREATE TABLE export_jobs (
    id TEXT PRIMARY KEY,              -- UUID like 'export_abc123'
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL,               -- 'framing' | 'overlay' | 'multi_clip'
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'complete' | 'error'
    error TEXT,                       -- Error message if failed

    -- Input data (JSON blob of export parameters)
    input_data TEXT NOT NULL,         -- Serialized export config

    -- Output references (set on completion)
    output_video_id INTEGER,          -- FK to working_videos or final_videos
    output_filename TEXT,             -- Path to output file

    -- Timing (only state transitions, not progress)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,             -- Set once when processing begins
    completed_at TIMESTAMP,           -- Set once when complete/error

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_export_jobs_project ON export_jobs(project_id);
CREATE INDEX idx_export_jobs_status ON export_jobs(status);
```

**Note:** No `progress` or `message` columns. Progress is ephemeral - only sent via WebSocket for real-time display. Database only tracks state transitions:
- `pending` → job created
- `processing` → job started (set `started_at`)
- `complete` → job finished (set `completed_at`, `output_video_id`)
- `error` → job failed (set `completed_at`, `error`)

## API Changes

### New Endpoints

#### `POST /api/exports`
Start an export job (returns immediately with job ID).

**Request:**
```json
{
  "project_id": 123,
  "type": "framing",
  "config": {
    "clips": [...],
    "keyframes": [...],
    "target_fps": 30,
    "export_mode": "FAST"
  }
}
```

**Response:**
```json
{
  "job_id": "export_abc123",
  "status": "pending",
  "message": "Export queued"
}
```

#### `GET /api/exports/{job_id}`
Get export job status (for reconnecting after page refresh).

**Response:**
```json
{
  "job_id": "export_abc123",
  "project_id": 123,
  "type": "framing",
  "status": "processing",
  "started_at": "2024-01-15T10:30:00Z"
}
```

Note: No `progress` field - progress is only available via WebSocket.
If `status` is `processing`, frontend should connect WebSocket for live updates.

#### `GET /api/projects/{project_id}/exports`
List exports for a project (for discovering completed exports on page load).

**Response:**
```json
{
  "exports": [
    {
      "job_id": "export_abc123",
      "type": "framing",
      "status": "complete",
      "completed_at": "2024-01-15T10:45:00Z",
      "output_video_id": 456
    }
  ]
}
```

#### `DELETE /api/exports/{job_id}`
Cancel a pending/processing export.

#### `GET /api/exports/{job_id}/download`
Download the completed export output.

### Modified Endpoints

The existing endpoints (`/api/export/upscale`, `/api/export/overlay`, etc.) become internal and are called by the background worker, not directly by the frontend.

## Backend Implementation

### Background Task System

Use Python's `asyncio` with a task queue. Options:
1. **Simple:** In-memory task queue with `asyncio.create_task()` (loses jobs on restart)
2. **Better:** SQLite-backed queue (jobs persist across restarts)
3. **Production:** Celery/Redis (overkill for single-user app)

Recommendation: SQLite-backed queue (option 2) - durable, simple, no extra dependencies.

### Worker Flow

```python
async def process_export_job(job_id: str):
    """Background task that processes an export job."""
    job = get_export_job(job_id)

    try:
        # DB write #1: Mark as processing
        update_job_status(job_id, 'processing', started_at=now())

        config = json.loads(job['input_data'])

        # Progress callback - WebSocket only, no DB writes
        def progress_callback(progress: int, message: str):
            # Send via WebSocket if anyone is listening (fire-and-forget)
            try_send_websocket_progress(job_id, progress, message)

        # Process based on type
        if job['type'] == 'framing':
            output_path = await process_framing_export(config, progress_callback)
        elif job['type'] == 'overlay':
            output_path = await process_overlay_export(config, progress_callback)

        # DB write #2: Mark as complete
        update_job_complete(job_id, output_path)

    except Exception as e:
        # DB write #2 (alt): Mark as error
        update_job_error(job_id, str(e))
```

**Only 2 DB writes per export:**
1. `started_at` when processing begins
2. `completed_at` + `output_video_id` (or `error`) when done

### Graceful WebSocket Progress

The key change: WebSocket send is fire-and-forget with no error logging if disconnected.

```python
def try_send_websocket_progress(export_id: str, progress: int, message: str):
    """Send progress via WebSocket if connected. Silent no-op if not."""
    if export_id not in manager.active_connections:
        return  # No one listening, that's fine

    # Send to all connected clients (if any)
    asyncio.create_task(
        manager.send_progress(export_id, {
            "progress": progress,
            "message": message,
            "status": "processing"
        })
    )
```

Update `websocket.py` to not log errors when no connections:

```python
async def send_progress(self, export_id: str, data: dict):
    """Broadcast progress. Silent if no connections."""
    if export_id not in self.active_connections:
        return  # No error, no log - this is expected

    connections = self.active_connections[export_id]
    # ... send to each connection
```

### Startup Recovery

On backend startup, check for orphaned jobs:

```python
async def recover_orphaned_jobs():
    """Handle jobs that were processing when server stopped."""
    orphaned = get_jobs_by_status('processing')
    for job in orphaned:
        # Option 1: Mark as error (safe)
        update_job_status(job['id'], 'error', error='Server restarted during processing')

        # Option 2: Restart the job (risky - might duplicate work)
        # restart_job(job['id'])
```

## Frontend Implementation

### Consolidate to Single WebSocket

1. Delete `useExportWebSocket` hook from App.jsx (the global one)
2. Keep `ExportButton`'s WebSocket for real-time progress
3. WebSocket is for UX only - not required for export to succeed

### New Export Flow

```javascript
// ExportButton.jsx
const handleExport = async () => {
  // 1. Start export job (returns immediately)
  const { job_id } = await api.post('/exports', {
    project_id: selectedProjectId,
    type: 'framing',
    config: { clips, keyframes, targetFps, exportMode }
  });

  // 2. Store job_id in store (persisted)
  setExportingJobId(job_id);

  // 3. Connect WebSocket for real-time progress (optional enhancement)
  connectWebSocket(job_id);
};

// WebSocket connection - same as before, but now optional
const connectWebSocket = (jobId) => {
  const ws = new WebSocket(`ws://localhost:8000/ws/export/${jobId}`);

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    setProgress(data.progress);
    setMessage(data.message);

    if (data.status === 'complete') {
      handleExportComplete(data);
      ws.close();
    } else if (data.status === 'error') {
      handleExportError(data.error);
      ws.close();
    }
  };

  // If WebSocket fails, no problem - export continues on backend
  // User will see result when they return
  ws.onerror = () => {
    console.log('WebSocket disconnected - export continues on server');
  };
};
```

### On Page Load: Discover Completed Exports

When user returns (possibly after closing browser), check for exports:

```javascript
// ProjectsScreen.jsx or when loading a project
useEffect(() => {
  const checkExports = async () => {
    // Get project with its export status
    const project = await api.get(`/projects/${projectId}`);

    // Check for pending export
    if (project.pending_export) {
      // Reconnect WebSocket to get live updates
      setExportingJobId(project.pending_export.job_id);
      setProgress(project.pending_export.progress);
      connectWebSocket(project.pending_export.job_id);
    }

    // Check for newly completed export (since last visit)
    if (project.working_video_id && !seenWorkingVideoIds.has(project.working_video_id)) {
      showNotification('Export completed! Ready to edit.');
    }
  };
  checkExports();
}, [projectId]);
```

### Store Changes

```javascript
// exportStore.js - persist export job ID
export const useExportStore = create(
  persist(
    (set) => ({
      // Current export job (persisted so we can reconnect after page refresh)
      currentExportJobId: null,
      setCurrentExportJobId: (id) => set({ currentExportJobId: id }),

      // Progress (ephemeral, from WebSocket)
      progress: 0,
      message: '',
      setProgress: (progress, message) => set({ progress, message }),
    }),
    { name: 'export-store' }
  )
);
```

## Migration Path

### Phase 1: Backend Infrastructure (Non-Breaking)
1. Add `export_jobs` table
2. Add new endpoints (`POST /exports`, `GET /exports/{id}`, etc.)
3. Implement background task worker
4. Keep existing sync endpoints working

### Phase 2: Frontend Migration
1. Update ExportButton to use new async flow
2. Add polling logic
3. Remove dual WebSocket
4. Add page-load export discovery

### Phase 3: Cleanup
1. Remove old sync export endpoints (or keep as internal)
2. Remove `useExportWebSocket` hook
3. Update tests

## Implementation Status (2026-01-08)

**COMPLETED** - The durable export architecture has been implemented:

### Backend (Done)
- ✅ Added `export_jobs` table to `database.py`
- ✅ Created `routers/exports.py` with durable job API
- ✅ Created `services/export_worker.py` for background processing
- ✅ Updated `websocket.py` to be silent on disconnections
- ✅ Registered router in `main.py` with orphaned job recovery on startup

### Frontend (Done)
- ✅ Deleted `useExportWebSocket.js` (removed dual WebSocket)
- ✅ Updated `App.jsx` to remove hook usage
- ✅ Added polling fallback to `ExportButton.jsx`
- ✅ Updated `ProjectsScreen.jsx` to discover in-progress exports on load

### Remaining Work (Future)
- Migrate `ExportButton` to use async API endpoints (currently still uses sync)
- Add cancel export functionality

## Testing Checklist

- [ ] Start export, keep browser open - see real-time progress via WebSocket
- [ ] Start export, close browser, return - see completed video
- [ ] Start export, refresh page mid-export - reconnects WebSocket, shows current progress
- [ ] Start export, server restarts - export marked as error, user sees error on return
- [ ] Export error handling (disk full, invalid video, etc.) - user sees error message
- [ ] WebSocket disconnects mid-export - no errors logged, export continues
- [ ] Cancel in-progress export (optional, nice-to-have)

## File Changes Summary

### Backend (New/Modified)
- `app/database.py` - Add export_jobs table
- `app/routers/exports.py` - New router for export jobs API
- `app/services/export_worker.py` - Background task worker
- `app/websocket.py` - Make missing connections silent (no error log)
- `app/routers/export/framing.py` - Refactor to be called by worker
- `app/routers/export/overlay.py` - Refactor to be called by worker
- `app/main.py` - Register new router, start worker on startup

### Frontend (New/Modified)
- `src/hooks/useExportWebSocket.js` - DELETE (consolidate to ExportButton)
- `src/components/ExportButton.jsx` - Use new async API, keep single WebSocket
- `src/App.jsx` - Remove useExportWebSocket hook
- `src/stores/exportStore.js` - Persist job ID for reconnection
- `src/screens/ProjectsScreen.jsx` - Check for completed exports on load

## Estimated Scope

- Backend: ~400 lines new code, ~150 lines refactored
- Frontend: ~100 lines new code, ~200 lines removed
- Tests: ~150 lines new tests

This is a medium-sized refactor that significantly improves reliability and user experience.

## Key Simplifications

**1. WebSocket stays, but becomes optional:**
- Connected → show real-time progress
- Disconnected → export continues silently, no errors
- User returns → check database for completion status

**2. Database stores state transitions only:**
- `pending` → `processing` → `complete`/`error`
- No intermediate progress writes (0%, 10%, 45%, etc.)
- Only 2-3 DB writes per export total

**3. Single WebSocket:**
- Delete `useExportWebSocket` (global)
- Keep ExportButton's WebSocket (local)
- No more race conditions from dual connections

**Result:** Simple, durable, efficient.
