# T254: Export Network Resilience — Survive Disconnects During Export

**Status:** DONE
**Impact:** 6
**Complexity:** 4
**Created:** 2026-03-12

## Problem

When the user loses network connectivity during a framing or overlay export, the export immediately fails with an error in the UI — even though the backend continues rendering unaffected. The export runs on Modal (cloud GPU) or the backend server, completely independent of the client. The client's only role after the POST succeeds is to **monitor progress via WebSocket**. A network drop should show "Disconnected — reconnecting..." not "Export failed."

**User-reported scenario:** User cut internet while exporting and got a hard "Export failed" error. The export was still running server-side.

### Root Cause Analysis

The failure happens because `ExportButtonContainer.handleExport()` wraps the entire export flow (POST + WebSocket monitoring) in a single try/catch. When the network drops:

1. **If POST hasn't returned yet** — `axios.post` throws `ERR_NAME_NOT_RESOLVED`. This IS a real failure (server never got the request). Current behavior is correct.

2. **If POST already returned 200** — The export is queued server-side. But any subsequent network-dependent operation (WebSocket disconnect, polling failure, download failure) still falls into the same catch block and calls `setError()` + `failExportInStore()`. This is wrong — the export is still running.

### Current Architecture (What Already Works)

The system already has most of the pieces for reconnection:

**Backend:**
- `export_jobs` table tracks durable state: `pending → processing → complete/error`
- WebSocket progress is fire-and-forget — export continues if no clients connected
- `GET /api/exports/{jobId}` — returns current status (designed for reconnection)
- `GET /api/exports/{jobId}/modal-status` — checks Modal cloud job + auto-finalizes
- `POST /api/exports/{jobId}/resume-progress` — restarts progress simulation for recovered jobs

**Frontend:**
- `ExportWebSocketManager` has exponential backoff reconnection (500ms → 10s, max 10 attempts)
- `useExportRecovery` hook reconnects to in-progress exports after **page refresh**
- `exportStore` tracks all active exports with progress, populated from backend on load
- `_pollExportStatus()` polls REST endpoint after 10 failed WebSocket reconnects

**Gap:** The reconnection infrastructure works across page refreshes (via `useExportRecovery`) but does NOT work within a single session when `ExportButtonContainer` catches a network error and marks the export as failed.

### Affected Code Paths

**ExportButtonContainer.jsx:**
- Lines 553-559: `axios.post('/api/export/render')` — framing render
- Lines 591-595: `axios.post('/api/export/render-overlay')` — overlay render
- Lines 602-604: `axios.get('/api/export/projects/{id}/final-video')` — overlay download URL
- Lines 608-612: `fetch(presignedUrl)` — overlay video download from R2
- Lines 759-763: `axios.post('/api/export/final')` — save final video
- Lines 796-872: Catch block — marks ALL errors as fatal

**ExportWebSocketManager.js:**
- Lines 271-313: `_scheduleReconnect()` — already reconnects, but `ExportButtonContainer` kills the export in its catch before reconnection can happen
- Lines 454-503: `_pollExportStatus()` — REST fallback after 10 WS failures, but never reached because container catch fires first

## Solution

### Phase 1 — Split Error Handling by Export Phase

Track whether the render POST has succeeded. After that point, network errors become recoverable.

**ExportButtonContainer.jsx changes:**

```
// Conceptual flow:
let renderRequestAccepted = false;

try {
  await connectWebSocket(exportId);
  const response = await axios.post('/api/export/render', ...);
  renderRequestAccepted = true;  // <-- Server accepted the job

  // ... rest of flow (for overlay: download, save)
} catch (err) {
  if (renderRequestAccepted) {
    // Export is running server-side — this is a monitoring failure, not an export failure
    // DON'T call setError() or failExportInStore()
    // Instead: show recoverable disconnection state
    setDisconnected(true);
    setProgressMessage('Connection lost — export continues on server...');
  } else {
    // POST never succeeded — this IS a real failure
    // Keep existing error handling
    setError(errorMessage);
    failExportInStore(exportId, ...);
  }
}
```

**New state:** `disconnected` (boolean) — shown in UI as a reconnecting indicator instead of a hard error.

### Phase 2 — Reconnection Flow After Disconnect

When the container detects a post-render network error:

1. Show "Connection lost — export continues on server. Reconnecting..." in the progress area (not the error area)
2. Let `ExportWebSocketManager`'s existing reconnect logic run (exponential backoff, 10 attempts)
3. On successful reconnect: clear disconnected state, resume showing progress
4. If WebSocket reconnect fails after 10 attempts: fall back to polling `GET /api/exports/{exportId}` every 5s
5. When export completes (via WS or poll): proceed normally (overlay download, proceed-to-overlay callback, etc.)

**ExportWebSocketManager.js changes:**
- After 10 failed WS reconnects, switch to periodic REST polling (currently polls once then gives up)
- Add a `onDisconnect` / `onReconnect` callback pair so the container can update UI state

### Phase 3 — Overlay Post-Render Recovery

Overlay exports have additional steps after the render completes (fetch presigned URL, download video, save to R2). If network drops during THESE steps:

1. Track `renderComplete` as a second phase flag
2. If network drops after render but during download: show "Export rendered successfully. Download will resume when connected."
3. On reconnect: retry the download sequence (fetch presigned URL → download → save)
4. If the page is refreshed, `useExportRecovery` already handles this case

### Phase 4 — UI Polish

**ExportButtonView.jsx changes:**
- New visual state: "disconnected" — yellow/amber indicator with reconnecting animation
- Show "Export continues on server" message
- When reconnected: brief "Reconnected!" flash, then resume normal progress
- If user navigates away during disconnect: `useExportRecovery` picks it up on return

## Implementation Details

### Files to Change

| File | Changes |
|------|---------|
| `ExportButtonContainer.jsx` | Split catch block by phase, add `renderRequestAccepted` tracking, add disconnect state, post-render retry logic |
| `ExportButtonView.jsx` | New disconnected UI state (amber indicator, reconnecting message) |
| `ExportWebSocketManager.js` | Add `onDisconnect`/`onReconnect` callbacks, change post-max-retry to periodic polling instead of single poll |
| `exportStore.js` | Optional: add `disconnected` flag per export for store-level tracking |

### Files NOT to Change

- **Backend** — already fully supports reconnection. No server changes needed.
- **useExportRecovery.js** — already handles page-refresh recovery. This task handles within-session recovery.

### Edge Cases

1. **Network drops before POST response** — real failure, keep current behavior
2. **Network drops after POST but before WS connects** — export is running, treat as recoverable
3. **Network drops during WS progress** — export is running, reconnect
4. **Network drops after render complete but during overlay download** — render is done, retry download
5. **User navigates away during disconnect** — `useExportRecovery` handles on return
6. **Server restarts during disconnect** — Modal job continues, backend recovery picks it up on restart
7. **Multiple disconnects during one export** — each reconnect resets the backoff timer

### What NOT to Do

- Don't add reactive persistence (useEffect watching disconnect state)
- Don't duplicate the reconnection logic that already exists in `ExportWebSocketManager`
- Don't change the backend — it already handles all reconnection scenarios
- Don't add new WebSocket message types — the existing protocol is sufficient

## Testing

### Manual Test Script

1. Start a framing export
2. Wait for progress to show (confirms POST succeeded)
3. Disable network (airplane mode or dev tools offline)
4. Verify: UI shows "Connection lost — export continues on server" (NOT "Export failed")
5. Wait 10-15 seconds
6. Re-enable network
7. Verify: UI shows "Reconnected!" then resumes progress
8. Verify: Export completes successfully

### Edge Case Tests

- Cut network before POST returns → should show "Export failed" (real failure)
- Cut network, refresh page → `useExportRecovery` should reconnect
- Cut network during overlay download phase → should retry download on reconnect
- Cut network for > 2 minutes → polling fallback should detect completion

## References

- T128: WebSocket Reconnection Resilience (the infrastructure this task builds on)
- T87: Sync Connection Loss Handling (similar pattern for sync)
- T249: Extraction Recovery (similar recovery pattern for extractions)
- T350: Sync Strategy Overhaul (gesture-based persistence — don't add reactive writes)
