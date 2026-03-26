# T730: Missing Player Tracking Detection Point at End of Overlay Region

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-03-26
**Updated:** 2026-03-26

## Problem

During framing export, the backend runs YOLO player detection at evenly-spaced points along the overlay region. These appear as green tracking squares on the timeline. For short clips (~1-2 seconds), only 3 detection points are generated when 4 are expected — the last point at the end of the overlay region is missing.

Observed on a 1.001-second clip (30 frames at 30fps, played at 0.5x = 2 seconds effective). The timeline shows 3 green detection markers but should show 4, with the final one at the end of the region.

## Observed Data

- Video duration: 1.001s (30 frames at 30fps)
- Segment speed: 0.5x → 2s effective duration
- Overlay region: 1 region restored with detection data, duration 2s
- Detection points visible: 3 (expected 4)
- Missing: the endpoint at the end of the overlay region

## Likely Root Cause

The detection point distribution logic in the Modal framing pipeline (or local fallback) spaces points evenly but either:
1. Uses `<` instead of `<=` for the end boundary, skipping the final point
2. Calculates N intervals but only generates N points instead of N+1 (fence-post error)
3. Has a rounding/precision issue where the last point falls slightly outside the region bounds and gets clipped

## Context

### Relevant Files (REQUIRED)

**Backend — Modal GPU processing:**
- `src/backend/app/modal_functions/video_processing.py` — Modal GPU functions including player detection (`detect_players_modal`)
- `src/backend/app/services/modal_client.py` — `call_modal_framing_ai` which orchestrates the framing pipeline
- `src/backend/app/services/local_processors.py` — Local fallback for framing with detection

**Backend — Detection/tracking:**
- `src/backend/app/routers/detection.py` — YOLO detection endpoints
- `src/backend/app/services/detection_service.py` — Player detection service (if exists)

**Frontend — Display:**
- `src/frontend/src/modes/overlay/layers/HighlightLayer.jsx` — Renders detection markers on timeline
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` — Manages highlight regions with detection data

### How Detection Points Are Created

The framing export pipeline:
1. User clicks "Frame Video" → backend creates export job
2. Modal (or local fallback) processes the video:
   - Crops/upscales frames based on crop keyframes
   - Runs YOLO player detection at evenly-spaced timestamps
   - Returns detection data as part of the export result
3. Detection data is stored with the working video
4. Frontend loads detection data and renders green squares on the overlay timeline

### Related Tasks
- Related: T710 (Play Annotations Mode — not directly related but in same session)

## Implementation

### Steps
1. [ ] Find the exact code that generates evenly-spaced detection timestamps
2. [ ] Check for fence-post error (N points for N intervals instead of N+1)
3. [ ] Verify the end boundary is inclusive
4. [ ] Test with short clips (1-2 seconds) to reproduce
5. [ ] Fix the distribution logic
6. [ ] Verify fix with the same 1.001s clip

## Acceptance Criteria

- [ ] A 1-second clip at 30fps produces 4 evenly-spaced detection points (including endpoints)
- [ ] Detection points include both the start and end of the overlay region
- [ ] Longer clips still produce correct detection point distribution
