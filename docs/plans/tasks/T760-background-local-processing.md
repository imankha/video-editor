# T760: Background Local Processing (Non-blocking Exports)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-03-28
**Updated:** 2026-03-28

## Problem

When running exports locally (Modal disabled), the web server becomes unresponsive for the entire duration of the GPU processing job (often minutes). The UI freezes — API calls hang, WebSocket updates stop, and the app appears broken.

### Why it blocks

The render endpoint (`POST /api/export/render`) `await`s the full processing pipeline:

```
render_project()                         # async request handler
  └── await call_modal_framing_ai()      # holds the request open
        └── await local_framing()        # holds until done
              ├── await asyncio.to_thread(download_from_r2...)   # ~minutes for large files
              ├── await asyncio.to_thread(upscaler.process...)   # ~minutes of GPU work
              └── await asyncio.to_thread(upload_to_r2...)       # ~minutes for upload
```

Even though `asyncio.to_thread` offloads CPU/GPU work to a thread, the HTTP request handler stays `await`ing until all steps complete. Uvicorn runs a single async event loop — while the handler is awaiting the thread result, the event loop IS free to handle other requests. But the `download_from_r2_global` call at the start shares the same R2 connection pool, and the large file operations can exhaust it (see T750), causing other requests to fail.

The real blocking happens because:
1. **The HTTP request is held open for 5-15+ minutes** — the client (browser) may timeout
2. **WebSocket progress updates work** (via `asyncio.run_coroutine_threadsafe`), but the export HTTP response doesn't return until processing is done
3. **R2 connection pool starvation** — the download/upload operations consume connections that DB sync and other requests need
4. **Default thread pool is small** — `asyncio.to_thread` uses a default ThreadPoolExecutor (typically 5-8 workers). Multiple concurrent exports or other `to_thread` calls can exhaust it.

### How Modal avoids this

When Modal is enabled, `call_modal_framing_ai` dispatches the job to Modal's cloud GPU and streams progress back via Modal's generator API. The HTTP request still waits, but the actual work happens on a remote machine — no local resource contention.

## Solution

Make the render endpoint return immediately after dispatching the job, then run processing in the background. This is the same pattern Modal uses (fire-and-forget + progress streaming), just applied locally.

### Architecture

```
BEFORE (blocking):
  POST /render → await local_framing() → [5-15 min] → 200 response

AFTER (background):
  POST /render → spawn background task → 202 response (immediate)
  Background task: local_framing() → progress via WebSocket → update DB on complete/fail
```

### Implementation

**1. Use FastAPI `BackgroundTasks` or `asyncio.create_task`:**

```python
@router.post("/render")
async def render_project(request: RenderRequest):
    # ... validation, credit deduction, export_jobs record creation ...

    if not _modal_enabled:
        # Spawn background task instead of awaiting
        asyncio.create_task(
            _run_local_export(export_id, project_id, user_id, ...)
        )
        return {"status": "accepted", "export_id": export_id}

    # Modal path stays the same (already non-blocking from server perspective)
    ...

async def _run_local_export(export_id, project_id, user_id, ...):
    """Run export in background — updates progress via WebSocket, handles errors."""
    try:
        result = await call_modal_framing_ai(...)
        if result.get("status") != "success":
            # Update export_jobs to error, refund credits
            ...
        else:
            # Update export_jobs to complete, set working_video_id
            ...
    except Exception as e:
        # Refund credits, update export_jobs, log error
        ...
```

**2. Return 202 Accepted for local jobs:**

The frontend already handles progress via WebSocket — it doesn't need the HTTP response to contain the result. Change the response to 202 with the export_id, and let WebSocket handle completion/failure signaling.

**3. Error handling and credit refund:**

The background task must handle its own errors (currently the request handler's `except` block does this). Move the try/except + credit refund logic into the background task.

**4. Frontend compatibility:**

Check if `ExportButtonContainer.jsx` expects a synchronous response from the render endpoint. If it waits for the response to set completion state, it needs to be updated to rely on WebSocket `onComplete`/`onError` callbacks instead.

### What NOT to change

- Modal path — already works correctly
- Overlay local processing — same pattern, apply the same fix
- WebSocket progress — already works from background threads via `asyncio.run_coroutine_threadsafe`

## Context

### Relevant Files

**Backend (dispatch changes):**
- `src/backend/app/routers/export/framing.py` — `render_project()` endpoint (line ~490-760). Move processing into background task.
- `src/backend/app/routers/export/framing.py` — `render_overlay()` endpoint. Same pattern for overlay jobs.
- `src/backend/app/services/modal_client.py` — `call_modal_framing_ai()` (line ~370-410) local fallback path
- `src/backend/app/services/local_processors.py` — `local_framing()`, `local_overlay()` — no changes needed, these already work asynchronously

**Frontend (may need changes):**
- `src/frontend/src/containers/ExportButtonContainer.jsx` — check if it relies on the render POST response for completion state, or if WebSocket `onComplete` is sufficient

### Related Tasks
- Related: T750 (R2 Retry Resilience) — connection pool starvation is worse when exports block
- Related: T740 (Merge Extraction into Framing) — changed the export pipeline

## Acceptance Criteria

- [ ] `POST /api/export/render` returns 202 immediately when processing locally
- [ ] GPU/FFmpeg processing runs in background without blocking the event loop
- [ ] WebSocket progress updates continue to work during local processing
- [ ] Other API endpoints remain responsive during a local export
- [ ] Credit refund still works on processing failure
- [ ] Export completion updates the DB (working_video_id, export_jobs status)
- [ ] Frontend handles the 202 response correctly (relies on WebSocket for completion)
- [ ] Multiple concurrent local exports don't deadlock the thread pool
