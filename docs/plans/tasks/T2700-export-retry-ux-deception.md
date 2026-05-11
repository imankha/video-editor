# T2700: Export Retry Button UX Deception

**Status:** TESTING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-11
**Updated:** 2026-05-11

## Problem

When the WebSocket connection drops during an export (e.g., server restart, network blip), the UI shows "Connection lost -- export continues on server. Reconnecting..." with a **"Retry connection"** button. Clicking Retry does nothing visible -- no spinner, no feedback, no state change. The UI stays frozen until the export eventually finishes on the server and background polling picks it up.

A user will assume the export is broken and may close the tab, losing their place.

This was observed on localhost when uvicorn restarted mid-export (WS close code 1012). The reconnect attempt timed out, and the Retry button gave zero feedback.

## Root Cause Analysis

The problem is a **visibility gap**, not a broken handler. The system actually does recover -- but silently:

### What happens when WS drops:

1. `ws.onclose` fires in `ExportWebSocketManager.js:140-169`
2. `_scheduleReconnect()` starts auto-retry (10 attempts, exponential backoff, ~30s total)
3. UI shows "Reconnecting..." + Retry button (`ExportButtonView.jsx:221-257`)
4. If all 10 auto-reconnects fail: `onReconnectExhausted` fires, `_startPeriodicPolling()` begins REST polling every 5s
5. Eventually polling detects completion and updates the store

### What happens when user clicks Retry:

1. `handleRetryConnection()` (`ExportButtonContainer.jsx:381-431`) calls `GET /api/exports/{id}/modal-status`
2. If still running: calls `resetReconnect()` + `connectWebSocket()`
3. `resetReconnect()` (`ExportWebSocketManager.js:571-582`) only resets the attempt counter and clears the timeout -- does NOT immediately reconnect
4. If the server is still down, `connectWebSocket()` also fails silently (caught in `try/catch`, only `console.warn`)
5. User sees nothing change

### Three specific bugs:

1. **Retry gives zero visual feedback** -- no loading state, no spinner, no success/failure message after the REST call
2. **Progress bar stays frozen** during disconnected state -- even though REST polling may be happening in the background, `disconnected=true` blocks progress rendering
3. **No distinction between "reconnecting" and "polling"** -- user sees "Reconnecting..." even after WS is exhausted and REST polling has silently taken over

## Solution

Fix the Retry button to give immediate feedback and make background recovery visible.

## Context

### Relevant Files

- `src/frontend/src/services/ExportWebSocketManager.js` -- WS connection, reconnect logic, `resetReconnect()`, `_startPeriodicPolling()`
  - Lines 140-169: `ws.onclose` handler
  - Lines 282-322: `_scheduleReconnect()` with exponential backoff
  - Lines 571-582: `resetReconnect()` -- only resets counter, doesn't reconnect
- `src/frontend/src/containers/ExportButtonContainer.jsx` -- Export flow orchestration
  - Lines 358-362: `onDisconnect` callback sets `disconnected=true`
  - Lines 369-371: `onReconnectExhausted` callback
  - Lines 381-431: `handleRetryConnection()` -- the Retry click handler
- `src/frontend/src/components/ExportButtonView.jsx` -- UI rendering
  - Lines 221-257: Disconnected state UI with Retry button
- `src/frontend/src/hooks/useExportRecovery.js` -- 60s silence timeout fallback
  - Line 9: `SILENCE_TIMEOUT_MS = 60000`
  - Lines 144-158: Re-polls Modal status after 60s WS silence

### Related Tasks
- T1520 (Export Disconnect/Retry UX) -- DONE, original implementation of this UI
- T1190 (Session & Machine Pinning) -- TESTING, WS drops will be more common during Fly.io deploys

### Technical Notes

The `handleRetryConnection` handler actually does the right thing -- it checks Modal status via REST then reconnects. The problem is purely visual: no loading state, no progress update, no state transition shown to the user.

The periodic polling fallback (`_startPeriodicPolling` every 5s) also works correctly but is invisible. The UI should show that polling is happening.

## Implementation

### Steps
1. [x] Add loading state to Retry button (`handleRetryConnection` should set a `retrying` flag, show spinner)
2. [x] Show result of the REST status check ("Export at 45% -- still running" or "Export complete!")
3. [x] When `onReconnectExhausted` fires (WS gave up), update UI message to "Monitoring via server..." instead of "Reconnecting..."
4. [x] Show periodic poll progress updates even when `disconnected=true` -- the progress bar should keep moving
5. [x] If Retry's REST call confirms completion, immediately transition to done state (don't wait for WS)

### Progress Log

**2026-05-11**: Task created from T1190 testing. Observed on localhost with uvicorn restart (WS close 1012). Export completed successfully but user had no indication it was working.

## Acceptance Criteria

- [ ] Retry button shows spinner/loading state while checking
- [ ] After check, user sees export status ("still running at X%" or "complete")
- [ ] When WS reconnection exhausted, UI message changes from "Reconnecting..." to something indicating server polling
- [ ] Progress bar continues to update via REST polling even during disconnected state
- [ ] If export already complete when Retry clicked, immediately show completion
