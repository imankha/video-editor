# Phase A: Overlay Improvements

**Status**: NEXT PRIORITY
**Priority**: HIGH
**Scope**: Click-to-track highlights, ball brightening, text overlays

---

## Overview

Enhance the overlay system with AI-assisted click-to-track player highlighting, ball detection with brightness adjustment, and text overlay capabilities. These improvements leverage YOLO for object detection and ByteTrack for object tracking.

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

### Task 1: Change Default Highlight Duration to 5 Seconds
**Estimated Effort**: Small
**Files to Modify**:
- [useHighlightRegions.js](src/frontend/src/modes/overlay/hooks/useHighlightRegions.js)

**Testable Outcome**:
- [ ] Add a new highlight region
- [ ] Verify it spans 5 seconds (150 frames at 30fps)
- [ ] Verify exported video shows 5-second highlight

---

### Task 2: Add YOLO Player Detection Endpoint
**Estimated Effort**: Medium
**Files to Create/Modify**:
- Create: `src/backend/app/routers/detection.py`
- Modify: `src/backend/app/main.py` (register router)
- Reference: `src/backend/yolov8x.pt` (existing model)

**API Contract**:
```
POST /detect/players
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
- [ ] Call endpoint with a video frame
- [ ] Receive list of player bounding boxes
- [ ] Confidence scores are present

---

### Task 3: Add ByteTrack Integration
**Estimated Effort**: Medium
**Files to Create/Modify**:
- Create: `src/backend/app/tracking/bytetrack.py`
- Modify: `src/backend/app/routers/detection.py`

**API Contract**:
```
POST /track/player
Request: {
  video_path: string,
  start_frame: int,
  end_frame: int,
  initial_bbox: { x, y, width, height }
}
Response: {
  tracks: [{
    frame: int,
    bbox: { x, y, width, height }
  }]
}
```

**Testable Outcome**:
- [ ] Track a player across 5 seconds of video
- [ ] Receive bounding box for each frame
- [ ] Tracking persists through occlusion

---

### Task 4: Click-to-Detect UI Integration
**Estimated Effort**: Medium
**Files to Modify**:
- [HighlightOverlay.jsx](src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx)
- [OverlayMode.jsx](src/frontend/src/modes/overlay/OverlayMode.jsx)
- [App.jsx](src/frontend/src/App.jsx)

**New Hook**:
- Create: `src/frontend/src/modes/overlay/hooks/usePlayerDetection.js`

**Testable Outcome**:
- [ ] Click on video in overlay mode
- [ ] See loading indicator while YOLO processes
- [ ] Player detection boxes shown temporarily
- [ ] Click on a detected player
- [ ] See highlight ellipse appear at player position

---

### Task 5: Auto-Generate Keyframes from Tracking
**Estimated Effort**: Medium
**Files to Modify**:
- [useHighlightRegions.js](src/frontend/src/modes/overlay/hooks/useHighlightRegions.js)
- [useHighlight.js](src/frontend/src/modes/overlay/hooks/useHighlight.js)

**Testable Outcome**:
- [ ] Click player to track
- [ ] Keyframes appear at 3 per second rate
- [ ] Ellipse follows player during playback
- [ ] Keyframes shown on timeline

---

### Task 6: Duration Change Re-Tracking
**Estimated Effort**: Small
**Files to Modify**:
- [useHighlightRegions.js](src/frontend/src/modes/overlay/hooks/useHighlightRegions.js)

**Testable Outcome**:
- [ ] Change highlight region duration via levers
- [ ] Auto-generated keyframes are cleared and regenerated
- [ ] Manual keyframes are preserved
- [ ] Tracking extends/contracts to new duration

---

### Task 7: Manual Override Preservation
**Estimated Effort**: Small
**Files to Modify**:
- [useHighlight.js](src/frontend/src/modes/overlay/hooks/useHighlight.js)

**Testable Outcome**:
- [ ] Manually drag ellipse to create user keyframe
- [ ] Change region duration
- [ ] User keyframe is preserved
- [ ] Auto keyframes regenerate around user keyframe

---

### Task 8: Ball Detection Endpoint
**Estimated Effort**: Medium
**Files to Modify**:
- [detection.py](src/backend/app/routers/detection.py)

**API Contract**:
```
POST /detect/ball
Request: { video_path: string, start_frame: int, end_frame: int }
Response: {
  ball_positions: [{
    frame: int,
    x: float,
    y: float,
    radius: float,
    confidence: float
  }]
}
```

**Testable Outcome**:
- [ ] Call endpoint with video
- [ ] Receive ball positions for each frame
- [ ] Highest confidence detection is selected per frame

---

### Task 9: Ball Brightening UI
**Estimated Effort**: Medium
**Files to Create/Modify**:
- Create: `src/frontend/src/modes/overlay/components/BallEffectPanel.jsx`
- Create: `src/frontend/src/modes/overlay/hooks/useBallEffect.js`
- Modify: [OverlayMode.jsx](src/frontend/src/modes/overlay/OverlayMode.jsx)

**Testable Outcome**:
- [ ] Ball effect panel visible in overlay mode
- [ ] Click "Detect Ball" runs detection
- [ ] Brightness slider adjusts ball overlay
- [ ] Preview shows brightened ball in real-time

---

### Task 10: Ball Brightening Export
**Estimated Effort**: Medium
**Files to Modify**:
- [export.py](src/backend/app/routers/export.py)

**Testable Outcome**:
- [ ] Export video with ball effect enabled
- [ ] Ball appears brighter in exported video
- [ ] Brightness level matches slider setting

---

### Task 11: Text Overlay Data Model
**Estimated Effort**: Small
**Files to Create**:
- Create: `src/frontend/src/modes/overlay/hooks/useTextOverlays.js`
- Create: `src/frontend/src/modes/overlay/contexts/TextOverlayContext.jsx`

**Testable Outcome**:
- [ ] Text overlay state can be created/read/updated/deleted
- [ ] Text keyframes support position, scale, opacity, rotation

---

### Task 12: Text Overlay UI Components
**Estimated Effort**: Medium
**Files to Create/Modify**:
- Create: `src/frontend/src/modes/overlay/overlays/TextOverlay.jsx`
- Create: `src/frontend/src/modes/overlay/components/TextPropertiesPanel.jsx`
- Modify: [OverlayMode.jsx](src/frontend/src/modes/overlay/OverlayMode.jsx)

**Testable Outcome**:
- [ ] "Add Text" button visible in overlay mode
- [ ] Text appears on video preview
- [ ] Can drag text to reposition
- [ ] Properties panel shows font, size, color options

---

### Task 13: Text Overlay Timeline Integration
**Estimated Effort**: Medium
**Files to Modify**:
- Create: `src/frontend/src/modes/overlay/layers/TextLayer.jsx`
- Modify: `src/frontend/src/modes/overlay/OverlayMode.jsx`

**Testable Outcome**:
- [ ] Text overlays appear as regions on timeline
- [ ] Can adjust text duration via region levers
- [ ] Keyframes shown for text animation

---

### Task 14: Text Overlay Export
**Estimated Effort**: Medium
**Files to Modify**:
- [export.py](src/backend/app/routers/export.py)
- [models.py](src/backend/app/models.py)

**Testable Outcome**:
- [ ] Export video with text overlay
- [ ] Text appears at correct position and timing
- [ ] Font, size, color match preview

---

## Files Summary

### Files to Create

| File | Purpose |
|------|---------|
| `src/backend/app/routers/detection.py` | YOLO detection endpoints |
| `src/backend/app/tracking/bytetrack.py` | ByteTrack integration |
| `src/frontend/src/modes/overlay/hooks/usePlayerDetection.js` | Player click-to-detect |
| `src/frontend/src/modes/overlay/hooks/useBallEffect.js` | Ball detection state |
| `src/frontend/src/modes/overlay/hooks/useTextOverlays.js` | Text overlay state |
| `src/frontend/src/modes/overlay/contexts/TextOverlayContext.jsx` | Text context provider |
| `src/frontend/src/modes/overlay/components/BallEffectPanel.jsx` | Ball brightness UI |
| `src/frontend/src/modes/overlay/components/TextPropertiesPanel.jsx` | Text properties UI |
| `src/frontend/src/modes/overlay/overlays/TextOverlay.jsx` | Text rendering |
| `src/frontend/src/modes/overlay/layers/TextLayer.jsx` | Text timeline layer |

### Files to Modify

| File | Changes |
|------|---------|
| `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` | Default duration, auto-keyframe generation |
| `src/frontend/src/modes/overlay/hooks/useHighlight.js` | Origin field for auto vs user keyframes |
| `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx` | Click handler for detection |
| `src/frontend/src/modes/overlay/OverlayMode.jsx` | Add text/ball UI, integrate new features |
| `src/frontend/src/App.jsx` | Detection state, new hooks integration |
| `src/backend/app/main.py` | Register detection router |
| `src/backend/app/routers/export.py` | Ball brightening, text rendering |
| `src/backend/app/models.py` | New request/response models |

---

## Dependencies

### Python Packages (Backend)

```
ultralytics>=8.0.0      # YOLO
supervision>=0.18.0     # ByteTrack integration
numpy>=1.24.0
opencv-python>=4.8.0
```

### Model Files

| Model | Location | Purpose |
|-------|----------|---------|
| yolov8x.pt | `src/backend/` | Player/ball detection |

---

## Acceptance Criteria

### Click-to-Track Highlighting
- [ ] Can click on video to detect players
- [ ] Can click on detected player to auto-track
- [ ] Keyframes generated at 3 per second
- [ ] Ellipse follows player smoothly during playback
- [ ] Duration change regenerates keyframes
- [ ] Manual keyframes preserved on duration change
- [ ] Export shows tracking correctly

### Ball Brightening
- [ ] Ball detection runs and identifies ball
- [ ] Brightness slider adjusts brightness level
- [ ] Preview shows ball brightening in real-time
- [ ] Export includes ball brightening effect

### Text Overlay
- [ ] Can add text overlay
- [ ] Can edit text content, font, size, color
- [ ] Can position text via drag
- [ ] Can animate text with keyframes
- [ ] Text appears correctly in export

### Default Duration
- [ ] New highlight regions default to 5 seconds
- [ ] Existing projects with 3-second highlights still work

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| YOLO detection slow | Run detection in background, show loading state |
| ByteTrack loses player | Allow manual keyframe correction, re-detect option |
| Ball not detected | Fall back to manual positioning, show confidence warnings |
| Ball false positives | Use ByteTrack to find consistent ball across frames, filter by motion pattern |
| Text rendering differs | Use consistent font rendering (canvas preview matches FFmpeg) |

---

## Notes

- All AI detection runs server-side (Python backend)
- Preview uses canvas overlays, export uses FFmpeg
- Keyframe interpolation uses existing spline system
- Detection results can be cached per video to avoid re-processing

### Ball Detection Improvement (TODO)

**Issue**: YOLO's "sports_ball" class (class_id=32) can produce false positives on logos, watermarks, and circular objects. In testing, it detected the "veo" camera watermark instead of the actual soccer ball.

**Solution**: Use ByteTrack to track ball candidates across multiple frames:
1. Run YOLO ball detection across frame range
2. Use ByteTrack to identify consistent tracks
3. Filter tracks by:
   - Movement pattern (ball should move, not stay static like a logo)
   - Position (ball typically in play area, not corners)
   - Size consistency
4. Select track with highest average confidence that passes filters
5. Return tracked ball position per frame
