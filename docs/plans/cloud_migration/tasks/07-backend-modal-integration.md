# Task 07: Backend Modal Integration

## Overview
Update the FastAPI backend to call Modal functions for GPU video processing instead of local FFmpeg.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 06 complete (Modal GPU functions deployed)
- R2 storage working (Tasks 01-04)

## Testability
**After this task**: Export buttons in the app trigger Modal GPU processing. Results appear in downloads.

---

## IMPORTANT: Existing Infrastructure

**The durable export system already exists!** This task integrates Modal into the existing architecture rather than creating parallel endpoints.

### Already Implemented
| Component | Location | Purpose |
|-----------|----------|---------|
| `export_jobs` table | `database.py` | Durable job state tracking |
| `exports.py` router | `routers/exports.py` | Job CRUD, active/recent queries |
| `export_worker.py` | `services/export_worker.py` | Background processing, WebSocket progress |
| `useExportRecovery.js` | `hooks/useExportRecovery.js` | Frontend reconnection on page load |

### What This Task Adds
- `MODAL_ENABLED` environment variable toggle
- Modal client in `services/modal_client.py`
- Integration point in `export_worker.py` to call Modal when enabled
- WebSocket progress relay from Modal callbacks

---

## What Changes

| Before | After |
|--------|-------|
| `export_worker.py` calls local FFmpeg | Calls Modal when `MODAL_ENABLED=true` |
| WebSocket progress from local callbacks | WebSocket progress from Modal callbacks |
| Videos processed locally | Videos processed on Modal GPU |
| Output saved to local filesystem | Output saved to R2 by Modal |

**What stays the same:**
- All existing API endpoints (`/api/exports/*`)
- WebSocket real-time progress (not replaced with polling)
- Job recovery on page load via `/api/exports/active`
- Database job tracking

---

## Key Advantage: Direct Python Calls

Unlike RunPod (HTTP API + polling), Modal lets you call functions directly:

```python
# Simple! Just call .remote()
from modal_functions.video_processing import process_video

result = process_video.remote(
    job_id="abc",
    user_id="a",
    job_type="framing",
    input_key="working_videos/video.mp4",
    output_key="final_videos/export.mp4",
    params={"output_width": 1080}
)
# result = {"status": "success", "output_key": "..."}
```

---

## Files to Create/Modify

### New: services/modal_client.py

```python
"""
Client for calling Modal GPU functions.

Provides a unified interface that:
- Calls Modal when MODAL_ENABLED=true
- Falls back to local FFmpeg when MODAL_ENABLED=false
- Relays progress via WebSocket callbacks
"""
import os
import asyncio
from typing import Dict, Any, Callable, Optional
import logging

logger = logging.getLogger(__name__)

# Check if Modal is enabled
MODAL_ENABLED = os.getenv("MODAL_ENABLED", "false").lower() == "true"


async def process_video_modal(
    job_id: str,
    user_id: str,
    job_type: str,
    input_key: str,
    output_key: str,
    params: Dict[str, Any],
    progress_callback: Optional[Callable] = None,
) -> Dict[str, Any]:
    """
    Call Modal GPU function for video processing.

    Args:
        job_id: Export job ID for tracking
        user_id: User ID for R2 path prefix
        job_type: 'framing' | 'overlay' | 'annotate'
        input_key: R2 key for input video (without user prefix)
        output_key: R2 key for output video (without user prefix)
        params: Job-specific parameters
        progress_callback: Optional callback for progress updates

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if not MODAL_ENABLED:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    # Import Modal function (lazy import to avoid issues when Modal not installed)
    from modal_functions.video_processing import process_video

    logger.info(f"[{job_id}] Submitting to Modal: {job_type}")

    # Modal functions are sync but we run in thread to not block
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: process_video.remote(
            job_id=job_id,
            user_id=user_id,
            job_type=job_type,
            input_key=input_key,
            output_key=output_key,
            params=params,
        )
    )

    logger.info(f"[{job_id}] Modal result: {result}")
    return result


async def process_video(
    job_id: str,
    user_id: str,
    job_type: str,
    input_key: str,
    output_key: str,
    params: Dict[str, Any],
    progress_callback: Optional[Callable] = None,
) -> Dict[str, Any]:
    """
    Process video - uses Modal if enabled, else falls back to local FFmpeg.

    This is the main entry point called by export_worker.py.
    """
    if MODAL_ENABLED:
        return await process_video_modal(
            job_id, user_id, job_type, input_key, output_key, params, progress_callback
        )
    else:
        # Local processing continues to use existing FFmpeg code
        # No changes needed - export_worker.py handles this path
        raise RuntimeError("MODAL_ENABLED=false - use existing local processing path")
```

### Modified: services/export_worker.py

Add Modal integration to the existing worker:

```python
# At top of file, add import
from .modal_client import MODAL_ENABLED, process_video_modal

# In process_export_job(), before local processing:
async def process_export_job(job_id: str):
    """Process an export job (either via Modal or locally)."""
    job = get_export_job(job_id)
    if not job:
        logger.error(f"[ExportWorker] Job {job_id} not found")
        return

    # Mark as started
    update_job_started(job_id)
    await send_progress(job_id, 5, "Starting export...", "processing")

    try:
        config = json.loads(job['input_data'])
        job_type = job['type']

        if MODAL_ENABLED:
            # Use Modal for GPU processing
            result = await process_video_modal(
                job_id=job_id,
                user_id=get_current_user_id(),
                job_type=job_type,
                input_key=config.get('input_key', ''),
                output_key=config.get('output_key', ''),
                params=config,
                progress_callback=lambda p, m: send_progress(job_id, p, m)
            )

            if result['status'] == 'success':
                # Update database with output
                update_job_complete(job_id, output_video_id=None, output_filename=result['output_key'])
                await send_progress(job_id, 100, "Export complete", "complete")
            else:
                update_job_error(job_id, result.get('error', 'Unknown error'))
                await send_progress(job_id, 0, result.get('error'), "error")
        else:
            # Continue with existing local FFmpeg processing
            # ... (existing code unchanged)

    except Exception as e:
        logger.exception(f"[ExportWorker] Job {job_id} failed")
        update_job_error(job_id, str(e))
        await send_progress(job_id, 0, str(e), "error")
```

---

## WebSocket Progress with Modal

Modal functions can send progress updates via a generator pattern:

```python
# In modal_functions/video_processing.py
@app.function(...)
def process_video_with_progress(...):
    """Generator version that yields progress updates."""
    yield {"progress": 10, "message": "Downloading from R2..."}
    # ... download
    yield {"progress": 30, "message": "Processing video..."}
    # ... process
    yield {"progress": 90, "message": "Uploading to R2..."}
    # ... upload
    yield {"status": "success", "output_key": "..."}
```

The backend can consume this and relay to WebSocket:

```python
async for update in process_video_with_progress.remote_gen(...):
    if 'progress' in update:
        await send_progress(job_id, update['progress'], update['message'])
    if 'status' in update:
        return update
```

---

## Environment Variables

Add to `.env`:

```bash
# Enable Modal for GPU processing (set to false for local FFmpeg)
MODAL_ENABLED=false  # Default: use local FFmpeg

# Modal credentials (only needed on Fly.io, CLI uses local auth)
MODAL_TOKEN_ID=xxx
MODAL_TOKEN_SECRET=xxx
```

---

## NO API Changes

The existing `/api/exports/*` endpoints remain unchanged:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/exports` | Start export job |
| `GET /api/exports/{job_id}` | Get job status |
| `GET /api/exports/active` | List active exports (for recovery) |
| `DELETE /api/exports/{job_id}` | Cancel job |

Frontend continues to use WebSocket for real-time progress.

---

## Local Development

Local dev can use either:

1. **Local FFmpeg** (default): `MODAL_ENABLED=false`
   - No Modal account needed
   - Processes on your machine
   - All existing behavior unchanged

2. **Modal GPU**: `MODAL_ENABLED=true`
   - Uses Modal's cloud GPU
   - Requires `modal token new`
   - Good for testing Modal integration before deployment

---

## Deliverables

| Item | Description |
|------|-------------|
| services/modal_client.py | Modal function caller with fallback |
| Modified export_worker.py | Conditional Modal integration |
| Environment variable | MODAL_ENABLED toggle |
| WebSocket progress relay | Modal progress -> WebSocket |

---

## Next Step
Task 08 - Frontend Export Updates (verify WebSocket progress works with Modal)
