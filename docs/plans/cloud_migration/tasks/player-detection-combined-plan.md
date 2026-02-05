# Combined Player Detection Plan (U7 + U8)

## Overview

Two related features that build on each other:
- **U7**: Player detection in **Framing** mode - help user select which player to track
- **U8**: Auto player detection in **Overlay** mode - create keyframes automatically after framing

## Current State

- Backend: `/api/detect/players` - single-frame detection with R2 caching
- Frontend: `PlayerDetectionOverlay.jsx` - renders clickable bounding boxes
- Modal GPU: `detect_players_modal` function exists
- Detection is per-frame, no batch support

## Proposed Architecture

### Phase 1: Multi-Frame Detection Endpoint (Shared)

Add new endpoint for batch detection on multiple frames:

```
POST /api/detect/players-multi
{
  "project_id": 1,
  "frame_numbers": [0, 20, 40, 60],  // OR
  "timestamps": [0.0, 0.66, 1.33, 2.0],
  "confidence_threshold": 0.5
}
```

Response:
```json
{
  "detections": [
    { "frame": 0, "timestamp": 0.0, "boxes": [...] },
    { "frame": 20, "timestamp": 0.66, "boxes": [...] },
    ...
  ]
}
```

This endpoint will:
1. Check R2 cache for each frame (skip already-detected frames)
2. Call Modal once with all uncached frames (batch efficiency)
3. Cache results for each frame
4. Return combined results

### Phase 2: U7 - Framing Mode Player Selection

**Goal**: User loads clip, sees player boxes, clicks one to center crop on them.

**User Flow**:
1. User opens clip in Framing mode
2. Auto-detect on 4 frames (0s, 0.66s, 1.33s, 2s) of **raw clip**
3. Show detection keyframe markers in timeline
4. Click keyframe → seek to that frame, show player boxes
5. Click player box → center crop on that player
6. User can scrub to verify tracking, adjust crop if needed

**Implementation**:

| Component | Changes |
|-----------|---------|
| `FramingScreen.jsx` | Trigger detection on clip load, manage detection state |
| `useCrop.js` | Add `centerOnPlayer(box)` function |
| New: `DetectionKeyframeMarkers.jsx` | Timeline markers for detection frames |
| Reuse: `PlayerDetectionOverlay.jsx` | Already handles click-to-select |

**Key Decision**: Detect on **raw clips** (not working video) because:
- Raw clips are what user sees in Framing mode
- Working video doesn't exist yet
- Each clip needs its own detection

### Phase 3: U8 - Auto Overlay Keyframes (Part of Framing Export)

**Goal**: During framing export, auto-detect players and create overlay keyframes.

**User Flow**:
1. User clicks "Frame Video" → export runs
2. Progress bar shows: "AI Upscaling... 45%" → "Detecting players... 90%" → "Complete"
3. During export (after working video created):
   - Calculate 4 keyframe positions per clip (within each 2s overlay region)
   - Run batch detection on those frames of **working video**
   - Save overlay keyframes with detected player boxes to DB
4. User proceeds to Overlay mode with keyframes ready

**Implementation**:

| Component | Changes |
|-----------|---------|
| Backend export endpoint | Add detection phase after video encoding |
| `multi_clip.py` or `framing.py` | Call detection, save overlay data |
| Progress reporter | Add "detecting" phase to progress |
| Frontend | No changes needed - detection is server-side |

**Key Decision**: Detection runs **during framing export** (server-side) because:
- Working video must exist before detection
- Progress integrates into existing export progress bar
- No extra round-trip - one export operation does everything
- Overlay data saved to DB, ready when user opens Overlay mode

### Detection Frame Count Strategy

| Mode | Target Frames | Rationale |
|------|---------------|-----------|
| Framing (U7) | 4 frames per clip | First 2 seconds of raw clip, enough to verify player |
| Overlay (U8) | 4 frames per clip × N clips | Each clip has 2s overlay region, 4 keyframes spaced within it |

For U8 with multi-clip videos:
- Each source clip has a 2s overlay region (first 2s of that clip in working video)
- Detect at 4 evenly spaced frames within each 2s region: 0s, 0.66s, 1.33s, 2s
- For 3 clips = 12 detection frames total (can batch in one Modal call)

## Implementation Order

### Step 1: Multi-Frame Detection (Backend)
- Add internal function `detect_players_batch(video_url, timestamps)`
- Implement batch Modal call (single GPU invocation for all frames)
- Add R2 cache check/store per frame
- Return list of detections per frame

### Step 2: U8 - Integrate Detection into Framing Export
- Modify `multi_clip.py` / `framing.py` export flow:
  1. Encode video (existing)
  2. Upload working video (existing)
  3. **NEW**: Calculate overlay region timestamps (4 per clip × N clips)
  4. **NEW**: Call batch detection on working video
  5. **NEW**: Save overlay keyframes to `projects.highlights_data`
  6. Return success (existing)
- Add "Detecting players..." phase to progress reporter
- Remove manual "Detect Players" button from Overlay mode

### Step 3: U7 - Framing Detection UI
- Add detection state to FramingScreen
- Trigger detection on clip load (automatic, debounced)
- Add timeline markers for detection frames
- Wire up PlayerDetectionOverlay to center crop on click
- Add "Detecting..." loading indicator

### Step 4: Polish & Edge Cases
- Handle no players detected (proceed without keyframes)
- Handle detection failures gracefully (log, continue)
- Ensure per-clip detection in Framing works with clip switching
- Test with single-clip and multi-clip projects

## Files to Create/Modify

### Backend (U8 - Detection in Export)
| File | Action | Notes |
|------|--------|-------|
| `routers/detection.py` | Modify | Add internal `detect_batch()` function |
| `services/modal_client.py` | Modify | Add `call_modal_detect_players_batch()` |
| `modal_functions/video_processing.py` | Modify | Add batch detection (multiple timestamps) |
| `routers/export/multi_clip.py` | Modify | Call detection after encoding, save keyframes |
| `routers/export/framing.py` | Modify | Same for single-clip exports |
| `services/progress_reporter.py` | Modify | Add "detecting" phase |

### Frontend (U7 - Framing Detection)
| File | Action | Notes |
|------|--------|-------|
| `screens/FramingScreen.jsx` | Modify | Add detection trigger & state on clip load |
| `components/DetectionKeyframeMarkers.jsx` | Create | Timeline markers for detection frames |
| `hooks/useCrop.js` | Modify | Add `centerOnPlayer(box)` function |
| `modes/overlay/overlays/PlayerDetectionOverlay.jsx` | Reuse | Already handles click-to-select |

### Frontend (U8 - Cleanup)
| File | Action | Notes |
|------|--------|-------|
| `modes/OverlayModeView.jsx` | Modify | Remove manual "Detect Players" button |
| `containers/OverlayContainer.jsx` | Modify | Remove manual detection trigger |

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Detection latency (GPU cold start) | Batch requests, show loading state |
| Player not detected | Fallback to manual crop/keyframe |
| Wrong player selected | Allow re-selection, multiple keyframes |
| Modal quota limits | Cache aggressively, limit frame count |

## Success Criteria

### U7 (Framing)
- [ ] Detection auto-runs on clip load (4 frames)
- [ ] Timeline shows detection keyframe markers
- [ ] Clicking marker seeks to frame + shows boxes
- [ ] Clicking box centers crop on player
- [ ] Works when switching between clips

### U8 (Overlay)
- [ ] Detection runs as part of framing export (server-side)
- [ ] Progress bar shows "Detecting players..." phase
- [ ] 4 keyframes created per clip (within 2s overlay region)
- [ ] Keyframes saved to DB with player boxes
- [ ] User enters Overlay mode with keyframes ready
- [ ] Manual detect button removed
- [ ] Works with single-clip and multi-clip projects
- [ ] Gracefully handles detection failures (proceeds without keyframes)

## Decisions

1. **U8 keyframe count**: 4 evenly spaced keyframes per clip within the 2s overlay region
2. **U7 detection trigger**: Automatic on clip load
3. **Failure handling**: Proceed without keyframes (don't block user)
4. **Progress UI**: Integrate into existing framing export progress bar (detection is part of framing flow)
