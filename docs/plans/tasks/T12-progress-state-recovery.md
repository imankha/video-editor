# T12: Progress Bar State Recovery After Refresh

**Status:** IN_PROGRESS
**Impact:** HIGH
**Complexity:** MEDIUM
**Created:** 2026-02-08
**Updated:** 2026-02-08

## Problem

When a user refreshes the browser or navigates away during an export:

1. **Progress bar disappears** - No way to see the ongoing export status
2. **No completion notification** - If export finishes while away, user doesn't see the envelope/toast
3. **Lost context** - User doesn't know if export succeeded or failed

This applies to ALL export types (annotate, framing, overlay) with both `MODAL_ENABLED=true` and `MODAL_ENABLED=false`.

## Solution

Implement export state persistence and recovery:

1. **Backend**: Track active exports in the database with progress state
2. **Frontend**: On page load, query active exports and reconnect WebSocket
3. **Completion**: Show envelope/toast for any exports that completed while away

## Context

### Background

The WebSocket-based progress (T10) works well for live exports, but state is lost on refresh. The infrastructure for job recovery already exists for Modal exports (`/api/exports/active` endpoint), but it's not fully utilized for:

- Annotate exports (no projectId, so ignored by exportStore)
- Reconnecting to in-progress exports
- Showing completion notifications for finished exports

### Current Architecture

**Backend:**
- `export_jobs` table tracks Modal exports with `job_id`, `status`, `progress`
- `/api/exports/active` returns pending/processing exports
- WebSocket `/ws/export/{export_id}` provides real-time updates

**Frontend:**
- `useExportRecovery.js` fetches active exports on load
- `ExportWebSocketManager.js` manages WebSocket connections
- `exportStore.js` tracks active exports (but ignores those without projectId)

### Relevant Files

**Backend:**
- `src/backend/app/routers/exports.py` - Active exports endpoint
- `src/backend/app/services/export_worker.py` - Job recovery logic
- `src/backend/app/websocket.py` - WebSocket connection manager
- `src/backend/app/routers/annotate.py` - Annotate export (needs job tracking)

**Frontend:**
- `src/frontend/src/hooks/useExportRecovery.js` - Recovery on page load
- `src/frontend/src/services/ExportWebSocketManager.js` - WebSocket manager with `recoverConnections()`
- `src/frontend/src/stores/exportStore.js` - Export state (ignores non-project exports)
- `src/frontend/src/components/GlobalExportIndicator.jsx` - Shows active exports

**Database:**
- `export_jobs` table schema (job_id, project_id, type, status, progress, etc.)

### Related Tasks
- Depends on: T10 (Progress Bar Improvements) - DONE
- Related to: T11 (Local GPU Progress)
- Related to: T40 (Stale Session Detection)

### Technical Notes

**Issue 1: Annotate exports have no projectId**
```javascript
// exportStore.js:134-136
if (!progress.projectId) {
  console.warn(`[ExportStore] Received progress for unknown export ${exportId} without projectId - ignoring`);
  return state;
}
```
Annotate exports don't have a projectId, so they're ignored by the store.

**Issue 2: No database tracking for annotate exports**
Annotate exports don't create an `export_jobs` record, so they can't be recovered.

**Issue 3: Completion notifications**
Need to detect exports that completed while user was away and show toast/envelope.

### Proposed Architecture

1. **Backend changes:**
   - Create `export_jobs` record for ALL export types (including annotate)
   - Add `completed_at` timestamp to track when export finished
   - API to mark exports as "acknowledged" so we don't show duplicate notifications

2. **Frontend changes:**
   - Modify `exportStore.js` to handle exports without projectId (use export type as fallback)
   - On load: fetch active exports, reconnect WebSockets, show completion notifications
   - Store "last seen" timestamp to know which completions are new

## Implementation

### Steps
1. [x] Add export_jobs record creation to annotate export endpoint
2. [x] Modify exportStore to handle exports without projectId
3. [x] Update useExportRecovery to reconnect WebSockets for in-progress exports
4. [x] Add completion notification logic for exports finished while away
5. [x] Add "acknowledged" field to prevent duplicate notifications
6. [ ] Test with browser refresh during Modal export
7. [ ] Test with browser refresh during local FFmpeg export
8. [ ] Test completion notification when export finishes while on different page

### Progress Log

**2026-02-08** - Initial implementation complete:
- Backend: Added export_jobs tracking for annotate exports with game_id/game_name
- Backend: Added /api/exports/unacknowledged endpoint for completed exports
- Backend: Added /api/exports/acknowledge endpoint for preventing duplicates
- Backend: Added acknowledged_at column to export_jobs table
- Frontend: exportStore now handles annotate exports with gameId
- Frontend: useExportRecovery fetches and notifies about completed exports
- All 333 backend tests pass

## Acceptance Criteria

- [ ] Refreshing browser during export shows progress bar with current state
- [ ] Progress bar reconnects to WebSocket and continues updating
- [ ] Export completion while away shows envelope/toast on return
- [ ] Works for annotate, framing, and overlay exports
- [ ] Works with both `MODAL_ENABLED=true` and `MODAL_ENABLED=false`
- [ ] Multiple concurrent exports all show their status
- [ ] Completion notifications don't duplicate on multiple refreshes
