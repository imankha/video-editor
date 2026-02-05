# Player Detection Plan (U8)

## Status: COMPLETE

## Overview

**U8**: Auto player detection during framing export - creates overlay keyframes automatically with detected player positions.

~~**U7**: Player detection in Framing mode~~ - REMOVED (detection is expensive, only run during export)

## What Was Built

### Backend

1. **Batch Detection Modal Function** (`modal_functions/video_processing.py`)
   - `detect_players_batch_modal()` - detects players across multiple timestamps in one GPU call
   - Downloads video once, runs YOLO on each frame
   - Returns bounding boxes with confidence scores

2. **Modal Client Wrapper** (`services/modal_client.py`)
   - `call_modal_detect_players_batch()` - async wrapper for the Modal function

3. **Multi-Clip Export Integration** (`routers/export/multi_clip.py`)
   - `calculate_detection_timestamps()` - calculates 4 timestamps per clip (0s, 0.66s, 1.33s, 2s within overlay region)
   - `run_player_detection_for_highlights()` - runs detection, creates keyframes with player positions
   - Integrated into export flow after video encoding

4. **Single-Clip Export Integration** (`routers/export/framing.py`)
   - Same detection integration for single-clip `/render` endpoint
   - Saves `highlights_data` with detected keyframes

5. **Removed Legacy Endpoint**
   - Removed `/upscale` endpoint (replaced by `/render`)
   - Added proper error handling for missing projectId/saveCurrentClipState

### Frontend

1. **Removed Manual Detection UI** (`OverlayModeView.jsx`, `OverlayContainer.jsx`)
   - Removed "Detect Players" button
   - Kept player boxes toggle for viewing pre-detected boxes

2. **Cleaned Up Dead Code**
   - Removed `triggerDetection` and `canDetect` from prop chain
   - Updated `usePlayerDetection.js` hook

## How It Works

```
User clicks "Frame Video"
    ↓
Video encodes (AI upscaling)
    ↓
Progress: "Detecting players..." (92%)
    ↓
Batch detection runs on 4 timestamps per clip (0s, 0.66s, 1.33s, 2s)
    ↓
Raw detection data saved to highlight regions:
  - detections: [{ timestamp, boxes: [{x, y, width, height, confidence}] }]
  - keyframes: [] (empty - user creates by clicking)
    ↓
highlights_data saved to working_videos table
    ↓
User enters Overlay mode
    ↓
Timeline shows GREEN BAR for regions with detection data
    ↓
User scrubs to detection area → sees player bounding boxes
    ↓
User clicks a box → keyframe created with GREEN DOT indicator
```

## User Flow

1. **Export** - Click "Frame Video", detection runs automatically at 92%
2. **Timeline** - Green bar shows which clips have detection data available
3. **Scrub** - Move playhead near detection timestamps to see boxes
4. **Click** - Click a player box to create a keyframe at that position
5. **Confirm** - Keyframe has green dot indicating it came from detection

## Modal Disabled Behavior

When `MODAL_ENABLED=false`:
- Detection is skipped
- Default highlight regions are created (centered, default size)
- No error - graceful fallback

## Success Criteria (All Met)

- [x] Detection runs as part of framing export (server-side)
- [x] Progress bar shows "Detecting players..." phase
- [x] 4 keyframes created per clip (within 2s overlay region)
- [x] Keyframes saved to DB with player boxes
- [x] User enters Overlay mode with keyframes ready
- [x] Manual detect button removed
- [x] Works with single-clip and multi-clip projects
- [x] Gracefully handles detection failures (proceeds without keyframes)

## Files Modified

### Backend
| File | Changes |
|------|---------|
| `modal_functions/video_processing.py` | Added `detect_players_batch_modal()` |
| `services/modal_client.py` | Added `call_modal_detect_players_batch()` |
| `routers/export/multi_clip.py` | Added detection integration |
| `routers/export/framing.py` | Added detection integration, removed `/upscale` |

### Frontend
| File | Changes |
|------|---------|
| `modes/OverlayModeView.jsx` | Removed manual detect button |
| `containers/OverlayContainer.jsx` | Removed detection trigger props |
| `screens/OverlayScreen.jsx` | Removed detection trigger props |
| `modes/overlay/hooks/usePlayerDetection.js` | Removed manual trigger function |
| `components/ExportButton.jsx` | Removed `/upscale` fallback, added error handling |

## Testing

### Manual Test Steps

1. **Start servers**: `npm run dev` (frontend), `uvicorn app.main:app --reload` (backend)
2. **Ensure Modal enabled**: Set `MODAL_ENABLED=true` in backend
3. **Create/open a project** with at least one clip
4. **Go to Framing mode** and set up crop
5. **Click "Frame Video"** to export
6. **Watch progress bar** - should show "Detecting players..." around 92%
7. **When complete**, go to Overlay mode
8. **Check timeline** - should see GREEN BAR at bottom of highlight region (first 2s)
9. **Scrub to 0s, 0.66s, 1.33s, or 2s** - should see player bounding boxes appear
10. **Enable "Show Player Boxes"** toggle if boxes not visible
11. **Click a player box** - should create a keyframe
12. **Verify keyframe** - should have GREEN DOT inside the orange diamond

### What to Look For

| Check | Expected |
|-------|----------|
| Progress shows "Detecting players..." | Yes, around 92% |
| Green bar on timeline | Yes, in regions with detection data |
| Detection boxes appear when scrubbing | Yes, within 0.5s of detection timestamps |
| Click box creates keyframe | Yes |
| Keyframe has green dot | Yes (indicates from detection) |
| Works with Modal disabled | Yes (no green bar, no boxes - graceful fallback) |

### Automated Tests

```bash
cd src/backend
MODAL_ENABLED=true .venv/Scripts/python.exe experiments/test_batch_detection.py
```

## Future Work

### Unify Single-Clip and Multi-Clip Export Endpoints

Currently there are two separate export paths:
- `/api/export/render` - single-clip, uses `framing_ai` Modal function
- `/api/export/multi-clip` - multi-clip, uses `multi_clip_export_modal` Modal function

A single clip is just a special case of multi-clip (N=1). These should be unified:
1. Consolidate to single `/api/export/render` endpoint that handles both cases
2. Single Modal function that handles 1-N clips
3. Frontend sends same request format regardless of clip count
4. Simplifies code maintenance and ensures feature parity
