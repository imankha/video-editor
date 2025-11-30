# Phase 4: Speed Controls

**Core Concept**: Variable playback speed with region-based controls  
**Risk Level**: MEDIUM - Complex video processing  
**Dependencies**: Phase 1, 2, 3

---

## Objective

Add ability to change playback speed for different sections of the video. Users can create "speed regions" on a dedicated timeline track, where each region has a different playback speed multiplier (0.1x to 10x).

---

## Features

### Speed Control Track
- Dedicated track below crop track on timeline
- Height: 60px
- Visual: rectangular regions with speed labels
- Empty track means 1x speed (normal) everywhere

### Speed Regions
- Visual: Colored rectangular blocks on speed track
- Label: Shows speed multiplier (e.g., "2.0x", "0.5x")
- Color-coded by speed:
  - Slower than 1x: Blue gradient
  - 1x: Gray (neutral)
  - Faster than 1x: Red/orange gradient
- Draggable edges to resize region
- Click to select region
- Delete selected region (Delete key or right-click)

### Speed Tool
- Add to toolbar/palette
- Click track to create new speed region
- Default: Creates 5-second region at 1x speed
- No overlapping regions (auto-snap to adjacent)

### Properties Panel - Speed Controls
- Speed slider: 0.1x to 10x
- Numeric input for precise value
- Preset buttons:
  - 0.25x (Quarter speed)
  - 0.5x (Half speed)
  - 1.0x (Normal - default)
  - 1.5x (1.5× speed)
  - 2.0x (Double speed)
  - 4.0x (4× speed)
- Audio pitch preservation toggle
- Region duration display

### Playback with Speed
- Video plays at region's speed
- Smooth transitions between regions
- Timeline playhead moves at adjusted rate
- Time display shows:
  - Real time (actual video time)
  - Playback time (adjusted for speed)

---

## User Interface

```
┌─────────────────────────────────────────────────┬──────────┐
│  Video Editor                           [File]  │          │
├─────────────────────────────────────────────────┤  SPEED   │
│                                                 │  PANEL   │
│              Video Preview                      │          │
│                                                 │  Speed:  │
│                                                 │  ●━━━━○  │
│                                                 │  0.1x 10x│
│                                                 │          │
│                                                 │  [2.5x]  │
│                                                 │          │
│                                                 │  Presets:│
│                                                 │  [0.25x] │
├─────────────────────────────────────────────────┤  [0.5x]  │
│                                                 │  [1.0x]  │
│  Video Track                                    │  [1.5x]  │
│  ████████████████████████████████              │  [2.0x]  │
│                                                 │  [4.0x]  │
│  Crop Track                                     │          │
│  ──●─────────●────────●──────────              │  Duration│
│                                                 │  5.0 sec │
│  Speed Track                                    │          │
│  ░░[0.5x]░░░░[2.0x]░░░░░[1.0x]░░░              │  □ Keep  │
│    ↑         ↑          ↑                       │   Pitch  │
│   Slow     Fast      Normal                     │          │
│                                                 │          │
│  ────────────────█──────────────────────────    │  [Delete │
│  0:00            ↑                      10:00   │   Region]│
│               Playhead                          │          │
│                                                 │          │
│  Real Time:    00:05:00                         │          │
│  Playback:     00:03:45 (faster overall)        │          │
└─────────────────────────────────────────────────┴──────────┘
```

---

## Technical Architecture

### Component Structure

```
src/
├── components/
│   ├── SpeedTrack.jsx           # NEW: Speed regions track
│   ├── SpeedRegion.jsx          # NEW: Individual speed region
│   ├── SpeedPropertiesPanel.jsx # NEW: Speed controls
│   └── SpeedTool.jsx            # NEW: Create speed regions
├── hooks/
│   ├── useSpeed.js              # NEW: Speed state management
│   ├── useSpeedPlayback.js      # NEW: Playback with speed
│   └── useSpeedRegions.js       # NEW: Region operations
├── utils/
│   ├── speedCalculations.js     # NEW: Speed-related math
│   ├── regionUtils.js           # NEW: Region management
│   └── timeAdjustment.js        # NEW: Time conversion
└── types/
    └── speed.ts                 # NEW: Speed type definitions
```

### Extended State Management

```javascript
const AppState = {
  // ... existing state from previous phases
  
  // Speed system
  speed: {
    enabled: boolean,
    regions: SpeedRegion[],
    activeRegionId: string | null,
    preservePitch: boolean,
    
    // Playback timing
    timing: {
      realTime: number,         // Actual video time
      playbackTime: number,     // Adjusted time accounting for speed
      currentSpeed: number      // Speed at current playhead position
    }
  }
}
```

---

## Data Models

### SpeedRegion
```typescript
interface SpeedRegion {
  id: string;
  startTime: number;         // Start time in real seconds
  endTime: number;           // End time in real seconds
  speed: number;             // Speed multiplier (0.1 to 10)
  preservePitch: boolean;    // Audio pitch correction
}
```

### SpeedTiming
```typescript
interface SpeedTiming {
  realTime: number;          // Actual position in source video
  playbackTime: number;      // Position accounting for speed changes
  currentSpeed: number;      // Speed multiplier at current position
}
```

---

## Core Algorithms

### 1. Real Time to Playback Time Conversion

```javascript
/**
 * Convert real video time to playback time (accounting for speed regions)
 * @param realTime - Actual time in source video
 * @param regions - Array of speed regions (sorted by startTime)
 * @returns Playback time
 */
function realTimeToPlaybackTime(realTime, regions) {
  if (regions.length === 0) {
    return realTime; // No regions = 1x speed
  }
  
  let playbackTime = 0;
  let currentTime = 0;
  
  // Sort regions by start time
  const sortedRegions = [...regions].sort((a, b) => a.startTime - b.startTime);
  
  for (const region of sortedRegions) {
    // Time before this region (at 1x speed)
    if (currentTime < region.startTime) {
      const normalDuration = Math.min(realTime, region.startTime) - currentTime;
      playbackTime += normalDuration;
      currentTime = region.startTime;
    }
    
    // If realTime is within this region
    if (realTime >= region.startTime && realTime <= region.endTime) {
      const regionDuration = realTime - region.startTime;
      playbackTime += regionDuration * region.speed;
      return playbackTime;
    }
    
    // If realTime is after this region, add full region duration
    if (realTime > region.endTime) {
      const regionDuration = region.endTime - region.startTime;
      playbackTime += regionDuration * region.speed;
      currentTime = region.endTime;
    }
  }
  
  // Time after all regions (at 1x speed)
  if (currentTime < realTime) {
    playbackTime += (realTime - currentTime);
  }
  
  return playbackTime;
}

/**
 * Convert playback time to real time (inverse of above)
 * @param playbackTime - Adjusted playback time
 * @param regions - Array of speed regions
 * @returns Real time in source video
 */
function playbackTimeToRealTime(playbackTime, regions) {
  if (regions.length === 0) {
    return playbackTime;
  }
  
  let remainingPlayback = playbackTime;
  let realTime = 0;
  
  const sortedRegions = [...regions].sort((a, b) => a.startTime - b.startTime);
  
  for (const region of sortedRegions) {
    // Time before region (1x speed)
    if (realTime < region.startTime) {
      const normalDuration = region.startTime - realTime;
      
      if (remainingPlayback <= normalDuration) {
        return realTime + remainingPlayback;
      }
      
      remainingPlayback -= normalDuration;
      realTime = region.startTime;
    }
    
    // Time within region
    const regionDuration = region.endTime - region.startTime;
    const regionPlaybackDuration = regionDuration * region.speed;
    
    if (remainingPlayback <= regionPlaybackDuration) {
      return realTime + (remainingPlayback / region.speed);
    }
    
    remainingPlayback -= regionPlaybackDuration;
    realTime = region.endTime;
  }
  
  // Time after all regions (1x speed)
  return realTime + remainingPlayback;
}
```

### 2. Speed at Time

```javascript
/**
 * Get speed multiplier at specific time
 * @param time - Real time in video
 * @param regions - Speed regions
 * @returns Speed multiplier (default 1.0)
 */
function getSpeedAtTime(time, regions) {
  const region = regions.find(r => 
    time >= r.startTime && time < r.endTime
  );
  
  return region ? region.speed : 1.0;
}
```

### 3. Region Overlap Prevention

```javascript
/**
 * Adjust region to prevent overlap with existing regions
 * @param newRegion - Region being created/resized
 * @param existingRegions - All other regions
 * @returns Adjusted region that doesn't overlap
 */
function preventOverlap(newRegion, existingRegions) {
  const adjusted = {...newRegion};
  
  // Sort existing regions
  const sorted = [...existingRegions]
    .filter(r => r.id !== newRegion.id)
    .sort((a, b) => a.startTime - b.startTime);
  
  // Check left boundary
  for (const region of sorted) {
    if (region.endTime > adjusted.startTime && 
        region.startTime < adjusted.startTime) {
      // Snap to end of previous region
      adjusted.startTime = region.endTime;
    }
  }
  
  // Check right boundary
  for (const region of sorted) {
    if (region.startTime < adjusted.endTime && 
        region.endTime > adjusted.endTime) {
      // Snap to start of next region
      adjusted.endTime = region.startTime;
    }
  }
  
  // Ensure minimum duration (0.1 seconds)
  if (adjusted.endTime - adjusted.startTime < 0.1) {
    adjusted.endTime = adjusted.startTime + 0.1;
  }
  
  return adjusted;
}
```

### 4. Total Duration Calculation

```javascript
/**
 * Calculate total playback duration with speed effects
 * @param videoDuration - Original video duration
 * @param regions - Speed regions
 * @returns Total playback duration
 */
function calculateTotalDuration(videoDuration, regions) {
  return realTimeToPlaybackTime(videoDuration, regions);
}
```

---

## API Contracts

### Speed Region Operations
```typescript
/**
 * Create new speed region
 */
function createSpeedRegion(
  startTime: number,
  endTime: number,
  speed: number = 1.0
): SpeedRegion

/**
 * Update region speed
 */
function updateRegionSpeed(regionId: string, speed: number): void

/**
 * Update region boundaries
 */
function updateRegionBoundaries(
  regionId: string,
  startTime: number,
  endTime: number
): void

/**
 * Delete region
 */
function deleteSpeedRegion(regionId: string): void

/**
 * Get speed at time
 */
function getSpeedAtTime(time: number): number

/**
 * Convert times between real and playback
 */
function realToPlayback(realTime: number): number
function playbackToReal(playbackTime: number): number

/**
 * Toggle pitch preservation
 */
function togglePitchPreservation(regionId: string): void
```

---

## Implementation Requirements

### Speed Track Rendering
- Draw as horizontal track below crop track
- Regions as colored rectangles
- Labels centered in regions
- Region boundaries draggable
- Empty spaces between regions = 1x speed
- Visual feedback on hover and drag

### Playback Rate Control
```javascript
// Adjust video playback rate
video.playbackRate = currentSpeed;

// For pitch preservation (use Web Audio API)
const audioContext = new AudioContext();
const source = audioContext.createMediaElementSource(video);
const pitchShifter = audioContext.createScriptProcessor(4096, 2, 2);

// Apply pitch correction
pitchShifter.onaudioprocess = (e) => {
  // Implement pitch shifting algorithm
  // (or use library like soundtouchjs)
};
```

### Time Display
- Show both real time and playback time
- Update displays continuously during playback
- Format as HH:MM:SS.mmm
- Clearly label which is which

### Export Integration
- Export must render at correct speeds
- Frame duplication for slow-mo
- Frame skipping for fast-forward
- Audio time-stretching with pitch preservation

---

## Testing Requirements

### Functional Tests
- [ ] Create speed region
- [ ] Resize region boundaries
- [ ] Change region speed via slider
- [ ] Change region speed via numeric input
- [ ] Apply preset speeds
- [ ] Delete region
- [ ] Prevent region overlap
- [ ] Playback at correct speed
- [ ] Speed transitions are smooth
- [ ] Pitch preservation works
- [ ] Export includes speed effects

### Performance Tests
- [ ] 10+ speed regions perform smoothly
- [ ] Real-time playback at 0.25x
- [ ] Real-time playback at 4x
- [ ] Time conversion is fast (< 1ms)

### Edge Cases
- [ ] Region at video start (time = 0)
- [ ] Region at video end
- [ ] Very short region (0.1 seconds)
- [ ] Very long region (full video)
- [ ] Speed = 0.1x (very slow)
- [ ] Speed = 10x (very fast)
- [ ] Multiple adjacent regions
- [ ] Combining speed and crop effects

---

## Acceptance Criteria

### Must Have
✅ User can create speed regions  
✅ User can adjust speed (0.1x to 10x)  
✅ Playback respects speed regions  
✅ Time displays are accurate  
✅ No region overlaps  
✅ Export includes speed effects  

### Should Have
✅ Preset speed buttons work  
✅ Pitch preservation toggle works  
✅ Smooth transitions between regions  
✅ Visual feedback is clear  

### Nice to Have
- Speed ramping (gradual transitions)
- Reverse playback (negative speed)
- Speed curves (non-linear speed changes)

---

## Development Guidelines for AI

### Implementation Order
1. Add speed state management
2. Create SpeedTrack component
3. Implement region creation
4. Add region resizing
5. Implement speed adjustment
6. Add time conversion functions
7. Modify playback to use speed
8. Add properties panel
9. Integrate with export
10. Test thoroughly

### Critical Code Sections

**Speed-aware Playback**:
```javascript
useEffect(() => {
  if (!playing) return;
  
  const updatePlayback = () => {
    const currentSpeed = getSpeedAtTime(video.currentTime, speedRegions);
    
    // Set video playback rate
    video.playbackRate = currentSpeed;
    
    // Update time displays
    const playbackTime = realTimeToPlaybackTime(video.currentTime, speedRegions);
    setPlaybackTime(playbackTime);
    
    requestAnimationFrame(updatePlayback);
  };
  
  updatePlayback();
}, [playing, video.currentTime, speedRegions]);
```

**Region Rendering**:
```jsx
function SpeedRegion({ region, timelineWidth, videoDuration, isSelected }) {
  const left = (region.startTime / videoDuration) * timelineWidth;
  const width = ((region.endTime - region.startTime) / videoDuration) * timelineWidth;
  
  const color = region.speed < 1 
    ? `rgb(100, 150, 255)` // Blue for slow
    : region.speed > 1
      ? `rgb(255, 100, 100)` // Red for fast
      : `rgb(150, 150, 150)`; // Gray for normal
  
  return (
    <div
      className="speed-region"
      style={{
        position: 'absolute',
        left: `${left}px`,
        width: `${width}px`,
        height: '100%',
        backgroundColor: color,
        border: isSelected ? '2px solid white' : 'none'
      }}
    >
      <div className="speed-label">
        {region.speed.toFixed(2)}x
      </div>
      
      {/* Resize handles */}
      <div className="resize-handle left" 
           onMouseDown={(e) => startResize(e, 'left')} />
      <div className="resize-handle right" 
           onMouseDown={(e) => startResize(e, 'right')} />
    </div>
  );
}
```

---

## Phase Completion Checklist

- [ ] Speed track component working
- [ ] Can create and delete regions
- [ ] Can adjust region speed
- [ ] Playback uses correct speed
- [ ] Time conversions accurate
- [ ] Properties panel functional
- [ ] Export includes speed effects
- [ ] All tests passing
- [ ] Ready for Phase 5 (Timeline Editing)

---

## Next Phase Preview

Phase 5 will add:
- Trim functionality
- Scissors tool for splitting
- Multi-clip support
- Professional timeline editing

---

## Notes for Claude Code

Critical considerations:
1. Time conversion must be bidirectional and consistent
2. Playback rate changes can cause audio glitches
3. Pitch preservation requires Web Audio API or library
4. Export speed effects require frame manipulation
5. Region overlap prevention is tricky at boundaries
6. Very slow speeds (< 0.5x) may need frame interpolation
7. Very fast speeds (> 4x) may skip too many frames
8. Test time conversions extensively with multiple regions
