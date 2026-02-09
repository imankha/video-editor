# Progress Bar Improvements

## Problem Statement

The progress bar has reliability issues:
1. Progress starts, then resets to zero before Modal connection is established
2. Progress is based on time estimates rather than actual processing milestones
3. No way to give users accurate "estimated completion time"

## Current Architecture

### Frontend Progress Flow
- `ExportButton.jsx` tracks `localProgress` during upload phase (0-10%)
- `useExportRecovery.js` reconnects to in-progress exports on page load
- `ExportWebSocketManager.js` receives progress updates via WebSocket
- `exportStore.js` holds progress state from WebSocket updates

### Backend Progress Flow
- `multi_clip.py` sends progress via WebSocket manager
- `modal_client.py` simulates progress while waiting for Modal (time-based estimates)
- Modal functions don't report real-time progress (fire and forget with polling)

### Known Issues
1. **Progress reset**: Upload progress (local) gets overwritten by store progress (0%) when WebSocket connects
2. **Time-based simulation**: Progress is estimated based on assumed processing times, not actual work completed
3. **No actual Modal progress**: Modal functions process frames but don't report back progress

## Proposed Improvements

### Phase 1: Add Progress Event Logging

Add structured logging to capture actual timing data:

```python
# In modal_client.py
logger.info(f"[Progress Event] job={job_id} phase=upload_start")
logger.info(f"[Progress Event] job={job_id} phase=upload_complete elapsed={elapsed}s")
logger.info(f"[Progress Event] job={job_id} phase=modal_spawn elapsed={elapsed}s")
logger.info(f"[Progress Event] job={job_id} phase=modal_complete elapsed={elapsed}s total={total}s")
```

Log events:
- `upload_start` - Files start uploading to R2
- `upload_complete` - All files uploaded
- `modal_spawn` - Modal job spawned
- `modal_polling` - Polling for completion (with poll count)
- `modal_complete` - Modal job finished
- `download_start` - Result download begins
- `download_complete` - Result downloaded
- `finalize_complete` - DB updated, job complete

### Phase 2: Analyze Timing Data

Collect data on actual processing times:
- Upload time vs file size
- Modal cold start time
- Processing time per frame (Real-ESRGAN)
- Processing time per clip
- Download time vs output size

Build a model:
```
estimated_time = upload_time(file_sizes)
               + cold_start_probability * cold_start_time
               + frames * time_per_frame
               + download_time(estimated_output_size)
```

### Phase 3: Real Modal Progress (Optional)

Options for getting actual progress from Modal:
1. **Modal Outputs** - Use `modal.outputs()` to stream progress (requires Modal function changes)
2. **R2 Progress File** - Modal writes progress to R2, backend polls it
3. **Modal Webhook** - Modal calls back to our API with progress updates

### Phase 4: Fix Progress Reset Bug

In `ExportButton.jsx`, the issue is mixing local and store progress:
```javascript
// Current (problematic):
const displayProgress = isInUploadPhase ? localProgress : storeProgress;

// Should track phases explicitly:
// - Phase 1: Upload (0-10%) - local tracking
// - Phase 2: Processing (10-95%) - store tracking
// - Phase 3: Finalize (95-100%) - store tracking
```

Need to ensure smooth handoff between phases without resets.

### Phase 5: Estimated Completion Time

Once we have reliable timing data:
```javascript
// Calculate ETA based on current progress and elapsed time
const elapsed = Date.now() - startTime;
const rate = progress / elapsed;
const remaining = (100 - progress) / rate;
const eta = new Date(Date.now() + remaining);
```

Display as:
- "About 2 minutes remaining"
- "Less than a minute remaining"
- "Almost done..."

## Implementation Order

1. [x] Add progress event logging (backend) - DONE
2. [ ] Collect timing data from real exports (analysis) - Data now being collected via logs
3. [x] Fix progress reset bug (frontend) - DONE (was already fixed in earlier changes)
4. [ ] Improve time estimates based on data (backend) - Using elapsed/progress ratio
5. [x] Add ETA display to UI (frontend) - DONE
6. [ ] (Optional) Real Modal progress streaming

## Completed Changes (2026-02-06)

### Backend Progress Event Logging
- Added `log_progress_event()` helper function to `modal_client.py` and `framing.py`
- Logs structured events: `[Progress Event] job=xxx phase=yyy elapsed=zzz`
- Phases tracked: `modal_start`, `modal_spawn`, `modal_complete`, `modal_error`
- Extra data: frames, fps_actual, clips count for analysis
- Works for both Modal (cloud GPU) and local GPU paths

### Frontend ETA Display
- Added `calculateETA()` function in `GlobalExportIndicator.jsx`
- Uses elapsed time and current progress percentage to estimate remaining time
- Shows human-friendly format: "About 2 minutes", "Less than a minute"
- Displayed in both collapsed and expanded export indicator views

### Real Modal Progress Streaming (NEW)
Implemented real-time progress from Modal using `.remote_gen()` instead of spawn/get:

**Modal Functions (video_processing.py):**
- `process_framing_ai`: Now a generator that yields progress at each phase
  - Download: 5-12%
  - Load model: 14-18%
  - Upscaling: 18-75% (yields every 15 frames with actual frame count)
  - Encoding: 76-88%
  - Upload: 90-100%
- `render_overlay`: Now a generator that yields progress at major phases
  - Download: 10-20%
  - Processing: 25-80%
  - Upload: 85-100%

**Modal Client (modal_client.py):**
- `call_modal_framing_ai`: Uses `remote_gen()` to iterate over yielded progress
- `call_modal_overlay`: Uses `remote_gen()` to iterate over yielded progress
- Progress updates forwarded to WebSocket in real-time

**Benefits:**
- Progress based on actual frames processed, not time estimates
- More accurate ETA calculations
- Users see real processing milestones (download, upscale, encode, upload)

**Note:** Multi-clip export (`process_multi_clip_modal`) still uses time-based simulation.
This can be converted to streaming progress in a future update if needed.

### Annotate Export WebSocket Progress (2026-02-08)

Converted annotate export from SSE polling to WebSocket streaming:

**Backend (annotate.py):**
- Removed SSE endpoint and `_export_progress` dictionary
- Added WebSocket-based `update_progress()` function
- Modal path: Maps Modal's 0-100% to 10-100% overall using `10 + int(progress * 0.9)`
- This prevents progress from going backwards after initial backend steps (0-7%)

**Frontend (AnnotateContainer.jsx):**
- Changed from EventSource to ExportWebSocketManager
- Uses shared ExportProgress component (same as framing/overlay)

**Commits:** 1c25ba0, bf41508, da9d67a, 5cfadb2

## Files to Modify

- `src/backend/app/services/modal_client.py` - Add logging, improve estimates
- `src/backend/app/routers/export/multi_clip.py` - Add logging
- `src/frontend/src/components/ExportButton.jsx` - Fix progress phases
- `src/frontend/src/components/GlobalExportIndicator.jsx` - Add ETA display
- `src/backend/app/modal_functions/video_processing.py` - (Optional) Progress streaming

## Success Metrics

- Progress never resets/jumps backward unexpectedly
- Estimated time within 20% of actual time
- Users can see meaningful progress during all phases
