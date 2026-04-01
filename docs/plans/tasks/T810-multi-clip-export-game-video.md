# T810: Multi-Clip Export Fails for Game Video Clips

**Status:** TESTING
**Impact:** 9
**Complexity:** 6
**Created:** 2026-04-01
**Updated:** 2026-04-01

## Problem

Multi-clip framing export fails with "Failed to download clip 1: Clip not found" for game-video clips. The frontend tries to download each clip's file via `/api/clips/projects/{id}/clips/{clipId}/file` and upload it to the multi-clip export endpoint. But game-video clips don't have standalone files — they use range queries on the source game video (T740).

This is a critical blocker: users with custom multi-clip projects (like the Quest 4 highlight reel) cannot export.

### Error Flow
1. Frontend `ExportButtonContainer.jsx:528-529` — fetches `/clips/{id}/file?stream=true`
2. Backend returns 404 — clip has no `filename` (game-video clip)
3. Export aborts with "Failed to download clip 1: Clip not found"

### Root Cause
T740 merged extraction into framing export, but only updated the **single-clip** export path (`framing.py`). The **multi-clip** export path (`multi_clip.py`) still expects uploaded video files from the frontend, which requires standalone clip files that no longer exist.

## Solution

Make multi-clip export resolve clip sources from the DB (like single-clip export already does), instead of requiring the frontend to upload video files.

### Approach: Backend-Resolved Clips

**Frontend changes** (`ExportButtonContainer.jsx`):
- For multi-clip export, don't download/upload clip files
- Send `project_id` and per-clip metadata (cropKeyframes, segments, trimRange)
- Let the backend resolve video sources from the DB

**Backend changes** (`multi_clip.py`):
- When `project_id` is provided and no video files are uploaded, resolve clips from DB
- Query `working_clips JOIN raw_clips JOIN games` (same as `framing.py:727-749`)
- For game clips: download game video from R2, extract clip range with FFmpeg
- For uploaded clips: use `raw_filename` or `uploaded_filename` from R2
- Process each clip through the existing pipeline (crop, upscale, etc.)

### Reference: Single-Clip Export Pattern
`framing.py:828-926` shows how single-clip resolves video sources:
```python
if clip['game_id']:
    # Download game video from R2, extract clip range
    source_start_time = clip['raw_start_time']
    source_end_time = clip['raw_end_time']
    # ... downloads game video, extracts range with FFmpeg
else:
    # Use raw_filename directly from R2
    source_start_time = 0.0
```

## Context

### Relevant Files
- `src/frontend/src/containers/ExportButtonContainer.jsx` — Lines 518-592: multi-clip file download/upload
- `src/backend/app/routers/export/multi_clip.py` — Lines 1142-1310: multi-clip export endpoint
- `src/backend/app/routers/export/framing.py` — Lines 725-926: single-clip export (reference pattern)

### Related Tasks
- T740: Merged extraction into framing export (single-clip path)
- T790: Removed extraction triggers (exposed this bug)

## Acceptance Criteria

- [ ] Multi-clip export works for game-video clips (no standalone files)
- [ ] Multi-clip export still works for uploaded clips
- [ ] Frontend doesn't download/upload clip files for game-video clips
- [ ] Backend resolves clip sources from DB when no files uploaded
- [ ] Quest 4 "Frame Your Reel" step completable with multi-game project
- [ ] Backend import check passes
- [ ] Frontend build passes
