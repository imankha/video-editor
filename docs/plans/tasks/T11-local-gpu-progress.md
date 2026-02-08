# T11: Local GPU Progress Bar (modal_enabled=false)

**Status:** DONE
**Impact:** MEDIUM
**Complexity:** LOW
**Created:** 2026-02-08
**Updated:** 2026-02-08

## Problem

When `MODAL_ENABLED=false`, the annotate export progress bar doesn't show incremental progress updates. Users see no feedback while local FFmpeg processes clips, making it seem like the app is frozen.

The framing and overlay exports already have working progress with local GPU - annotate should match.

## Solution

Add progress callbacks to the local FFmpeg processing path in the annotate export, similar to how framing/overlay handle local processing.

## Context

### Background

T10 (Progress Bar Improvements) fixed the WebSocket-based progress for Modal exports. However, when Modal is disabled (`MODAL_ENABLED=false`), the local processing path doesn't send incremental progress updates.

The issue is in `src/backend/app/routers/annotate.py` in the local processing branch (when `modal_enabled()` returns False). The code processes clips in a loop but only updates progress at the start of each clip, not during the actual FFmpeg processing.

### Relevant Files

**Backend:**
- `src/backend/app/routers/annotate.py` - Export endpoint with local processing path (lines 796-838)
- `src/backend/app/routers/export/framing.py` - Working local progress example
- `src/backend/app/routers/export/overlay.py` - Working local progress example (lines 1707-1738)
- `src/backend/app/ai_upscaler/__init__.py` - Sub-frame progress callback pattern

**Frontend:**
- `src/frontend/src/containers/AnnotateContainer.jsx` - WebSocket progress handling
- `src/frontend/src/modes/AnnotateModeView.jsx` - Uses shared ExportProgress component
- `src/frontend/src/components/shared/ExportProgress.jsx` - Shared progress bar component

### Related Tasks
- Depends on: T10 (Progress Bar Improvements) - DONE
- Related to: T12 (Progress Bar State Recovery)

### Technical Notes

The local processing path in annotate.py:
```python
else:
    # Local processing (fallback or when Modal not available)
    for idx, clip in enumerate(all_clips):
        step += 1
        await update_progress(step, total_steps, 'clips', f'Creating clip {idx + 1}/{len(all_clips)}: {clip_name}')
        # ... FFmpeg processing happens here with no sub-progress ...
```

Compare to overlay's local progress callback pattern (overlay.py:1707-1738) which captures the event loop and sends WebSocket updates from the processing thread.

## Implementation

### Steps
1. [x] Review how overlay.py sends local progress updates (lines 1707-1738)
2. [x] Use same progress allocation as Modal (15-85% for clips)
3. [x] Apply same 10 + progress * 0.9 mapping for consistency
4. [x] Test with `MODAL_ENABLED=false` to verify incremental progress
5. [x] Add DRY download progress helper for all exporters
6. [x] Show incremental progress during R2 download (5% → 15%)

### Progress Log

**2026-02-08**: Implemented consistent progress for local annotate export.
- Modified local processing path to use Modal's progress allocation formula
- Clips get 15-85% (70% range, evenly distributed across all clips)
- Concatenation at 85%, upload at 92%
- Progress now shows: 0% → 3% → 23% → 26% → 28% → ... → 86% → 92% → 100%
- Committed as b4fd340

**2026-02-08**: Added DRY download progress for all exporters.
- Created `download_from_r2_with_progress()` helper in storage.py
- Gets file size first, sends progress updates every 2% during download
- Shows "Downloading... (X MB)" with actual bytes downloaded
- Used by annotate, framing, and overlay exporters
- Progress smoothly transitions 5% → 15% during download
- Committed as 30f0624

## Acceptance Criteria

- [x] Progress bar shows incremental updates during local annotate export
- [x] Progress doesn't jump from 0% to 100% between clips
- [x] Works consistently with `MODAL_ENABLED=false`
- [x] Matches behavior of Modal exports (same progress allocation)
- [x] Download phase shows incremental progress (not just start/end)
- [x] DRY code shared across all exporters
