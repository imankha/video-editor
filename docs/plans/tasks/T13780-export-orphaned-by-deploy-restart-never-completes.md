# T13780: A Framing export dispatched just before a backend restart never completes in the open tab

**Status:** WIP
**Impact:** 8
**Complexity:** 4
**Tier:** M (frontend reconcile on reconnect + backend guard + logging)
**Created:** 2026-10-27
**Updated:** 2026-10-27
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA, 2026-10-27 (18:21 PT). User generated a Framing highlight for "QA first play" (project 2, profile 452b3380, user c76ade8d) and the progress card sat at "Sharpening the picture, 15%" for 4+ minutes. The export is `export_1793150471973_yrlbxaw`. A page refresh completed it immediately.

## Evidence (timeline, UTC 2026-10-28)

| Time | Where | What |
|------|-------|------|
| 01:18:56 | GitHub Actions | Deploy Backend (staging) run 40614287596 starts for the PR #658 merge (T13770, landed by another session). |
| 01:21:11.973 | Browser | Export dispatched (the id is the epoch ms). `render_project` persists the job, reserves credits, and `asyncio.create_task(_run_render_background)` dispatches Modal. |
| 01:21:21 | Fly | New staging machine 08037e9c31d678 launched by that deploy; the old machine gets SIGTERM. The in-process render task dies with it. The job row stays `processing` with its `modal_call_id`. |
| 01:21:42 | Fly | New machine started. |
| 01:22-01:23 | Modal (`reel-ballers-video-v2-staging`) | 133 frames upscaled in 61.7s, encoded, uploaded `working_videos/working_2_642f0cba.mp4`, "Processing complete". |
| 01:23:30 | Modal | "Received a cancellation signal while processing input", then `ClientClosed` tracebacks on shutdown: the consumer of the generator (the old backend process) was gone. Output was already in R2. |
| 01:24:24 onward | Staging backend | `[WS] Responded to ping from export_1793150471973_yrlbxaw` every 30s: the browser's WebSocket reconnected to the NEW process, which holds no `export_progress` entry for this job and runs no task that will ever push a completion frame. |
| 01:25:43 | Staging backend | The user's next request runs `recover_orphaned_jobs` (per-user, first request per process): `Modal job ... finished, will finalize on next status check`. No status check ever arrives. |
| 01:30 approx | Browser | User refreshes. `useExportRecovery` mount path calls `/modal-status`, `reconcile_dispatched_export` answers `rendered`, finalize runs, highlight appears. |

Logs: `fly logs -a reel-ballers-api-staging --no-tail` (only the last ~100 lines) and `modal app logs ap-Rso6FSkzHPGORFnH3dlN2p`.

## Problem

Two halves, both required:

1. **Frontend never reconciles after a reconnect.** `ExportButtonContainer.connectWebSocket` passes `onReconnect` to `ExportWebSocketManager`, but the callback only sets `progressMessage = 'Reconnected -- resuming progress...'`. Nothing asks the server whether the job it reconnected to is still owned by a live task. The only reconciliation paths are the mount-time `useExportRecovery` (page load) and the manual Retry button (`handleRetryConnection`), and even that one never POSTs `/resume-progress`, so after a restart it would only help once Modal is already done.
2. **Backend has no signal that a WS client is attached to a job this process does not own.** `websocket_export_progress` accepts any export id. After a restart the process serves pings forever for a job it will never finish, and nothing is logged. `_graceful_shutdown` also does not say which renders it is abandoning.

Any staging or prod deploy (or Fly host migration, or OOM restart) while a highlight is generating reproduces this. Users on prod do not know to refresh; the Modal render and the credits are spent, and the completed video sits in R2 unreferenced until the next page load.

## Solution

**Frontend (the fix):** on `onReconnect`, run the same reconcile as the mount path: `GET /api/exports/{id}/modal-status`. `complete` -> finish exactly as `handleRetryConnection` does today. `running` -> `POST /api/exports/{id}/resume-progress` so the NEW process drives the simulated progress loop and finalizes (this is what `useExportRecovery.checkModalStatusOnce` already does for mount-recovered jobs). Fold that POST into `handleRetryConnection` too so the manual button behaves the same. Reuse `handleRetryConnection`; do not add a third copy of the complete/error handling.

**Backend guard (so a transient blip against a LIVE process cannot start a duplicate loop):** `resume_progress` returns a no-op when `job_id in export_progress and job_id not in _active_progress_loops`, which means an in-band task in THIS process still owns the render (every in-band dispatcher seeds `export_progress[export_id]` before dispatch: framing.py:223, overlay.py:1363, multi_clip.py:2084). After a restart the entry is absent, so the loop starts. `finalize_export`'s stage CAS (T7210) already settles a finalize race, so the only thing the guard prevents is interleaved progress messages.

**Logging (so the next occurrence is diagnosable from server logs alone):**
- `_graceful_shutdown` (main.py): WARNING listing every `export_progress` entry whose status is `processing`: `[Shutdown] N render(s) in flight will be orphaned by this restart: <ids>`.
- `websocket_export_progress` (websocket.py) on connect: WARNING when `export_id not in export_progress`: `[WS] client attached for <id> but this process holds no progress state for it (restart orphan? client must reconcile via /modal-status)`.
- `resume_progress`: INFO when the guard declines (`in-band render owns <id>`) and when a loop starts for a restart orphan.
- `ExportButtonContainer.onReconnect`: `console.warn` with the export id and the reconcile verdict.

Not in scope: making the WS endpoint auto-start the loop server-side (it has no user/profile request context, so `get_export_job` and finalize cannot run there); draining in-flight renders before a Fly deploy.

Also observed, separate and minor: Modal logged `Could not read frame 133..137` for a clip ffprobe reported as 138 frames (133 readable). The upscaler handled it. File separately only if it recurs on other clips.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/ExportButtonContainer.jsx` - `connectWebSocket.onReconnect`, `handleRetryConnection`
- `src/frontend/src/hooks/useExportRecovery.js` - reference: `checkModalStatusOnce` is the behavior to match (read only, maybe share a helper)
- `src/frontend/src/services/ExportWebSocketManager.js` - `onReconnect` fires when `reconnectAttempt > 0` (read only)
- `src/backend/app/routers/exports.py` - `resume_progress` guard + logs, `check_modal_status`
- `src/backend/app/websocket.py` - connect-time orphan WARNING
- `src/backend/app/main.py` - `_graceful_shutdown` in-flight WARNING
- Tests: new `src/frontend/src/containers/ExportButtonContainer.reconnect.test.jsx` (follow `ExportButtonContainer.renderOnly.test.jsx`'s `h.wsConnect` mock, capture the callbacks, invoke `onReconnect`); backend test for the `resume_progress` guard and the two WARNINGs (caplog)

### Related Tasks
- T10360 (reconcile_dispatched_export, the three-state Modal check this builds on)
- T12820 (modal-status must not answer COMPLETE before finalize commits; same endpoints)
- T2260 (data-loss detection on reconnect, broader, TODO)

### Technical Notes
- `fly logs --no-tail` returns ~100 lines; for a prod incident pull logs within minutes or use the Fly dashboard.
- The WS endpoint runs outside the HTTP middleware: no `get_current_user_id()`. Keep reconciliation client-initiated.
- The 60s silence timer in `useExportRecovery` only covers exports recovered at mount, not ones dispatched in the current page session.

## Implementation

### Steps
1. [ ] Failing frontend test: WS `onReconnect` -> `/modal-status` fetched; `running` -> `/resume-progress` POSTed; `complete` -> completion path fires once
2. [ ] Failing backend test: `resume_progress` is a no-op when the in-band owner is alive in-process; starts a loop when `export_progress` lacks the id
3. [ ] Implement frontend reconcile + backend guard + the four log lines
4. [ ] Curated tests + lint; fresh-context review on the diff

### Progress Log

**2026-10-27**: Filed from staging QA with the full timeline above. Modal render was successful; only the completion signal was lost.

## Acceptance Criteria

- [ ] With a Framing export in flight, restart the backend (dev: kill and restart uvicorn): the open tab reaches the completed highlight without a page refresh
- [ ] A transient WS drop against a live process does not start a second progress loop (backend log shows the guard declining)
- [ ] Shutdown log names the in-flight export ids; a WS connect for a job this process does not own logs the orphan WARNING
- [ ] Tests fail before, pass after
