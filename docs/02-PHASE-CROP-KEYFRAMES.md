# Phase 2: Crop Keyframes

**Core Concept**: Keyframe-based animated cropping system  
**Risk Level**: HIGH - Novel feature, complex interpolation  
**Dependencies**: Phase 1 (Foundation)

---

## Objective

Implement the most technically challenging feature first: animated crops using keyframes. Users can set different crop rectangles at different points in the video timeline, with smooth interpolation between keyframes.

**Why Front-loaded**: This is the unique selling point and biggest technical risk. Testing it early validates the core value proposition and exposes integration challenges.

---

## Key Innovation

Different crop sizes and positions at different frames:
- Frame 0: 1920x1080 crop, centered
- Frame 30: 1080x1920 crop (portrait), top-left
- Frame 60: 720x720 crop (square), bottom-right

Smooth interpolation handles transitions between different aspect ratios, positions, and sizes.

---

## Features

### Crop Overlay (on Video Display)
- Semi-transparent overlay with dashed border
- 8 resize handles (corners + midpoints)
- Drag handles to resize crop rectangle
- Drag crop interior to reposition
- Visual feedback during interaction
- Handles snap to common positions (thirds, center)
- Lock aspect ratio option

### Crop Keyframe Track (on Timeline)
- New track below video timeline
- Shows keyframe dots at specific times
- Click track to create keyframe at playhead position
- Drag keyframes horizontally to change time
- Delete keyframes (right-click or delete key)
- Interpolation curve visualization between keyframes
- Active keyframe highlight

### Keyframe Management
- Create keyframe at current playhead position
- Each keyframe stores: x, y, width, height
- Copy keyframe (duplicate settings)
- Paste keyframe to new position
- Delete individual keyframes
- Keyframe list view in properties panel

### Properties Panel
- Numeric inputs for crop dimensions
  - X position (0 to video width)
  - Y position (0 to video height)
  - Width (1 to video width)
  - Height (1 to video height)
- Aspect ratio controls
  - Lock aspect ratio toggle
  - Common presets (16:9, 9:16, 1:1, 4:3)
- Interpolation type selector
  - Linear (constant speed)
  - Ease In/Out (smooth acceleration)
  - Bezier (custom curve)
- Preset position buttons (9-point grid)
  - Top-left, Top-center, Top-right
  - Middle-left, Center, Middle-right
  - Bottom-left, Bottom-center, Bottom-right

### Real-time Preview
- Crop effect shows during playback
- Smooth interpolation as video plays
- Black bars outside crop region
- Crop boundary updates at 60fps

---

## User Interface

```
┌─────────────────────────────────────────────────┬──────────┐
│  Video Editor                           [File]  │          │
├─────────────────────────────────────────────────┤   CROP   │
│                                                 │  PANEL   │
│              Video with Crop Overlay            │          │
│     ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐            │  X: 240  │
│      ◉                         ◉               │  Y: 135  │
│     │                           │              │  W: 1440 │
│      ◉       VIDEO CONTENT     ◉               │  H: 810  │
│     │                           │              │          │
│      ◉                         ◉               │  □ Lock  │
│     └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘            │  Aspect  │
│                                                 │          │
│                                                 │  [16:9]  │
│                                                 │  [9:16]  │
│                                                 │  [1:1 ]  │
├─────────────────────────────────────────────────┤          │
│                                                 │  ┌─┬─┬─┐ │
│  ────────────────────█──────────────────────   │  │░│░│░│ │
│  0:00                ↑                   5:00   │  ├─┼─┼─┤ │
│                   Playhead                      │  │░│◉│░│ │
│                                                 │  ├─┼─┼─┤ │
│  ──●─────────────●──────────●──────────────    │  │░│░│░│ │
│    ↑             ↑          ↑                   │  └─┴─┴─┘ │
│  Keyframe     Keyframe   Keyframe              │ Position  │
│   (3 keyframes on crop track)                  │  Grid     │
│                                                 │          │
│  [▶] [⏮] [⏭]    00:02:30 / 00:05:00           │ Interpolate│
│                                                 │  ○ Linear │
│                                                 │  ◉ Ease   │
│                                                 │  ○ Bezier │
└─────────────────────────────────────────────────┴──────────┘
```

---

## Technical Architecture

### Component Structure

```
src/
├── components/
│   ├── VideoPlayer.jsx         # From Phase 1
│   ├── CropOverlay.jsx         # NEW: Crop rectangle with handles
│   ├── CropHandle.jsx          # NEW: Individual resize handle
│   ├── Timeline.jsx            # Extended from Phase 1
│   ├── CropTrack.jsx           # NEW: Keyframe track
│   ├── Keyframe.jsx            # NEW: Individual keyframe dot
│   ├── PropertiesPanel.jsx     # NEW: Crop controls
│   └── PositionGrid.jsx        # NEW: 9-point position selector
├── hooks/
│   ├── useCrop.js              # NEW: Crop state management
│   ├── useKeyframes.js         # NEW: Keyframe operations
│   └── useInterpolation.js     # NEW: Crop interpolation
├── utils/
│   ├── cropCalculations.js     # NEW: Crop math
│   ├── interpolation.js        # NEW: Interpolation algorithms
│   └── keyframeUtils.js        # NEW: Keyframe utilities
└── types/
    └── crop.ts                 # NEW: Crop type definitions
```

### Extended State Management

```javascript
// Add to Phase 1 AppState
const AppState = {
  // ... existing video and playback state from Phase 1
  
  // Crop system
  crop: {
    enabled: boolean,              // Crop system on/off
    keyframes: Keyframe[],         // Array of keyframes
    activeKeyframeId: string | null,
    currentCrop: CropRect,         // Current crop at playhead
    interpolationType: 'linear' | 'ease' | 'bezier',
    lockAspectRatio: boolean,
    aspectRatio: number | null
  },
  
  // UI for crop
  ui: {
    // ... existing UI state
    cropInteraction: {
      dragging: boolean,
      dragType: 'move' | 'resize' | null,
      dragHandle: 'tl' | 'tr' | 'bl' | 'br' | 'l' | 'r' | 't' | 'b' | null,
      startPos: {x: number, y: number} | null,
      startCrop: CropRect | null
    }
  }
}
```

---

## Data Models

### CropRect
```typescript
interface CropRect {
  x: number;        // X position in video coordinates (0 to videoWidth)
  y: number;        // Y position in video coordinates (0 to videoHeight)
  width: number;    // Crop width (1 to videoWidth - x)
  height: number;   // Crop height (1 to videoHeight - y)
}
```

### Keyframe
```typescript
interface Keyframe {
  id: string;              // Unique identifier
  time: number;            // Time in seconds
  crop: CropRect;          // Crop rectangle at this keyframe
  interpolation?: {        // Optional custom interpolation
    type: 'linear' | 'ease' | 'bezier';
    easeParams?: {
      x1: number, y1: number,
      x2: number, y2: number
    };
  };
}
```

### Handle Position
```typescript
type HandleType = 
  | 'tl'  // Top-left
  | 'tr'  // Top-right
  | 'bl'  // Bottom-left
  | 'br'  // Bottom-right
  | 't'   // Top-middle
  | 'b'   // Bottom-middle
  | 'l'   // Left-middle
  | 'r';  // Right-middle
```

---

## Core Algorithms

### 1. Keyframe Interpolation

**Purpose**: Calculate crop rectangle at any time between keyframes

```javascript
/**
 * Get crop at specific time with interpolation
 * @param keyframes - Sorted array of keyframes
 * @param time - Target time in seconds
 * @param interpolationType - Type of interpolation
 * @returns Interpolated crop rectangle
 */
function getCropAtTime(keyframes, time, interpolationType) {
  // If no keyframes, return null (no crop)
  if (keyframes.length === 0) return null;
  
  // If only one keyframe, use it for all times
  if (keyframes.length === 1) return keyframes[0].crop;
  
  // Find surrounding keyframes
  const before = findKeyframeBefore(keyframes, time);
  const after = findKeyframeAfter(keyframes, time);
  
  // If before start, use first keyframe
  if (!before) return keyframes[0].crop;
  
  // If after end, use last keyframe
  if (!after) return keyframes[keyframes.length - 1].crop;
  
  // Calculate interpolation progress (0 to 1)
  const duration = after.time - before.time;
  const elapsed = time - before.time;
  let progress = elapsed / duration;
  
  // Apply easing function
  progress = applyEasing(progress, interpolationType);
  
  // Interpolate each crop property
  return {
    x: lerp(before.crop.x, after.crop.x, progress),
    y: lerp(before.crop.y, after.crop.y, progress),
    width: lerp(before.crop.width, after.crop.width, progress),
    height: lerp(before.crop.height, after.crop.height, progress)
  };
}

/**
 * Linear interpolation
 */
function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

/**
 * Apply easing function to progress
 */
function applyEasing(t, type) {
  switch(type) {
    case 'linear':
      return t;
    
    case 'ease':
      // Ease in-out (smooth start and end)
      return t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;
    
    case 'bezier':
      // Cubic bezier (can be customized)
      return cubicBezier(t, 0.25, 0.1, 0.25, 1.0);
    
    default:
      return t;
  }
}
```

### 2. Handle Resize Logic

**Purpose**: Update crop rectangle when user drags resize handle

```javascript
/**
 * Calculate new crop rect when handle is dragged
 * @param currentCrop - Current crop rectangle
 * @param handleType - Which handle is being dragged
 * @param deltaX - Pixels moved in X
 * @param deltaY - Pixels moved in Y
 * @param lockAspectRatio - Maintain aspect ratio
 * @param videoWidth - Video width for bounds
 * @param videoHeight - Video height for bounds
 * @returns New crop rectangle
 */
function resizeCrop(
  currentCrop,
  handleType,
  deltaX,
  deltaY,
  lockAspectRatio,
  videoWidth,
  videoHeight
) {
  let newCrop = {...currentCrop};
  const aspectRatio = currentCrop.width / currentCrop.height;
  
  switch(handleType) {
    case 'tl': // Top-left: move top and left edges
      newCrop.x += deltaX;
      newCrop.y += deltaY;
      newCrop.width -= deltaX;
      newCrop.height -= deltaY;
      break;
      
    case 'tr': // Top-right: move top and right edges
      newCrop.y += deltaY;
      newCrop.width += deltaX;
      newCrop.height -= deltaY;
      break;
      
    case 'bl': // Bottom-left: move bottom and left edges
      newCrop.x += deltaX;
      newCrop.width -= deltaX;
      newCrop.height += deltaY;
      break;
      
    case 'br': // Bottom-right: move both edges
      newCrop.width += deltaX;
      newCrop.height += deltaY;
      break;
      
    case 't': // Top edge only
      newCrop.y += deltaY;
      newCrop.height -= deltaY;
      break;
      
    case 'b': // Bottom edge only
      newCrop.height += deltaY;
      break;
      
    case 'l': // Left edge only
      newCrop.x += deltaX;
      newCrop.width -= deltaX;
      break;
      
    case 'r': // Right edge only
      newCrop.width += deltaX;
      break;
  }
  
  // Lock aspect ratio if enabled
  if (lockAspectRatio) {
    // Adjust height to maintain aspect ratio
    newCrop.height = newCrop.width / aspectRatio;
  }
  
  // Enforce minimum size (50px)
  newCrop.width = Math.max(50, newCrop.width);
  newCrop.height = Math.max(50, newCrop.height);
  
  // Enforce bounds (stay within video)
  newCrop.x = Math.max(0, Math.min(videoWidth - newCrop.width, newCrop.x));
  newCrop.y = Math.max(0, Math.min(videoHeight - newCrop.height, newCrop.y));
  newCrop.width = Math.min(videoWidth - newCrop.x, newCrop.width);
  newCrop.height = Math.min(videoHeight - newCrop.y, newCrop.height);
  
  return newCrop;
}
```

### 3. Keyframe Operations

```javascript
/**
 * Create keyframe at current playhead position
 */
function createKeyframe(currentTime, currentCrop) {
  return {
    id: generateUUID(),
    time: currentTime,
    crop: {...currentCrop}
  };
}

/**
 * Update keyframe crop values
 */
function updateKeyframe(keyframes, keyframeId, newCrop) {
  return keyframes.map(kf => 
    kf.id === keyframeId 
      ? {...kf, crop: newCrop}
      : kf
  );
}

/**
 * Delete keyframe
 */
function deleteKeyframe(keyframes, keyframeId) {
  return keyframes.filter(kf => kf.id !== keyframeId);
}

/**
 * Move keyframe to new time
 */
function moveKeyframe(keyframes, keyframeId, newTime) {
  return keyframes.map(kf =>
    kf.id === keyframeId
      ? {...kf, time: newTime}
      : kf
  ).sort((a, b) => a.time - b.time);
}

/**
 * Find keyframe at time (with tolerance)
 */
function findKeyframeAtTime(keyframes, time, tolerance = 0.1) {
  return keyframes.find(kf => 
    Math.abs(kf.time - time) < tolerance
  );
}
```

### 4. Preset Positions

```javascript
/**
 * Calculate crop position for preset grid location
 * @param position - Grid position (0-8, row-major order)
 * @param cropWidth - Desired crop width
 * @param cropHeight - Desired crop height
 * @param videoWidth - Video width
 * @param videoHeight - Video height
 */
function getPresetPosition(position, cropWidth, cropHeight, videoWidth, videoHeight) {
  // Position grid:
  // 0 1 2
  // 3 4 5
  // 6 7 8
  
  const row = Math.floor(position / 3);
  const col = position % 3;
  
  // Calculate X based on column (0 = left, 1 = center, 2 = right)
  const x = col === 0 
    ? 0 
    : col === 1 
      ? (videoWidth - cropWidth) / 2
      : videoWidth - cropWidth;
  
  // Calculate Y based on row (0 = top, 1 = middle, 2 = bottom)
  const y = row === 0
    ? 0
    : row === 1
      ? (videoHeight - cropHeight) / 2
      : videoHeight - cropHeight;
  
  return { x, y, width: cropWidth, height: cropHeight };
}
```

---

## API Contracts

### Crop Operations
```typescript
/**
 * Enable crop system
 */
function enableCrop(): void

/**
 * Disable crop system
 */
function disableCrop(): void

/**
 * Set crop rectangle at current time
 * If keyframe exists at current time, update it
 * Otherwise, create new keyframe
 */
function setCropAtCurrentTime(crop: CropRect): void

/**
 * Get interpolated crop at any time
 */
function getCropAtTime(time: number): CropRect | null

/**
 * Toggle aspect ratio lock
 */
function toggleAspectRatioLock(): void

/**
 * Set specific aspect ratio
 */
function setAspectRatio(ratio: number): void

/**
 * Apply preset aspect ratio
 */
function applyPresetAspectRatio(preset: '16:9' | '9:16' | '1:1' | '4:3'): void
```

### Keyframe Operations
```typescript
/**
 * Create keyframe at playhead
 */
function createKeyframeAtPlayhead(): Keyframe

/**
 * Update existing keyframe
 */
function updateKeyframe(id: string, crop: CropRect): void

/**
 * Delete keyframe
 */
function deleteKeyframe(id: string): void

/**
 * Move keyframe to new time
 */
function moveKeyframe(id: string, newTime: number): void

/**
 * Select keyframe for editing
 */
function selectKeyframe(id: string): void

/**
 * Get all keyframes sorted by time
 */
function getKeyframes(): Keyframe[]
```

---

## Implementation Requirements

### Crop Overlay
- Render as SVG or Canvas overlay on video
- 8 handles positioned at corners and edges
- Handles are 20px × 20px, clearly visible
- Dashed border: 2px wide, white with 50% opacity
- Semi-transparent mask outside crop (black, 30% opacity)
- Update overlay at 60fps during playback
- Smooth handle dragging (no lag)

### Keyframe Track
- Height: 60px
- Background: Dark gray (#2d2d2d)
- Keyframe dots: 16px diameter circles
- Active keyframe: 20px diameter, highlighted color
- Click empty space to create keyframe
- Click keyframe to select
- Drag keyframe horizontally to move time
- Right-click for context menu (delete, copy)

### Interpolation Rendering
- Draw interpolation curve between keyframes
- Use bezier curve visualization
- Update curve in real-time when keyframes move
- Show control points for custom bezier

### Properties Panel
- Right sidebar, 320px wide
- Numeric inputs with live validation
- Slider controls for visual adjustment
- Preset buttons (16:9, 9:16, 1:1, 4:3)
- 9-point position grid (3×3 buttons)
- Updates in real-time as handles dragged

---

## Testing Requirements

### Functional Tests
- [ ] Create keyframe at playhead position
- [ ] Drag handles to resize crop
- [ ] Move crop by dragging interior
- [ ] Lock/unlock aspect ratio
- [ ] Apply preset aspect ratios
- [ ] Apply preset positions
- [ ] Interpolation between 2 keyframes works
- [ ] Interpolation with 3+ keyframes works
- [ ] Delete keyframe
- [ ] Move keyframe to new time
- [ ] Different interpolation types (linear, ease, bezier)
- [ ] Crop shows correctly during playback

### Performance Tests
- [ ] 10+ keyframes perform smoothly
- [ ] 100+ keyframes don't cause lag
- [ ] Real-time preview at 60fps
- [ ] Handle dragging is responsive
- [ ] Interpolation calculation is fast (< 1ms)

### Edge Cases
- [ ] Crop at video edges (x=0, y=0)
- [ ] Very small crops (50×50px minimum)
- [ ] Very large crops (full video size)
- [ ] Keyframes at exact same time (replace)
- [ ] Keyframe at start (time = 0)
- [ ] Keyframe at end (time = duration)
- [ ] Transitioning between different aspect ratios (16:9 to 9:16)
- [ ] Rapid keyframe creation/deletion

---

## Acceptance Criteria

### Must Have
✅ User can create keyframes by clicking track  
✅ User can resize crop with 8 handles  
✅ User can move crop by dragging  
✅ Different crop sizes at different frames work  
✅ Interpolation between keyframes is smooth  
✅ Crop displays correctly during playback  
✅ Handles are responsive and intuitive  
✅ Properties panel updates in real-time  

### Should Have
✅ Aspect ratio lock works correctly  
✅ Preset positions work  
✅ Preset aspect ratios work  
✅ Keyframes can be moved and deleted  
✅ Interpolation type selection works  

### Nice to Have
- Keyframe snapping to significant points
- Copy/paste keyframes
- Keyframe easing visualization
- Undo/redo for crop changes

---

## Development Guidelines for AI

### Implementation Order
1. Add crop state management (useCrop hook)
2. Create CropOverlay component (static crop first)
3. Add resize handles (one handle at a time)
4. Implement handle drag logic
5. Add keyframe data structure
6. Implement keyframe creation
7. Add interpolation algorithm
8. Connect interpolation to playback
9. Add properties panel
10. Add preset controls
11. Test thoroughly

### Critical Code Sections

**Crop Overlay Rendering**:
```jsx
function CropOverlay({ crop, videoWidth, videoHeight, onCropChange }) {
  // Convert video coordinates to display coordinates
  const displayScale = getDisplayScale(videoWidth, videoHeight);
  
  return (
    <svg className="crop-overlay">
      {/* Mask outside crop */}
      <defs>
        <mask id="cropMask">
          <rect width="100%" height="100%" fill="white" />
          <rect 
            x={crop.x * displayScale} 
            y={crop.y * displayScale}
            width={crop.width * displayScale}
            height={crop.height * displayScale}
            fill="black"
          />
        </mask>
      </defs>
      
      <rect 
        width="100%" 
        height="100%" 
        fill="black" 
        opacity="0.3"
        mask="url(#cropMask)"
      />
      
      {/* Crop border */}
      <rect
        x={crop.x * displayScale}
        y={crop.y * displayScale}
        width={crop.width * displayScale}
        height={crop.height * displayScale}
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeDasharray="5,5"
      />
      
      {/* Resize handles */}
      {renderHandles(crop, displayScale, onCropChange)}
    </svg>
  );
}
```

**Interpolation Update Loop**:
```javascript
// Update crop during playback
useEffect(() => {
  if (!playing) return;
  
  const updateCrop = () => {
    const currentCrop = getCropAtTime(
      keyframes,
      currentTime,
      interpolationType
    );
    
    if (currentCrop) {
      setDisplayCrop(currentCrop);
    }
    
    animationFrameId = requestAnimationFrame(updateCrop);
  };
  
  updateCrop();
  
  return () => cancelAnimationFrame(animationFrameId);
}, [playing, currentTime, keyframes, interpolationType]);
```

### Performance Optimization
- Memoize interpolation calculations
- Use Canvas for overlay if SVG is slow
- Debounce properties panel updates
- Batch keyframe updates
- Use requestAnimationFrame for smooth updates

---

## Phase Completion Checklist

- [ ] All components implemented
- [ ] Crop overlay renders correctly
- [ ] Handles work smoothly
- [ ] Keyframe system functional
- [ ] Interpolation algorithms tested
- [ ] Different aspect ratios work
- [ ] Properties panel functional
- [ ] All tests passing
- [ ] Performance targets met
- [ ] Ready for Phase 3 (Import/Export)

---

## Next Phase Preview

Phase 3 will add:
- Complete import/export system
- Export with crop effects applied
- This validates that crop rendering works correctly
- Export is essential for MVP

---

## Notes for Claude Code

Critical considerations:
1. Test interpolation thoroughly - it's mathematically complex
2. Handle edge cases in resize logic (video boundaries)
3. Ensure smooth 60fps updates during playback
4. Different aspect ratio transitions are tricky - test extensively
5. Keyframe timing precision is critical (use exact frame times)
6. Memory management: don't leak event listeners or RAF callbacks
