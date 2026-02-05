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
Batch detection runs on 4 timestamps per clip
    ↓
Keyframes created with detected player positions:
  - x, y: center of detected player
  - radiusX, radiusY: based on bounding box size
  - detected: true (flag for UI)
  - confidence: detection confidence score
    ↓
highlights_data saved to working_videos table
    ↓
User enters Overlay mode with keyframes ready
```

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
8. **Check keyframes** - should have 4 keyframes with detected player positions
9. **Toggle player boxes** - should show bounding boxes at detected positions

### Automated Tests

```bash
cd src/backend
MODAL_ENABLED=true .venv/Scripts/python.exe experiments/test_batch_detection.py
```
