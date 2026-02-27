# T249: Robust Extraction Recovery

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-02-27
**Updated:** 2026-02-27

## Problem

Clip extraction can get permanently stuck, leaving projects unopenable with an infinite spinner. There's no timeout, no retry mechanism, no "failed" UI state, and no recovery path for users.

**User-reported scenario:** Project "Brilliant Pass Run Cross" created yesterday shows "Extracting Clips" spinner forever. The clip has `status: pending` and `file_url: null`.

### Backend Failure Modes

1. **Tasks stuck in 'running' state have no timeout** — only recovered on server restart (`modal_queue.py:125-132`). If Modal/FFmpeg hangs, the task stays 'running' indefinitely. The `already_queued` check (`clips.py:1175`) blocks re-enqueue for 'running' tasks, so the clip is permanently stuck until server restart.

2. **Failed tasks have no retry mechanism** — once a task is marked 'failed' (`modal_queue.py:163-179`), it stays failed. No automatic retry with backoff exists.

3. **`already_queued` check only looks at pending/running** (`clips.py:1175-1181`) — so failed clips silently re-enqueue on every project open, creating duplicate failed tasks in `modal_tasks` with no deduplication.

4. **No extraction timeout** — hung Modal/FFmpeg calls block the queue indefinitely. No timeout configured on the `await` in `modal_queue.py:194`.

5. **WebSocket broadcast is fire-and-forget** (`websocket.py:177-194`) — if no clients are connected when extraction completes, the event is silently dropped. No persistent record of the broadcast attempt.

### Frontend Failure Modes

6. **No 'failed' extraction status in UI** — `ClipSelectorSidebar.jsx:274-286` only handles `isExtracting` (shows "Extracting...") and `!isExtracted` (shows "Waiting for extraction"). Failed clips show "Waiting for extraction" instead of an error.

7. **No timeout on extraction spinner** — `FramingScreen.jsx:1063-1082` shows spinner when `extractionState.allExtracting === true`. No timeout to stop it if WebSocket event never arrives.

8. **No retry button** — users can't manually re-trigger extraction for failed clips.

## Solution

### Phase 1 — Minimum Viable Recovery

**Backend:**
- Add task timeout: mark tasks 'failed' if 'running' for > 10 minutes (in `process_modal_queue`)
- Add `POST /api/clips/projects/{project_id}/clips/{clip_id}/retry-extraction` endpoint

**Frontend:**
- Show "Extraction failed" state in `ClipSelectorSidebar` with retry button
- Add extraction status polling fallback: if WebSocket doesn't deliver within 30s, poll the clips API
- Add timeout on extraction spinner: after 5 minutes, show "Taking longer than expected" with retry option

### Phase 2 — Robustness

- Add automatic retry with exponential backoff (max 3 attempts) in `modal_queue`
- Deduplicate failed tasks: check for recent failures before re-enqueueing (fix the `already_queued` check)
- Add extraction health check endpoint for monitoring
- Log extraction metrics (success/failure/timeout rates)

## Context

### Relevant Files

**Backend:**
- `src/backend/app/services/modal_queue.py` — Queue processing, task status transitions, no retry logic
- `src/backend/app/routers/clips.py:1037-1211` — Extraction trigger, `already_queued` check, status lookup
- `src/backend/app/websocket.py:153-241` — Extraction broadcast (silent failure on no clients)
- `src/backend/app/main.py:248-256` — Startup recovery (processes pending/running tasks)

**Frontend:**
- `src/frontend/src/screens/FramingScreen.jsx:133-179` — Extraction state calculation + WebSocket listener
- `src/frontend/src/hooks/useProjectLoader.js:83-86` — `isExtracted`/`isExtracting` detection
- `src/frontend/src/services/ExtractionWebSocketManager.js` — WebSocket client for extraction events
- `src/frontend/src/components/ClipSelectorSidebar.jsx:194-305` — Extraction status UI (no failed state)

### Related Tasks
- None

### Technical Notes

**Extraction lifecycle:**
1. User opens project -> `GET /api/clips/projects/{id}/clips`
2. Backend finds clips with empty `raw_clips.filename` -> enqueues `modal_tasks` entry (status='pending')
3. Background `process_modal_queue()` marks task 'running', calls Modal/FFmpeg
4. On success: updates `raw_clips.filename`, broadcasts `extraction_complete` via WebSocket
5. On failure: marks task 'failed', broadcasts `extraction_failed`
6. Frontend WebSocket listener calls `fetchProjectClips()` to refresh

**Key failure chain:** If step 4/5 broadcast fails (no clients), frontend never learns extraction completed. The spinner spins forever until user refreshes the page.

**Status transitions:** `pending -> running -> completed|failed`. No `running -> pending` recovery except on server restart.

## Implementation

### Steps

**Phase 1:**
1. [ ] Add stale task timeout in `process_modal_queue`: mark 'running' tasks as 'failed' if `started_at` > 10 min ago
2. [ ] Add retry endpoint: `POST /api/clips/.../retry-extraction` that resets failed task to 'pending' (or creates new one)
3. [ ] Frontend: add 'failed' extraction state in ClipSelectorSidebar with error message + retry button
4. [ ] Frontend: add polling fallback in FramingScreen — if anyExtracting and no WebSocket update within 30s, poll clips API
5. [ ] Frontend: add timeout message after 5 minutes on extraction spinner

**Phase 2:**
6. [ ] Add automatic retry with backoff (max 3 attempts) in modal_queue
7. [ ] Fix `already_queued` check to also check 'failed' tasks with retry_count < max
8. [ ] Add extraction health check endpoint

### Progress Log

*No progress yet*

## Acceptance Criteria

- [ ] Stuck 'running' tasks auto-fail after 10 minutes
- [ ] Failed extractions show error state in sidebar (not "Waiting for extraction")
- [ ] Users can retry failed extractions via button click
- [ ] Extraction spinner has polling fallback (doesn't depend solely on WebSocket)
- [ ] Spinner shows "taking longer than expected" after 5 minutes
- [ ] No duplicate failed tasks accumulate on repeated project opens
