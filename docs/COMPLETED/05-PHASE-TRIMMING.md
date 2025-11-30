# Phase 5: Timeline Editing

**Core Concept**: Professional trim and multi-clip editing  
**Risk Level**: LOW - Standard editing features  
**Dependencies**: Phase 1, 2, 3, 4

---

## Objective

Add professional timeline editing capabilities: trim video clips, split clips with scissors tool, arrange multiple clips sequentially, and manage clip relationships. This completes the feature set before deployment.

---

## Features

### Trim Handles
- Start and end trim handles on video clip
- Visual: Draggable triangular markers at clip edges
- Interaction: Drag to set trim points
- Non-destructive: Can undo trim
- Visual feedback: Trimmed area dimmed/grayed out

### Scissors Tool
- Click scissors in toolbar
- Click on timeline to split clip at that point
- Creates two separate clips
- Each clip retains its own:
  - Crop keyframes (within its time range)
  - Speed regions (within its time range)
  - Trim settings

### Multi-Clip Support
- Single video track (no multi-track needed)
- Multiple clips arranged sequentially
- No overlapping clips
- Gaps allowed between clips
- Clips snap together when moved
- Auto-arrange after deletion

### Clip Selection & Management
- Click clip to select
- Selected clip highlighted
- Delete selected clip (Delete key)
- Move clips by dragging
- Clips auto-snap to adjacent clips (no gaps by default)
- Allow gaps option (hold Shift)

### Timeline Zoom
- Zoom in/out controls
- Mouse wheel zoom (with Ctrl/Cmd)
- Fit all clips in view
- Zoom to selection
- Smooth zoom animation

### Snap-to-Grid
- Optional grid overlay on timeline
- Configurable grid intervals (1s, 5s, 10s, etc.)
- Clips snap to grid lines when moving
- Toggle snap on/off

---

## User Interface

```
┌─────────────────────────────────────────────────────────────┐
│  Video Editor                                       [File]  │
├─────────────────────────────────────────────────────────────┤
│  Tools: [▶] [⏸] [✂] [Trim] [Zoom: 100%] [Snap: ☑]         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    Video Preview                            │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Video Track                                                │
│  ┌─▼─────────────────▼─┐  ┌─▼──────────▼─┐  ┌─▼────────▼─┐│
│  │ Trim    CLIP 1     │  │   CLIP 2     │  │   CLIP 3   ││
│  │ Start              │  │              │  │            ││
│  └────────────────────┘  └──────────────┘  └────────────┘│
│     ↑                         ↑                  ↑         │
│  Trim Handle            Split Point         Trim Handle    │
│                                                             │
│  Crop Track                                                 │
│  ──●────────●──────────   ──●───────        ──●──          │
│    (for Clip 1)            (for Clip 2)      (Clip 3)      │
│                                                             │
│  Speed Track                                                │
│  [0.5x]░░░░[2.0x]░░░░░   [1.0x]░░░░░        [1.5x]░░      │
│                                                             │
│  ────────────────█──────────────────────────────────────   │
│  0:00            ↑                                  15:00   │
│               Playhead                                      │
│                                                             │
│  Clip 2 selected (outlined in white)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### Component Structure

```
src/
├── components/
│   ├── VideoTrack.jsx           # Enhanced: Multi-clip support
│   ├── VideoClip.jsx            # NEW: Individual clip component
│   ├── TrimHandle.jsx           # NEW: Trim handle
│   ├── ScissorsTool.jsx         # NEW: Split tool
│   ├── TimelineControls.jsx    # NEW: Zoom, snap controls
│   └── ClipPropertiesPanel.jsx # NEW: Per-clip properties
├── hooks/
│   ├── useClips.js              # NEW: Clip management
│   ├── useTrim.js               # NEW: Trim operations
│   ├── useTimelineZoom.js       # NEW: Zoom controls
│   └── useSnapping.js           # NEW: Snap-to-grid logic
├── utils/
│   ├── clipUtils.js             # NEW: Clip operations
│   ├── trimUtils.js             # NEW: Trim calculations
│   └── snapUtils.js             # NEW: Snapping logic
└── types/
    └── clip.ts                  # NEW: Clip type definitions
```

### Extended State Management

```javascript
const AppState = {
  // ... existing state from previous phases
  
  // Multi-clip timeline
  clips: {
    clips: Clip[],               // Array of clips
    selectedClipId: string | null,
    nextClipId: number           // For generating unique IDs
  },
  
  // Timeline view
  timeline: {
    zoomLevel: number,           // 1.0 = normal, 2.0 = 2x zoom
    scrollPosition: number,      // Horizontal scroll offset
    snapToGrid: boolean,
    gridInterval: number,        // Seconds between grid lines
    showGrid: boolean
  }
}
```

---

## Data Models

### Clip
```typescript
interface Clip {
  id: string;
  videoFile: File;              // Source video file
  
  // Position on timeline
  startTime: number;            // Start position on timeline (seconds)
  
  // Trim points (in source video)
  trimStart: number;            // Trim start in source video
  trimEnd: number;              // Trim end in source video
  
  // Duration
  sourceDuration: number;       // Original video duration
  trimmedDuration: number;      // Duration after trim
  effectiveDuration: number;    // Duration after speed effects
  
  // Effects (stored per clip)
  cropKeyframes: Keyframe[];    // Crop keyframes for this clip
  speedRegions: SpeedRegion[];  // Speed regions for this clip
  
  // Metadata
  name: string;
  thumbnail: string | null;
}
```

### TrimState
```typescript
interface TrimState {
  clipId: string;
  dragging: 'start' | 'end' | null;
  originalTrimStart: number;
  originalTrimEnd: number;
}
```

---

## Core Algorithms

### 1. Clip Splitting

```javascript
/**
 * Split clip at specific time
 * @param clip - Clip to split
 * @param splitTime - Time in clip's timeline (not source video)
 * @returns Two new clips
 */
function splitClip(clip, splitTime) {
  // Calculate split position in source video time
  const sourceTime = clip.trimStart + splitTime;
  
  // Create first clip (before split)
  const clip1 = {
    ...clip,
    id: generateUniqueId(),
    trimEnd: sourceTime,
    trimmedDuration: splitTime,
    
    // Filter crop keyframes to only those before split
    cropKeyframes: clip.cropKeyframes.filter(kf => kf.time < splitTime),
    
    // Filter speed regions to only those before split
    speedRegions: clip.speedRegions
      .filter(sr => sr.startTime < splitTime)
      .map(sr => ({
        ...sr,
        endTime: Math.min(sr.endTime, splitTime)
      }))
  };
  
  // Create second clip (after split)
  const clip2 = {
    ...clip,
    id: generateUniqueId(),
    startTime: clip.startTime + splitTime,
    trimStart: sourceTime,
    trimmedDuration: clip.trimmedDuration - splitTime,
    
    // Adjust crop keyframe times (shift by splitTime)
    cropKeyframes: clip.cropKeyframes
      .filter(kf => kf.time >= splitTime)
      .map(kf => ({
        ...kf,
        time: kf.time - splitTime
      })),
    
    // Adjust speed region times
    speedRegions: clip.speedRegions
      .filter(sr => sr.endTime > splitTime)
      .map(sr => ({
        ...sr,
        startTime: Math.max(0, sr.startTime - splitTime),
        endTime: sr.endTime - splitTime
      }))
  };
  
  return [clip1, clip2];
}
```

### 2. Clip Arrangement

```javascript
/**
 * Arrange clips sequentially with no gaps
 * @param clips - Array of clips
 * @returns Clips with updated startTime values
 */
function arrangeClipsSequentially(clips) {
  let currentTime = 0;
  
  return clips
    .sort((a, b) => a.startTime - b.startTime)
    .map(clip => {
      const newClip = {
        ...clip,
        startTime: currentTime
      };
      currentTime += clip.effectiveDuration;
      return newClip;
    });
}
```

### 3. Snap to Grid

```javascript
/**
 * Snap time to nearest grid line
 * @param time - Time to snap
 * @param gridInterval - Grid interval in seconds
 * @param snapThreshold - Max distance to snap (in seconds)
 * @returns Snapped time
 */
function snapToGrid(time, gridInterval, snapThreshold = 0.5) {
  const nearestGridPoint = Math.round(time / gridInterval) * gridInterval;
  const distance = Math.abs(time - nearestGridPoint);
  
  if (distance <= snapThreshold) {
    return nearestGridPoint;
  }
  
  return time;
}

/**
 * Snap clip to adjacent clips
 * @param clip - Clip being moved
 * @param allClips - All other clips
 * @param snapThreshold - Max distance to snap (in seconds)
 * @returns Snapped startTime
 */
function snapToAdjacentClips(clip, allClips, snapThreshold = 0.2) {
  let snappedTime = clip.startTime;
  
  for (const otherClip of allClips) {
    if (otherClip.id === clip.id) continue;
    
    const otherClipEnd = otherClip.startTime + otherClip.effectiveDuration;
    
    // Snap to start of other clip
    if (Math.abs(clip.startTime - otherClip.startTime) < snapThreshold) {
      snappedTime = otherClip.startTime;
      break;
    }
    
    // Snap to end of other clip
    if (Math.abs(clip.startTime - otherClipEnd) < snapThreshold) {
      snappedTime = otherClipEnd;
      break;
    }
  }
  
  return snappedTime;
}
```

### 4. Timeline Zoom

```javascript
/**
 * Calculate pixel width for timeline at zoom level
 * @param totalDuration - Total timeline duration
 * @param zoomLevel - Zoom multiplier (1.0 = normal)
 * @param basePixelsPerSecond - Base pixels per second at 1.0 zoom
 * @returns Timeline width in pixels
 */
function calculateTimelineWidth(totalDuration, zoomLevel, basePixelsPerSecond = 100) {
  return totalDuration * basePixelsPerSecond * zoomLevel;
}

/**
 * Zoom timeline while keeping playhead centered
 * @param currentZoom - Current zoom level
 * @param targetZoom - Target zoom level
 * @param playheadPosition - Current playhead position in pixels
 * @param scrollPosition - Current scroll offset
 * @returns New scroll position to keep playhead centered
 */
function zoomAroundPlayhead(currentZoom, targetZoom, playheadPosition, scrollPosition) {
  const zoomRatio = targetZoom / currentZoom;
  const playheadOffset = playheadPosition - scrollPosition;
  const newPlayheadOffset = playheadOffset * zoomRatio;
  return playheadPosition - newPlayheadOffset;
}
```

### 5. Trim Calculations

```javascript
/**
 * Calculate clip duration after trim
 * @param trimStart - Trim start time in source
 * @param trimEnd - Trim end time in source
 * @returns Trimmed duration
 */
function calculateTrimmedDuration(trimStart, trimEnd) {
  return trimEnd - trimStart;
}

/**
 * Adjust trim handle position
 * @param clip - Clip being trimmed
 * @param handle - Which handle ('start' or 'end')
 * @param newTime - New time in source video
 * @returns Updated trim values
 */
function adjustTrimHandle(clip, handle, newTime) {
  if (handle === 'start') {
    // Ensure start is before end
    const trimStart = Math.min(newTime, clip.trimEnd - 0.1); // Minimum 0.1s duration
    return { trimStart, trimEnd: clip.trimEnd };
  } else {
    // Ensure end is after start
    const trimEnd = Math.max(newTime, clip.trimStart + 0.1);
    return { trimStart: clip.trimStart, trimEnd };
  }
}
```

---

## API Contracts

### Clip Operations
```typescript
/**
 * Add clip to timeline
 */
function addClip(videoFile: File, startTime: number): Clip

/**
 * Remove clip from timeline
 */
function removeClip(clipId: string): void

/**
 * Split clip at time
 */
function splitClipAtTime(clipId: string, time: number): [Clip, Clip]

/**
 * Move clip to new position
 */
function moveClip(clipId: string, newStartTime: number): void

/**
 * Select clip
 */
function selectClip(clipId: string): void

/**
 * Get all clips sorted by position
 */
function getClipsSorted(): Clip[]
```

### Trim Operations
```typescript
/**
 * Start trimming clip
 */
function startTrim(clipId: string, handle: 'start' | 'end'): void

/**
 * Update trim position
 */
function updateTrim(clipId: string, newTime: number): void

/**
 * Finish trim operation
 */
function endTrim(): void

/**
 * Reset trim to full clip
 */
function resetTrim(clipId: string): void
```

### Timeline Controls
```typescript
/**
 * Set zoom level
 */
function setZoom(level: number): void

/**
 * Zoom in/out
 */
function zoomIn(): void
function zoomOut(): void

/**
 * Fit all clips in view
 */
function fitAllClips(): void

/**
 * Toggle snap to grid
 */
function toggleSnapToGrid(): void

/**
 * Set grid interval
 */
function setGridInterval(seconds: number): void
```

---

## Implementation Requirements

### Clip Rendering
- Each clip renders as rectangle on timeline
- Selected clip has highlight border
- Trimmed regions shown dimmed/grayed
- Clip name/duration displayed
- Smooth drag and drop

### Trim Handles
- Triangular handles at clip edges
- Drag to adjust trim points
- Visual feedback during drag
- Constrain to clip boundaries
- Update clip duration in real-time

### Scissors Tool
- Click to activate
- Cursor changes to scissors
- Click on clip to split
- Creates two new clips
- Deactivate after split

### Timeline Zoom
- Smooth zoom animation
- Zoom in: Ctrl/Cmd + Scroll Up or + button
- Zoom out: Ctrl/Cmd + Scroll Down or - button
- Fit to view button
- Preserve playhead position during zoom

### Grid Rendering
```javascript
// Draw grid lines on timeline canvas
function drawGrid(ctx, timelineWidth, duration, gridInterval, zoomLevel) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  
  const pixelsPerSecond = timelineWidth / duration;
  const gridPixels = gridInterval * pixelsPerSecond;
  
  for (let x = 0; x < timelineWidth; x += gridPixels) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ctx.canvas.height);
    ctx.stroke();
  }
}
```

---

## Testing Requirements

### Functional Tests
- [ ] Add multiple clips to timeline
- [ ] Select clip
- [ ] Delete clip
- [ ] Move clip by dragging
- [ ] Trim clip with start handle
- [ ] Trim clip with end handle
- [ ] Split clip with scissors
- [ ] Split preserves crop keyframes
- [ ] Split preserves speed regions
- [ ] Clips snap to grid
- [ ] Clips snap to adjacent clips
- [ ] Zoom in/out
- [ ] Fit all clips
- [ ] Toggle grid visibility
- [ ] Sequential arrangement works

### Integration Tests
- [ ] Play across multiple clips
- [ ] Export with multiple clips
- [ ] Crop effects work on individual clips
- [ ] Speed effects work on individual clips
- [ ] Trim + crop + speed work together

### Performance Tests
- [ ] 20+ clips perform smoothly
- [ ] Zoom is smooth (60fps)
- [ ] Clip dragging is responsive
- [ ] Split operation is instant

### Edge Cases
- [ ] Trim to minimum duration (0.1s)
- [ ] Split at clip start
- [ ] Split at clip end
- [ ] Move clip to timeline start (time = 0)
- [ ] Delete all clips
- [ ] Very long timeline (1 hour+)
- [ ] Maximum zoom in/out

---

## Acceptance Criteria

### Must Have
✅ User can trim clips  
✅ User can split clips  
✅ User can arrange multiple clips  
✅ Scissors tool works correctly  
✅ Clips can be moved and deleted  
✅ Timeline zoom works  
✅ All effects work per-clip  

### Should Have
✅ Snap to grid works  
✅ Snap to adjacent clips works  
✅ Fit all clips works  
✅ Selected clip is clearly highlighted  

### Nice to Have
- Ripple delete (close gaps automatically)
- Copy/paste clips
- Duplicate clip
- Clip color coding

---

## Development Guidelines for AI

### Implementation Order
1. Add Clip data model
2. Support multiple clips in state
3. Render clips on timeline
4. Add clip selection
5. Implement clip movement
6. Add trim handles
7. Implement trim logic
8. Add scissors tool
9. Implement split logic
10. Add zoom controls
11. Implement snap logic
12. Test thoroughly

### Critical Code Sections

**Multi-Clip Rendering**:
```jsx
function VideoTrack({ clips, selectedClipId, onClipSelect }) {
  return (
    <div className="video-track">
      {clips.map(clip => {
        const left = timeToPixel(clip.startTime);
        const width = timeToPixel(clip.effectiveDuration);
        
        return (
          <VideoClip
            key={clip.id}
            clip={clip}
            left={left}
            width={width}
            selected={clip.id === selectedClipId}
            onSelect={() => onClipSelect(clip.id)}
          />
        );
      })}
    </div>
  );
}
```

**Clip Dragging**:
```javascript
function handleClipDrag(clipId, deltaX) {
  const clip = clips.find(c => c.id === clipId);
  const deltaTime = pixelToTime(deltaX);
  let newStartTime = clip.startTime + deltaTime;
  
  // Apply snapping
  if (snapToGrid) {
    newStartTime = snapToGrid(newStartTime, gridInterval);
  }
  
  newStartTime = snapToAdjacentClips(
    {...clip, startTime: newStartTime},
    clips.filter(c => c.id !== clipId)
  );
  
  // Constrain to timeline (>= 0)
  newStartTime = Math.max(0, newStartTime);
  
  updateClipPosition(clipId, newStartTime);
}
```

---

## Phase Completion Checklist

- [ ] Clip system implemented
- [ ] Trim functionality working
- [ ] Scissors tool working
- [ ] Multi-clip support complete
- [ ] Zoom controls functional
- [ ] Snap behavior working
- [ ] All tests passing
- [ ] Ready for Phase 6 (Build Pipeline)

---

## Next Phase Preview

Phase 6 will begin deployment phases:
- Build pipeline setup
- CI/CD configuration
- Production optimizations
- Automated builds

---

## Notes for Claude Code

Critical considerations:
1. Clip IDs must be unique (use UUID or timestamp)
2. Effect data (crop, speed) must be properly scoped to clips
3. Splitting requires careful handling of keyframe times
4. Zoom can cause performance issues - optimize rendering
5. Snap logic needs careful tuning (threshold values)
6. Timeline width calculation affects all positioning
7. Test multi-clip export thoroughly
8. Memory management: unload unused video elements
