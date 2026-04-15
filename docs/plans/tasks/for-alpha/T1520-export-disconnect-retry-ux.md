# T1520: Export disconnect/reconnect UX — wrong error + no retry button

**Status:** TODO
**Impact:** 7 (user-facing data-loss scare: export probably succeeded but user thinks it failed)
**Complexity:** 3
**Created:** 2026-04-15
**Updated:** 2026-04-15

## Problem

User started a framing export, disconnected/reconnected internet mid-job, and saw:

> "Export failed due to a network error. Please check your connection and try again."

Expected behavior:
1. "Disconnected — export is still running on the server" message (not "failed").
2. A **Retry** button that re-queries Modal status and resumes progress.
3. On reconnect, detect whether the Modal job is still running / already completed / failed, and update UI accordingly — including moving the output and acknowledging completion if the job finished while offline.

## Current State

The recovery infrastructure **exists** — the gap is classification + UX.

What already works:
- Exports are persisted to DB with `job_id` + `modal_call_id`, so they survive client disconnect. ([exports.py](src/backend/app/routers/exports.py))
- On app startup, [useExportRecovery.js](src/frontend/src/hooks/useExportRecovery.js) fetches `/api/exports/active` and `/api/exports/unacknowledged` and rehydrates state.
- Modal status can be polled via `GET /api/exports/{job_id}/modal-status` ([exports.py:871](src/backend/app/routers/exports.py#L871)).
- Progress stream resumes via `POST /api/exports/{job_id}/resume-progress` ([exports.py:1078](src/backend/app/routers/exports.py#L1078)).
- [ExportWebSocketManager.js:298-301](src/frontend/src/services/ExportWebSocketManager.js#L298) does exponential-backoff WS reconnect (max 10 attempts).
- [ExportButtonContainer.jsx:233](src/frontend/src/containers/ExportButtonContainer.jsx#L233) has a `disconnected` state.
- [ExportButtonView.jsx:225-230](src/frontend/src/components/ExportButtonView.jsx#L225-L230) shows an amber "Connection lost — export continues on server. Reconnecting…" message.
- 60s silence timeout triggers a re-poll of Modal status ([useExportRecovery.js:180-194](src/frontend/src/hooks/useExportRecovery.js#L180-L194)).

What's missing / wrong:
1. **Misclassification** — the user got "Export failed due to a network error" not the amber "Connection lost" banner. Something in the error path is treating a WS disconnect as a terminal failure instead of transitioning to the `disconnected` state. Root-cause hunt needed. Likely candidates: the WS `onerror`/`onclose` handler in `ExportWebSocketManager.js`, or the error classifier in the container turning a recoverable network blip into a permanent error toast.
2. **No manual retry button** — once auto-reconnect exhausts 10 attempts, the UI falls back to periodic polling silently. User has no way to force a reconnect / status check.
3. **No "reconnection failed" terminal state** — if polling also fails, the UI stays in a spinner forever.
4. **No user-triggered status check** — if the user doubts the UI, there's no button to manually check whether the job completed.

## Investigation Steps

1. Reproduce on staging: start a framing export on a clip, `ifconfig`/airplane-mode the network for ~15s, reconnect. Capture the exact error path + console logs.
2. Find which code path produces the string "Export failed due to a network error." — grep the frontend. Trace upward: what caused it to fire instead of the `disconnected` branch?
3. Decide: is the classification wrong (should have been `disconnected`) or is there a real terminal error being raised early (e.g. the initial POST to start the export failed, not the progress stream)?

## Proposed Fix (post-investigation)

### Frontend
1. **Error classification** — in `ExportWebSocketManager.js` / `ExportButtonContainer.jsx`, route WS disconnect/reconnect failures into `setDisconnected(true)` instead of `setError(...)`. Reserve the error toast for: initial POST failure, backend-reported job failure, or unrecoverable state after exhausting reconnect + poll.
2. **Retry button** — add to [ExportButtonView.jsx:225-230](src/frontend/src/components/ExportButtonView.jsx#L225-L230) disconnected block:
   ```jsx
   {disconnected && !error && (
     <div>
       <span>Connection lost — export continues on server…</span>
       <button onClick={onRetryConnection}>Retry connection</button>
     </div>
   )}
   ```
3. **Retry handler** in `ExportButtonContainer.jsx`:
   - Immediately call `GET /api/exports/{job_id}/modal-status` (bypass WS).
   - If complete: download output, mark acknowledged, close export state.
   - If failed: show real failure message with retry-export option.
   - If still running: reset WS backoff counter and reconnect now.
4. **Terminal "reconnection failed" state** — after retry fails (or auto-reconnect exhausts + polling also fails), show explicit state with two buttons: "Check status" (re-polls) and "Dismiss" (unacknowledges but keeps job in DB for next session recovery).

### Backend
Likely nothing — endpoints already exist. Verify `/modal-status` returns enough info for the frontend to distinguish running / complete / failed / not-found.

### Output recovery
When the frontend detects the Modal job completed while offline, it should:
- Read the completed export from `/api/exports/unacknowledged` (already wired in [useExportRecovery.js:114-174](src/frontend/src/hooks/useExportRecovery.js#L114-L174)) — confirm this path works for framing exports, not just multi_clip.
- Surface the completed file in Downloads so the user isn't left guessing.

## Acceptance Criteria

- [ ] Disconnecting network mid-export shows the amber "Connection lost — export continues on server" banner, **not** the red "Export failed due to a network error" toast.
- [ ] Banner has a **Retry connection** button that actively re-queries Modal status.
- [ ] If the Modal job completed while offline, the UI transitions to the completed state with the output file accessible in Downloads.
- [ ] If the Modal job failed while offline, the UI surfaces the real failure reason (not a generic network error).
- [ ] If reconnect genuinely fails (e.g. backend down for 5+ min), a terminal "reconnection failed" state appears with "Check status" + "Dismiss" buttons — never an infinite spinner.
- [ ] Manual test: start export → disconnect 15s → reconnect. Verify correct banner + retry flow.
- [ ] Manual test: start export → disconnect → wait long enough for Modal job to complete → reconnect. Verify output is retrieved and state shows complete.

## Notes for AI handoff

- The infrastructure is already there; this is primarily an error-classification + UX fix, not a new feature.
- Read [useExportRecovery.js](src/frontend/src/hooks/useExportRecovery.js) in full before changing anything — its on-mount recovery path is subtle and easy to break.
- Bug-reproduction skill applies: write a failing test (mock a WS close + successful `/modal-status` reply) that asserts the container transitions to `disconnected`, not `error`.
