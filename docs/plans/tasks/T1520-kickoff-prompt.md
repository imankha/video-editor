# T1520 Kickoff Prompt — Export Disconnect/Retry UX

Copy everything below the line into a fresh Claude Code session.

---

## Task

Implement T1520: Export Disconnect/Retry UX. Read `CLAUDE.md` before doing anything.

## Problem Summary

When a user disconnects/reconnects internet mid-export, they see a red **"Export failed due to a network error"** toast instead of the amber **"Connection lost -- export continues on server"** banner. The export actually succeeded server-side, but the user thinks it failed. Additionally, there's no manual retry button once auto-reconnect exhausts attempts, and no terminal "reconnection failed" state.

## Status

- **Branch:** Create `feature/T1520-export-disconnect-retry-ux`
- **Status:** TODO
- **Task file:** `docs/plans/tasks/T1520-export-disconnect-retry-ux.md`

## Root Cause Analysis (already done)

The bug is an **error classification problem** in the catch block of `ExportButtonContainer.jsx`.

### The flow that produces the wrong error

1. User starts export -- render POST succeeds (202), `renderRequestAccepted = true` (line 571/622)
2. Export runs on backend via Modal, progress streams over WebSocket
3. User loses internet mid-export
4. WebSocket closes -> `ExportWebSocketManager.js` `onclose` handler fires -> calls `onDisconnect()` callback -> container sets `disconnected = true` (CORRECT so far)
5. **But here's the bug path:** If the network loss also causes a pending axios request to throw (or some other error in the try block after the render POST), execution jumps to the `catch` block at line 782
6. In the catch block, `renderRequestAccepted` is `true`, so line 787-792 SHOULD handle it correctly by setting `disconnected = true`
7. **However**, the bug likely occurs when the network error happens during a different phase -- possibly during the initial `connectWebSocket()` call (line 558/611) BEFORE `renderRequestAccepted` is set, or during a race where the WS connection setup itself fails

### The specific misclassification code (lines 834-843)

```javascript
const isNetworkError = !err.response && (
  err.code === 'ERR_NETWORK' ||
  err.code === 'ECONNREFUSED' ||
  err.message?.includes('Network Error') ||
  (err.message?.includes('Failed to fetch') && !err.message?.includes('clip'))
);

if (isNetworkError) {
  setError('Export failed due to a network error. Please check your connection and try again.');
  setProgressMessage('Network error');
}
```

This treats ALL network errors as terminal failures. But if the export was already accepted by the backend (`renderRequestAccepted = true`), a network error is recoverable -- the job is still running on Modal. The `renderRequestAccepted` guard at line 787 was supposed to catch this, but there may be timing/race issues.

**Investigation needed:** Trace exactly which code path produces the wrong error. Likely candidates:
- WebSocket `connectWebSocket()` at line 558 throws a network error BEFORE `renderRequestAccepted` is set at line 571
- A race condition where the catch block runs after `renderRequestAccepted` is set but the `if (renderRequestAccepted)` check at line 787 doesn't match (unlikely given it's synchronous)
- The WS manager's `onclose` fires `onDisconnect()` correctly, but then a separate error from the try block also fires and overwrites `disconnected` with `error`

## Existing Infrastructure (already works, don't rebuild)

| Component | What it does | Location |
|-----------|-------------|----------|
| Export persistence | Exports saved to DB with `job_id` + `modal_call_id`, survive client disconnect | `src/backend/app/routers/exports.py` |
| Recovery on mount | `useExportRecovery.js` fetches `/api/exports/active` + `/api/exports/unacknowledged` on startup | `src/frontend/src/hooks/useExportRecovery.js` |
| Modal status poll | `GET /api/exports/{job_id}/modal-status` returns running/complete/failed/expired | `src/backend/app/routers/exports.py:871` |
| Progress resume | `POST /api/exports/{job_id}/resume-progress` reconnects to progress stream | `src/backend/app/routers/exports.py:1078` |
| WS reconnect | Exponential backoff (500ms * 2^n, max 10s, 10 attempts) then REST polling every 5s | `ExportWebSocketManager.js:291-322, 476-503` |
| Disconnected state | `disconnected` boolean in container, amber banner in view | `ExportButtonContainer.jsx:233`, `ExportButtonView.jsx:225-230` |
| Silence timeout | 60s no WS progress -> re-poll Modal status | `useExportRecovery.js:163-177` |
| Unacknowledged recovery | Completed exports shown on next app load | `useExportRecovery.js:114-174` |

## Key Code Locations

### ExportWebSocketManager.js (`src/frontend/src/services/ExportWebSocketManager.js`)

- **Lines 20-29:** `RECONNECT_CONFIG` -- 500ms initial, 10s max, 2x backoff, 10 max attempts
- **Lines 137-141:** `ws.onerror` -- suppressed, all recovery in `onclose`
- **Lines 143-172:** `ws.onclose` -- checks if export still active, calls `onDisconnect()`, schedules reconnect
- **Lines 100-116:** `ws.onopen` -- detects reconnect via `reconnectAttempt > 0`, fires `onReconnect()`
- **Lines 291-322:** `_scheduleReconnect()` -- exponential backoff, after 10 attempts -> `_startPeriodicPolling`
- **Lines 476-503:** `_startPeriodicPolling()` -- REST poll every 5s until terminal state

### ExportButtonContainer.jsx (`src/frontend/src/containers/ExportButtonContainer.jsx`)

- **Lines 227-234:** State: `error`, `disconnected`, `isExporting`, `localProgress`, `progressMessage`
- **Lines 308-352:** `connectWebSocket()` -- wires up `onProgress`, `onComplete`, `onError`, `onDisconnect`, `onReconnect` callbacks
- **Line 341-343:** `onDisconnect` callback: `setDisconnected(true)`, message "Connection lost..."
- **Line 345-347:** `onReconnect` callback: `setDisconnected(false)`, message "Reconnected..."
- **Line 336-339:** `onError` callback: `setDisconnected(false)`, `setError(serverError)`, `setIsExporting(false)`
- **Line 479:** `let renderRequestAccepted = false;`
- **Lines 571, 622:** `renderRequestAccepted = true;` (after successful POST)
- **Lines 787-793:** Catch guard: if `renderRequestAccepted`, set `disconnected` instead of `error`
- **Lines 834-843:** Network error classification -> **THIS IS THE BUG** -- sets terminal error for recoverable state

### ExportButtonView.jsx (`src/frontend/src/components/ExportButtonView.jsx`)

- **Lines 224-230:** Amber disconnected banner: `{disconnected && !error && (...)}`
- **Lines 232-237:** Red error block: `{error && (...)}`
- **No retry button exists** -- this is what we need to add

### useExportRecovery.js (`src/frontend/src/hooks/useExportRecovery.js`)

- **Line 9:** `SILENCE_TIMEOUT_MS = 60000`
- **Lines 32-99:** Three-phase startup recovery (active exports, Modal status, unacknowledged)
- **Lines 163-177:** `setupSilenceTimeout` -- 60s silence -> re-poll Modal
- **Lines 201-265:** `checkModalStatusOnce` -- handles COMPLETE/running/ERROR/expired/not_modal

### Export Store (`src/frontend/src/stores/exportStore.js`)

- `activeExports` map: `{ exportId -> { status, progress, error, outputVideoId, ... } }`
- `completeExport(exportId)`, `failExport(exportId, error)`, `updateExportProgress()`

## Implementation Plan

### 1. Fix error classification (ExportButtonContainer.jsx)

**Root fix:** In the catch block (line 782+), a network error after `renderRequestAccepted = true` should ALWAYS go to `disconnected` state, never to `error`. The guard at line 787 should already handle this, but verify:

- Confirm `renderRequestAccepted` is `true` when the user hits the bug path
- If the bug is a race (WS connect fails before POST), the fix is different -- the WS connection at line 558 happens BEFORE the render POST at line 564, so if `connectWebSocket` throws a network error, `renderRequestAccepted` is still `false` and we fall through to the network error path at line 841

**Possible fix approaches:**
- If the network drops during `connectWebSocket()` (before POST): this IS a legitimate failure -- the export never started. The current error message is correct here.
- If the network drops AFTER the render POST returns 202: the `renderRequestAccepted` guard at 787 should catch it. If it doesn't, investigate why.
- If the WS `onDisconnect` fires AND THEN a catch-block error overwrites it: add a guard -- if `disconnected` is already `true`, don't overwrite with `error`.

**Key insight:** The state variables `error` and `disconnected` can race. If `onDisconnect` sets `disconnected = true` (line 341), but then the catch block runs and sets `error = "Export failed..."` (line 842), the error wins because `{error && (...)}` renders regardless of `disconnected`. The view shows `{disconnected && !error && (...)}` -- so any error suppresses the disconnected banner.

**Likely fix:** In the catch block's network error branch (line 841), check if the export is already in `disconnected` state or if `renderRequestAccepted` is true before setting terminal error:

```javascript
if (isNetworkError) {
  // If export is already running server-side, this is a recoverable disconnect
  if (renderRequestAccepted || disconnected) {
    setDisconnected(true);
    setProgressMessage('Connection lost -- export continues on server...');
    return;  // Don't set error, don't call setIsExporting(false)
  }
  setError('Export failed due to a network error. Please check your connection and try again.');
  setProgressMessage('Network error');
}
```

### 2. Add Retry Connection button (ExportButtonView.jsx)

Add a button to the amber disconnected banner at lines 224-230:

```jsx
{disconnected && !error && (
  <div className="text-amber-400 text-sm bg-amber-900/20 border border-amber-800 rounded p-2">
    <div className="flex items-center gap-2">
      <Loader size={14} className="animate-spin" />
      <span>Connection lost -- export continues on server. Reconnecting...</span>
    </div>
    <button
      onClick={onRetryConnection}
      className="mt-2 px-3 py-1 text-xs bg-amber-800/50 hover:bg-amber-700/50 border border-amber-700 rounded"
    >
      Retry connection
    </button>
  </div>
)}
```

Follow the MVC pattern: `onRetryConnection` is a prop passed from the container.

### 3. Add retry handler (ExportButtonContainer.jsx)

```javascript
const handleRetryConnection = useCallback(async () => {
  const exportId = exportIdRef.current;
  if (!exportId) return;

  setProgressMessage('Checking export status...');

  try {
    // Bypass WS -- directly poll Modal status via REST
    const response = await axios.get(`${API_BASE}/api/exports/${exportId}/modal-status`);
    const { status, modal_status } = response.data;

    if (status === 'complete' || modal_status === 'complete') {
      // Job finished while we were offline -- recover output
      setDisconnected(false);
      setLocalProgress(100);
      setProgressMessage('Export complete!');
      setIsExporting(false);
      handleExportEnd();
      completeExportInStore(exportId, response.data);
      // Trigger unacknowledged export recovery to surface the file
    } else if (status === 'error' || modal_status === 'error') {
      // Job actually failed -- show real error
      setDisconnected(false);
      setError(response.data.error || 'Export failed on server');
      setIsExporting(false);
      handleExportEnd();
    } else {
      // Still running -- reset WS backoff and reconnect
      setProgressMessage('Export still running -- reconnecting...');
      exportWebSocketManager.resetReconnect(exportId);  // May need to add this method
      await connectWebSocket(exportId);
    }
  } catch (retryErr) {
    setProgressMessage('Could not reach server -- will keep trying...');
  }
}, [/* deps */]);
```

**Note:** You may need to add a `resetReconnect(exportId)` method to `ExportWebSocketManager.js` that resets the reconnect attempt counter and immediately tries to connect.

### 4. Add terminal "reconnection failed" state

After auto-reconnect exhausts 10 WS attempts AND periodic REST polling also fails repeatedly, show a terminal state:

```jsx
{disconnected && reconnectionFailed && (
  <div className="text-amber-400 text-sm bg-amber-900/20 border border-amber-800 rounded p-2">
    <span>Could not reconnect to server. Export may still be running.</span>
    <div className="flex gap-2 mt-2">
      <button onClick={onRetryConnection}>Check status</button>
      <button onClick={onDismissExport}>Dismiss</button>
    </div>
  </div>
)}
```

Add a `reconnectionFailed` state to the container. The WS manager needs a way to signal this -- either via a new callback (`onReconnectFailed`) or by exposing state the container can poll.

### 5. Output recovery for completed-while-offline exports

When `handleRetryConnection` detects the Modal job completed:
- The unacknowledged export recovery path in `useExportRecovery.js:114-174` already handles this
- Verify it works for framing exports (not just multi_clip) by checking the `type` field
- The completed file should appear in Downloads automatically via the existing `completeExport` store action

## Files to Change

| File | Changes |
|------|---------|
| `src/frontend/src/containers/ExportButtonContainer.jsx` | Fix network error classification in catch block; add `handleRetryConnection` handler; add `reconnectionFailed` state; pass new props to view |
| `src/frontend/src/components/ExportButtonView.jsx` | Add retry button to disconnected banner; add terminal reconnection-failed state; accept new props |
| `src/frontend/src/services/ExportWebSocketManager.js` | Add `resetReconnect(exportId)` method (reset attempt counter + reconnect); add `onReconnectFailed` callback or expose failed state |
| `src/frontend/src/hooks/useExportRecovery.js` | Verify framing export recovery works in unacknowledged path (read-only check, may not need changes) |

## Backend

**Likely no changes needed.** Endpoints already exist:
- `GET /api/exports/{job_id}/modal-status` -- returns status
- `POST /api/exports/{job_id}/resume-progress` -- reconnects progress stream
- `GET /api/exports/active` -- lists active exports
- `GET /api/exports/unacknowledged` -- lists completed but unacknowledged exports

Verify `/modal-status` response includes enough info to distinguish: running, complete (with output file info), failed (with error message), not-found.

## Testing

### Failing test first (mock WS close + successful modal-status)

Write a test that:
1. Mocks a WebSocket close event during an active export
2. Asserts the container transitions to `disconnected = true`, NOT `error`
3. Mocks a successful `/modal-status` response showing the job completed
4. Asserts the retry handler transitions to complete state

### Manual tests

- Start export -> disconnect 15s -> reconnect. Verify amber banner, not red error.
- Start export -> disconnect -> wait for Modal job to complete -> reconnect. Verify output retrieved.
- Start export -> disconnect -> click Retry. Verify status check works.
- Start export -> disconnect -> exhaust all reconnect attempts. Verify terminal state with Check Status + Dismiss buttons.

## Acceptance Criteria

- [ ] Disconnecting mid-export shows amber "Connection lost" banner, NOT red "Export failed" toast
- [ ] Banner has a Retry connection button that actively re-queries Modal status
- [ ] If Modal job completed while offline, UI transitions to complete with output accessible
- [ ] If Modal job failed while offline, UI surfaces the real failure reason
- [ ] If reconnect genuinely fails (backend down 5+ min), terminal state with "Check status" + "Dismiss"
- [ ] Never an infinite spinner

## Hard Rules (from CLAUDE.md)

- **No reactive persistence** -- don't add useEffect watchers that write to store/backend
- **MVC pattern** -- container handles logic, view is presentational
- **No silent fallbacks** -- if data is missing, log a warning, don't silently default
- **Gesture-based persistence** -- the retry button click is the gesture that triggers the status check
- **Read `useExportRecovery.js` in full before changing it** -- its on-mount recovery is subtle
