# Phase A: Overlay Improvements

**Status**: COMPLETED
**Priority**: HIGH
**Scope**: Click-to-detect highlights (completed), 5-second default duration (completed)

---

## Overview

Enhanced the overlay system with AI-assisted click-to-detect player highlighting. Uses YOLO for single-frame object detection.

**Completed Features:**
- Click-to-detect player highlighting using YOLO
- 5-second default highlight duration

**Deprioritized (moved to roadmap):**
- ByteTrack player tracking
- Ball brightness
- Text overlays

---

## Feature 1: Click-to-Track Player Highlighting

### Concept

Instead of manually positioning highlight keyframes, users simply click on a player in the video preview. The system automatically:
1. Uses YOLO to detect the clicked player's bounding box
2. Tracks the player using ByteTrack across the highlight region duration
3. Generates ellipse keyframes matching the tracked bounding box

### User Workflow

1. User enters Overlay mode
2. User adds a highlight region (now defaults to **5 seconds** instead of 3)
3. User clicks on a player in the video preview
4. System detects which player was clicked using YOLO
5. System tracks that player for the full region duration using ByteTrack
6. Ellipse keyframes are auto-generated at **3 keyframes per second**
7. Keyframe ellipse matches tracked bounding box (position, width, height)

### Keyframe Auto-Generation Algorithm

```
Input:
  - clicked_frame: Frame where user clicked
  - clicked_position: (x, y) coordinates of click
  - region: { startFrame, endFrame }
  - tracking_results: ByteTrack output for clicked player

Output:
  - keyframes: Array of keyframes at 3 per second

Algorithm:
1. Find player bounding box closest to clicked_position at clicked_frame
2. Get ByteTrack ID for that player
3. Track player from region.startFrame to region.endFrame
4. Generate keyframes every (fps / 3) frames:
   For each frame at interval:
     - Get bounding box from tracking results
     - Create keyframe:
       {
         frame: current_frame,
         x: bbox.centerX,
         y: bbox.centerY,
         width: bbox.width,
         height: bbox.height,
         origin: 'auto'  // New origin type for auto-generated
       }
5. Ensure first and last keyframes exist (permanent)
6. Return keyframes array
```

### Duration Change Behavior

When user changes the highlight region duration:
1. Clear all `origin: 'auto'` keyframes
2. Re-run tracking for new duration
3. Re-generate keyframes using the algorithm above
4. Preserve any `origin: 'user'` keyframes (manual overrides)

### Manual Override

Users can still:
- Delete individual auto-generated keyframes
- Drag/resize the ellipse to create manual keyframes
- Manual keyframes (`origin: 'user'`) are preserved on duration changes

---

## Feature 2: Ball Detection & Brightening

### Concept

Automatically detect the ball in video frames and allow users to apply brightness enhancement to make it more visible. Uses YOLO with the highest confidence detection for "ball" class.

### User Workflow

1. User enters Overlay mode
2. User clicks "Add Ball Effect" or similar control
3. System runs YOLO ball detection across the clip
4. Highest confidence ball detection per frame is tracked
5. User adjusts brightness slider (preview in real-time)
6. Brightness overlay is applied to ball region during export

### Ball Detection Algorithm

```
Input:
  - video_frames: All frames in current clip
  - confidence_threshold: 0.5 (configurable)

Output:
  - ball_positions: Array of { frame, x, y, radius, confidence }

Algorithm:
1. Run YOLO inference on each frame
2. Filter for 'ball' class detections
3. For each frame, select detection with highest confidence
4. Smooth positions using simple moving average (3-frame window)
5. Interpolate missing frames (when ball not detected)
6. Return ball_positions array
```

### Brightness Slider

- Range: 0% to 200% (100% = no change)
- Preview: Apply brightness filter to ball region in canvas overlay
- Export: FFmpeg drawbox/ellipse with brightness adjustment

### UI Components

```
Ball Effect Panel:
┌─────────────────────────────────────┐
│ Ball Brightness                     │
│ [━━━━━━━━━●━━━━━] 130%             │
│                                     │
│ ○ Show ball detection overlay       │
│ [Re-detect Ball]                    │
└─────────────────────────────────────┘
```

---

## Feature 3: Text Overlay

### Concept

Add text labels to the video (player names, stats, timestamps, custom text). Text overlays support keyframe animation for position, size, and opacity.

### User Workflow

1. User clicks "Add Text" in overlay mode
2. Text input dialog appears
3. User enters text content
4. Text appears in center of video
5. User drags to position
6. User can add keyframes for animation
7. Text is rendered in export

### Text Overlay Data Model

```typescript
interface TextOverlay {
  id: string;
  content: string;
  fontFamily: 'Inter' | 'Roboto' | 'Arial' | 'Impact';
  fontSize: number;         // 12 to 120
  fontWeight: 'normal' | 'bold';
  color: string;            // hex color
  backgroundColor?: string; // hex color with alpha
  opacity: number;          // 0 to 1
  region: {
    startFrame: number;
    endFrame: number;
  };
  keyframes: TextKeyframe[];
}

interface TextKeyframe {
  frame: number;
  x: number;       // center position
  y: number;       // center position
  scale: number;   // 0.5 to 3.0
  opacity: number; // 0 to 1
  rotation: number; // degrees
  origin: 'permanent' | 'user';
}
```

### UI Components

```
Text Properties Panel:
┌─────────────────────────────────────┐
│ Text Content                        │
│ [Player Name________________]       │
│                                     │
│ Font: [Inter ▼]  Size: [36]        │
│ Weight: [● Normal ○ Bold]          │
│                                     │
│ Color: [■ #FFFFFF]                 │
│ Background: [□ None]               │
│ Opacity: [━━━━━━━━●━] 100%         │
│                                     │
│ [Delete Text]                       │
└─────────────────────────────────────┘
```

---

## Default Highlight Duration Change

**Change**: Default highlight region duration from 3 seconds to **5 seconds**.

### Files to Modify

| File | Change |
|------|--------|
| `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` | Update `DEFAULT_REGION_DURATION` constant |
| `src/frontend/src/modes/overlay/OverlayMode.jsx` | Update any hardcoded duration references |

---

## Implementation Tasks

### Task 1: Change Default Highlight Duration to 5 Seconds ✅ COMPLETED
**Estimated Effort**: Small
**Files Modified**:
- [useHighlightRegions.js](src/frontend/src/modes/overlay/hooks/useHighlightRegions.js)

**Testable Outcome**:
- [x] Add a new highlight region
- [x] Verify it spans 5 seconds (150 frames at 30fps)
- [x] Verify exported video shows 5-second highlight

---

### Task 2: Add YOLO Player Detection Endpoint ✅ COMPLETED
**Estimated Effort**: Medium
**Files Created/Modified**:
- Created: `src/backend/app/routers/detection.py`
- Modified: `src/backend/app/main.py` (registered router)
- Reference: `src/backend/yolov8x.pt` (existing model)

**API Contract**:
```
POST /api/detect/players
Request: { video_path: string, frame_number: int }
Response: {
  detections: [{
    bbox: { x, y, width, height },
    confidence: float,
    class: 'person'
  }]
}
```

**Testable Outcome**:
- [x] Call endpoint with a video frame
- [x] Receive list of player bounding boxes
- [x] Confidence scores are present

---

### Task 3: Add ByteTrack Integration ❌ NOT IMPLEMENTING
**Decision**: ByteTrack continuous tracking adds complexity without proportional user value. Single-frame YOLO detection (Task 4) provides sufficient functionality for positioning highlight ellipses.

~~**Estimated Effort**: Medium~~
~~**Files to Create/Modify**:~~
~~- Create: `src/backend/app/tracking/bytetrack.py`~~
~~- Modify: `src/backend/app/routers/detection.py`~~

---

### Task 4: Click-to-Detect UI Integration ✅ COMPLETED
**Estimated Effort**: Medium
**Files Created/Modified**:
- Created: `src/frontend/src/modes/overlay/hooks/usePlayerDetection.js`
- Modified: `src/frontend/src/modes/overlay/OverlayMode.jsx`
- Created: `src/frontend/src/modes/overlay/overlays/DetectionOverlay.jsx`

**Testable Outcome**:
- [x] Click on video in overlay mode triggers detection
- [x] See loading indicator while YOLO processes
- [x] Player detection boxes shown temporarily
- [x] Click on a detected player
- [x] See highlight ellipse positioned at player location

---

### Task 5: Auto-Generate Keyframes from Tracking ❌ NOT IMPLEMENTING
**Decision**: Depends on ByteTrack (Task 3) which is not being implemented.

---

### Task 6: Duration Change Re-Tracking ❌ NOT IMPLEMENTING
**Decision**: Depends on ByteTrack (Task 3) which is not being implemented.

---

### Task 7: Manual Override Preservation ❌ NOT IMPLEMENTING
**Decision**: Depends on ByteTrack (Task 3) which is not being implemented. Manual keyframe editing already works without this.

---

### Task 8: Ball Detection Endpoint ❌ NOT IMPLEMENTING
**Decision**: Ball brightness feature not being implemented. YOLO ball detection has high false positive rate on logos/watermarks, and the feature adds complexity without sufficient user value.

---

### Task 9: Ball Brightening UI ❌ NOT IMPLEMENTING
**Decision**: Ball brightness feature not being implemented.

---

### Task 10: Ball Brightening Export ❌ NOT IMPLEMENTING
**Decision**: Ball brightness feature not being implemented.

---

### Task 11: Text Overlay Data Model ⏸️ DEPRIORITIZED
**Decision**: Text overlays moved to roadmap for future consideration.

---

### Task 12: Text Overlay UI Components ⏸️ DEPRIORITIZED
**Decision**: Text overlays moved to roadmap for future consideration.

---

### Task 13: Text Overlay Timeline Integration ⏸️ DEPRIORITIZED
**Decision**: Text overlays moved to roadmap for future consideration.

---

### Task 14: Text Overlay Export ⏸️ DEPRIORITIZED
**Decision**: Text overlays moved to roadmap for future consideration.

---

## Files Summary

### Files Created ✅

| File | Purpose | Status |
|------|---------|--------|
| `src/backend/app/routers/detection.py` | YOLO detection endpoints | ✅ Created |
| `src/frontend/src/modes/overlay/hooks/usePlayerDetection.js` | Player click-to-detect | ✅ Created |
| `src/frontend/src/modes/overlay/overlays/DetectionOverlay.jsx` | Detection boxes UI | ✅ Created |

### Files Not Creating (Features Deprioritized)

| File | Reason |
|------|--------|
| ~~`src/backend/app/tracking/bytetrack.py`~~ | ByteTrack deprioritized |
| ~~`src/frontend/src/modes/overlay/hooks/useBallEffect.js`~~ | Ball brightness deprioritized |
| ~~`src/frontend/src/modes/overlay/components/BallEffectPanel.jsx`~~ | Ball brightness deprioritized |
| ~~`src/frontend/src/modes/overlay/hooks/useTextOverlays.js`~~ | Text overlays deprioritized |
| ~~`src/frontend/src/modes/overlay/contexts/TextOverlayContext.jsx`~~ | Text overlays deprioritized |
| ~~`src/frontend/src/modes/overlay/components/TextPropertiesPanel.jsx`~~ | Text overlays deprioritized |
| ~~`src/frontend/src/modes/overlay/overlays/TextOverlay.jsx`~~ | Text overlays deprioritized |
| ~~`src/frontend/src/modes/overlay/layers/TextLayer.jsx`~~ | Text overlays deprioritized |

### Files Modified ✅

| File | Changes | Status |
|------|---------|--------|
| `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` | Default duration 5 seconds | ✅ Modified |
| `src/frontend/src/modes/overlay/OverlayMode.jsx` | Detection integration | ✅ Modified |
| `src/backend/app/main.py` | Register detection router | ✅ Modified |


---

## Dependencies

### Python Packages (Backend)

```
ultralytics>=8.0.0      # YOLO
numpy>=1.24.0
opencv-python>=4.8.0
# supervision>=0.18.0   # Not needed - ByteTrack not implementing
```

### Model Files

| Model | Location | Purpose |
|-------|----------|---------|
| yolov8x.pt | `src/backend/` | Player detection |

---

## Acceptance Criteria

### Click-to-Detect Highlighting ✅ COMPLETED
- [x] Can click on video to detect players
- [x] Can click on detected player to position highlight
- [x] Highlight ellipse appears at player location
- [x] Export shows highlight correctly

### ~~ByteTrack Player Tracking~~ ❌ NOT IMPLEMENTING
~~- [ ] Keyframes generated at 3 per second~~
~~- [ ] Ellipse follows player smoothly during playback~~
~~- [ ] Duration change regenerates keyframes~~
~~- [ ] Manual keyframes preserved on duration change~~

### ~~Ball Brightening~~ ❌ NOT IMPLEMENTING
~~- [ ] Ball detection runs and identifies ball~~
~~- [ ] Brightness slider adjusts brightness level~~
~~- [ ] Preview shows ball brightening in real-time~~
~~- [ ] Export includes ball brightening effect~~

### ~~Text Overlay~~ ⏸️ DEPRIORITIZED
~~- [ ] Can add text overlay~~
~~- [ ] Can edit text content, font, size, color~~
~~- [ ] Can position text via drag~~
~~- [ ] Can animate text with keyframes~~
~~- [ ] Text appears correctly in export~~

### Default Duration ✅ COMPLETED
- [x] New highlight regions default to 5 seconds
- [x] Existing projects with 3-second highlights still work

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| YOLO detection slow | Run detection in background, show loading state ✅ Implemented |
| Text rendering differs | Use consistent font rendering (canvas preview matches FFmpeg) |

---

## Notes

- All AI detection runs server-side (Python backend)
- Preview uses canvas overlays, export uses FFmpeg
- Keyframe interpolation uses existing spline system
- Detection results can be cached per video to avoid re-processing

## Completion Summary

**Completed:**
- ✅ Task 1: Default highlight duration changed to 5 seconds
- ✅ Task 2: YOLO player detection endpoint
- ✅ Task 4: Click-to-detect UI integration

**Deprioritized (moved to roadmap):**
- ⏸️ Task 3: ByteTrack integration (complexity vs value)
- ⏸️ Tasks 5-7: Auto-keyframe generation from tracking (depends on ByteTrack)
- ⏸️ Tasks 8-10: Ball brightness (high false positive rate, complexity vs value)
- ⏸️ Tasks 11-14: Text overlays (deprioritized)
