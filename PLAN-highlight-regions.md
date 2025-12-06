# Highlight Regions & Draggable Boundaries Implementation Plan

## Overview

Transform the single highlight into multiple highlight regions with arbitrary start/end times. Each region is a self-contained unit with boundaries and keyframes.

---

## Status Summary

### ✅ Completed
- [x] Pass-through logic for Overlay mode (no export needed if no framing edits and single clip)
- [x] Timeline alignment - OverlayMode uses TimelineBase with proper layer labels
- [x] RegionLayer component for rendering highlight regions (reused from segment pattern)
- [x] Keyframe display on timeline using KeyframeMarker component
- [x] Basic boundary-based region system (`useHighlightRegions` hook)
- [x] Region enable/disable toggle UI
- [x] Color scheme for highlight regions (orange theme)

### ✅ Recently Completed
- [x] Region creation drops 3-second region instead of single boundary
- [x] Draggable boundary levers for region start/end
- [x] Region deletion
- [x] Start/end keyframe auto-creation when region is created

### 🔄 In Progress
- [ ] Keyframe editing within regions
- [ ] Export format updates for regions
- [ ] **Framing→Overlay bridge**: Export `.json` with clip timestamps from Framing mode (STEP 1, 5)
- [ ] **Framing→Overlay bridge**: Pass metadata through App.jsx to OverlayMode (STEP 2)
- [ ] **Framing→Overlay bridge**: Add `initializeFromClipMetadata()` to useHighlightRegions (STEP 3)
- [ ] **Framing→Overlay bridge**: Trigger auto-creation in OverlayMode useEffect (STEP 4)
- [ ] **Framing→Overlay bridge**: Accept `.json` files in Add button (STEP 6)

---

## Part 1: Highlight Region Architecture

### Core Concept: 3-Second Region Drop

When user clicks on the highlight timeline, instead of adding a single boundary, the system creates a complete **3-second region** with:

1. **Start Boundary** - with draggable lever handle
2. **End Boundary** - with draggable lever handle (at startTime + 3 seconds)
3. **Start Keyframe** - highlight ellipse position at region start
4. **End Keyframe** - highlight ellipse position at region end (initially mirrors start)

```
Timeline Visual:
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│     ┃████████████████████┃          ┃████████████┃              │
│     │    Region 1        │          │  Region 2  │              │
│     ↕                    ↕          ↕            ↕              │
│   lever               lever       lever        lever            │
│     ◆          ◆       ◆            ◆    ◆      ◆               │
│   start       mid     end        start  mid   end               │
│   keyframe  keyframe keyframe   keyframe     keyframe           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model

```javascript
// Highlight region structure
highlightRegion: {
  id: 'region-uuid-1',
  startTime: 2.5,           // seconds - region start (boundary position)
  endTime: 5.5,             // seconds - region end (boundary position)
  enabled: true,            // can be toggled on/off
  keyframes: [
    // Auto-created start keyframe
    {
      frame: 75,            // frame number at startTime
      x: 0.5,               // normalized position (0-1)
      y: 0.5,
      radiusX: 0.15,
      radiusY: 0.25,
      opacity: 0.15,
      color: '#FFFF00',
      origin: 'permanent'   // auto-created, cannot be deleted
    },
    // User-added keyframes (optional, created when editing)
    {
      frame: 100,
      x: 0.6,
      y: 0.4,
      ...
      origin: 'user'        // can be deleted
    },
    // Auto-created end keyframe (mirrors start initially)
    {
      frame: 165,           // frame number at endTime
      x: 0.5,
      y: 0.5,
      radiusX: 0.15,
      radiusY: 0.25,
      opacity: 0.15,
      color: '#FFFF00',
      origin: 'permanent'
    }
  ]
}
```

### State Management: `useHighlightRegions` Hook

**File:** `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`

**Current State (implemented):**
- `regions: HighlightRegion[]` - array of regions
- `boundaries: number[]` - derived from region start/end times
- `selectedRegionId: string | null` - currently selected region

**Actions to implement:**

```javascript
// Region lifecycle
addRegion(clickTime)          // Creates 3-second region centered at click time
                              // - Sets startTime = clickTime
                              // - Sets endTime = clickTime + 3.0
                              // - Creates start keyframe at startTime
                              // - Creates end keyframe at endTime (mirrors start)
                              // - Auto-selects the new region

deleteRegion(regionId)        // Removes region and all its keyframes

// Boundary manipulation (levers)
moveRegionStart(regionId, newStartTime)   // Drag left lever
                                          // - Clamps to not overlap adjacent region
                                          // - Recreates start keyframe if needed
                                          // - Maintains minimum duration (0.5s)

moveRegionEnd(regionId, newEndTime)       // Drag right lever
                                          // - Clamps to not overlap adjacent region
                                          // - Recreates end keyframe if needed
                                          // - Maintains minimum duration (0.5s)

// Keyframe management
addKeyframe(regionId, time, data)         // Add keyframe within region bounds
updateKeyframe(regionId, frameIndex, data) // Update existing keyframe
deleteKeyframe(regionId, frameIndex)      // Delete non-permanent keyframe

// Region properties
toggleRegion(regionId, enabled)           // Enable/disable region
selectRegion(regionId)                    // Set active region for editing

// Queries
getActiveRegionAtTime(time)               // Returns region if playhead is inside one
interpolateHighlightAtTime(time)          // Returns interpolated highlight data
```

**Constraints:**
- Regions cannot overlap
- Minimum region duration: 0.5 seconds
- Default region duration: 3.0 seconds
- Each region always has at least 2 keyframes (start and end, both permanent)
- Keyframes with `origin: 'permanent'` cannot be deleted
- Keyframes with `origin: 'user'` can be deleted

---

## Part 2: UI Components

### 2.1 RegionLayer (Existing - Needs Enhancement)

**File:** `src/frontend/src/components/timeline/RegionLayer.jsx`

**Current features (✅ implemented):**
- Renders region backgrounds
- Shows enable/disable toggle per region
- Displays boundaries as vertical lines
- Shows keyframes using KeyframeMarker
- Click to add boundary (needs update to add region)

**Enhancements needed:**
- [ ] Change click behavior: create 3-second region instead of single boundary
- [ ] Add draggable lever handles on region boundaries
- [ ] Add delete button on region hover
- [ ] Visual distinction for selected region

**Boundary Lever UI:**
```
Before (current):
    │    ← simple vertical line
    │

After (with levers):
    ┃    ← thicker, interactive boundary
   ◄┃►   ← lever handles appear on hover
    ┃      (drag to resize region)
   [×]   ← delete button on hover
```

### 2.2 HighlightOverlay (Existing - Works with Regions)

**File:** `src/frontend/src/modes/overlay/components/HighlightOverlay.jsx`

**Current behavior (✅ implemented):**
- Only renders when playhead is inside an enabled region
- Interpolates between keyframes within the region
- Allows dragging to edit highlight position

**Integration:**
- When user drags the ellipse, creates a new keyframe at current time
- Keyframe is added to the active region's keyframes array
- Start/end keyframes maintain mirror behavior until explicitly edited

### 2.3 OverlayMode (Existing - Aligned with Framing)

**File:** `src/frontend/src/modes/overlay/OverlayMode.jsx`

**Current features (✅ implemented):**
- Uses TimelineBase for consistent layout
- Has layer labels (Film icon, Circle icon)
- Renders RegionLayer for highlight regions
- Passes keyframes to RegionLayer for display

---

## Part 3: User Interactions

### 3.1 Creating a Region

**User Flow:**
1. User clicks on the highlight timeline (orange row)
2. System creates a 3-second region:
   - `startTime` = click position time
   - `endTime` = startTime + 3.0 seconds
   - Start keyframe created with default ellipse (centered, 0.15×0.25 radii)
   - End keyframe created mirroring start
3. Region is auto-selected
4. Ellipse appears on video at that time range

**Edge Cases:**
- If click position would cause region to extend past video end: clamp endTime to duration
- If click position overlaps existing region: find nearest valid position or reject
- Minimum region: 0.5 seconds (if near video end)

### 3.2 Resizing a Region (Lever Drag)

**User Flow:**
1. User hovers over region boundary → lever handles appear
2. User drags left lever → adjusts startTime
3. User drags right lever → adjusts endTime

**Constraints:**
- Cannot drag past adjacent region boundary
- Cannot drag to create region smaller than 0.5s
- Start lever cannot go past end lever and vice versa

**Keyframe Handling on Resize:**
- If boundary moves inward (shrinks): keyframes outside new bounds are deleted
- If boundary moves outward (grows): boundary keyframe moves with boundary
- Permanent (start/end) keyframes always exist at exact boundary positions

### 3.3 Editing Highlight Position

**User Flow:**
1. Seek to position within a region
2. Drag the ellipse on video
3. System adds/updates keyframe at current time
4. If editing at exact start time → updates start keyframe
5. If editing at exact end time → updates end keyframe (breaks mirror)
6. If editing at other time → creates new user keyframe

**Mirror Behavior:**
- Initially, end keyframe mirrors start keyframe data
- Once end keyframe is explicitly edited, mirror is broken
- Mirror state tracked by `isEndKeyframeExplicit` flag

### 3.4 Deleting a Region

**User Flow:**
1. Hover over region → delete button appears
2. Click delete button
3. Region and all its keyframes are removed
4. Or: Select region and press Delete key

### 3.5 Toggling Region Enable/Disable

**User Flow:**
1. Click the On/Off button below region
2. Region toggles enabled state
3. Disabled regions: ellipse doesn't render, region shown with gray overlay

---

## Part 4: Implementation Tasks

### Phase 1: Region Creation (Priority) ✅
1. [x] Update `addBoundary` in useHighlightRegions to create 3-second region (`addRegion`)
2. [x] Create start and end keyframes when region is created
3. [x] Implement `deleteRegion` action
4. [x] Add delete button UI to RegionLayer

### Phase 2: Boundary Levers ✅
1. [x] Add lever handle UI to region boundaries in RegionLayer
2. [x] Implement `moveRegionStart` action
3. [x] Implement `moveRegionEnd` action
4. [x] Add drag interaction for levers
5. [x] Handle keyframe adjustment on resize

### Phase 3: Keyframe Editing
1. [ ] Update HighlightOverlay to add keyframes to active region
2. [ ] Implement mirror behavior for end keyframe
3. [ ] Track `isEndKeyframeExplicit` per region
4. [ ] Allow deletion of user keyframes (not permanent ones)

### Phase 4: Export Integration
1. [ ] Update export format to include highlight regions
2. [ ] Update backend to process multiple regions
3. [ ] Handle region bounds in FFmpeg filter generation

---

## Part 5: Export Format

### Current Format (single highlight)
```javascript
{
  highlight_keyframes: [...],
  highlight_enabled: true,
  highlight_duration: 5.0
}
```

### New Format (multiple regions)
```javascript
{
  highlight_regions: [
    {
      id: 'region-uuid-1',
      start_time: 2.5,
      end_time: 5.5,
      enabled: true,
      keyframes: [
        { time: 2.5, x: 0.5, y: 0.5, radiusX: 0.15, radiusY: 0.25, opacity: 0.15, color: '#FFFF00' },
        { time: 4.0, x: 0.6, y: 0.4, radiusX: 0.15, radiusY: 0.25, opacity: 0.15, color: '#FFFF00' },
        { time: 5.5, x: 0.5, y: 0.5, radiusX: 0.15, radiusY: 0.25, opacity: 0.15, color: '#FFFF00' }
      ]
    },
    {
      id: 'region-uuid-2',
      start_time: 8.0,
      end_time: 11.0,
      enabled: true,
      keyframes: [...]
    }
  ]
}
```

---

## Files Reference

### Modified Files (in progress)
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` - region state management
- `src/frontend/src/components/timeline/RegionLayer.jsx` - region UI rendering
- `src/frontend/src/modes/overlay/components/HighlightOverlay.jsx` - ellipse rendering
- `src/frontend/src/modes/overlay/OverlayMode.jsx` - mode container

### Related Files (already aligned)
- `src/frontend/src/components/timeline/TimelineBase.jsx` - timeline infrastructure
- `src/frontend/src/components/timeline/KeyframeMarker.jsx` - keyframe diamonds
- `src/frontend/src/App.jsx` - state coordination

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Region duration on creation | 3 seconds | Reasonable default for highlight visibility |
| Minimum region duration | 0.5 seconds | Prevent accidentally tiny regions |
| Overlapping regions | Not allowed | Simpler interpolation, clearer UX |
| Keyframe storage | Per-region array | Each region is self-contained |
| Boundary interaction | Lever drag handles | Consistent with video editor patterns |
| Region deletion | Button + Delete key | Multiple access points |
| Mirror end keyframe | Until explicitly edited | Convenient for static highlights |

---

## Part 6: Auto-Highlight Regions from Framing Metadata

### Concept

When exporting from **Framing mode**, output both:
1. The stitched `.mp4` video (e.g., `my_export.mp4`)
2. A `.json` sidecar file with clip timestamps and names (e.g., `my_export.json`)

When loading a video in **Overlay mode**, if the user also adds the matching `.json` file, automatically create highlight regions for the **first 3 seconds of each clip**.

### Two Scenarios

**Scenario A: Automatic Transition (Framing → Overlay)**
- User exports in Framing mode
- `ExportButton.jsx` calls `onProceedToOverlay(blob, metadata)`
- Metadata passed directly in memory (no file needed)
- `App.jsx` stores metadata in state, passes to OverlayMode

**Scenario B: Manual Load (User opens video file in Overlay mode)**
- User clicks "Add" button and selects both `.mp4` and `.json` files
- System detects the `.json` file, parses it, and auto-creates regions
- Works even for single-file select if user adds .json after .mp4

---

### Meta File Format

**Filename:** `{video_name}.json` (e.g., `my_export.mp4` → `my_export.json`)

```json
{
  "version": 1,
  "source_clips": [
    {
      "name": "Interview_Take1.mp4",
      "start_time": 0.0,
      "end_time": 45.2
    },
    {
      "name": "BRoll_Shot3.mp4",
      "start_time": 45.2,
      "end_time": 52.8
    },
    {
      "name": "Interview_Take2.mp4",
      "start_time": 52.8,
      "end_time": 120.0
    }
  ]
}
```

---

### Implementation Details

#### STEP 1: Generate Metadata in ExportButton (Framing Export)

**File:** `src/frontend/src/components/ExportButton.jsx`

**Function:** `handleExport()` (around line 89)

**Changes:**
```javascript
// After successful export, before calling onProceedToOverlay:

// Build clip metadata from useClipManager data
const buildClipMetadata = (clips) => {
  let currentTime = 0;
  const sourceClips = clips.map(clip => {
    // Calculate effective duration after trim/speed
    const effectiveDuration = calculateEffectiveDuration(clip);

    const clipMeta = {
      name: clip.fileName,
      start_time: currentTime,
      end_time: currentTime + effectiveDuration
    };

    currentTime += effectiveDuration;
    return clipMeta;
  });

  return {
    version: 1,
    source_clips: sourceClips
  };
};

// In handleExport, after blob is received:
const clipMetadata = buildClipMetadata(clips);

// Pass both blob AND metadata to overlay
if (onProceedToOverlay) {
  await onProceedToOverlay(blob, clipMetadata);
}

// Also trigger download of .json for user
const metaBlob = new Blob([JSON.stringify(clipMetadata, null, 2)], { type: 'application/json' });
const metaUrl = URL.createObjectURL(metaBlob);
const metaLink = document.createElement('a');
metaLink.href = metaUrl;
metaLink.download = `${outputFileName.replace('.mp4', '')}.json`;  // e.g., my_video.json
metaLink.click();
```

**Helper Function (add to ExportButton or utils):**
```javascript
// Calculate effective clip duration after trim and speed adjustments
const calculateEffectiveDuration = (clip) => {
  const segments = clip.segments || {};
  const trimRange = segments.trimRange || clip.trimRange;
  const segmentSpeeds = segments.segmentSpeeds || {};

  // Start with full duration or trimmed range
  let start = trimRange?.start ?? 0;
  let end = trimRange?.end ?? clip.duration;

  // If no speed changes, simple calculation
  if (Object.keys(segmentSpeeds).length === 0) {
    return end - start;
  }

  // Calculate duration accounting for speed changes per segment
  const boundaries = segments.boundaries || [0, clip.duration];
  let totalDuration = 0;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = Math.max(boundaries[i], start);
    const segEnd = Math.min(boundaries[i + 1], end);

    if (segEnd > segStart) {
      const speed = segmentSpeeds[String(i)] || 1.0;
      totalDuration += (segEnd - segStart) / speed;
    }
  }

  return totalDuration;
};
```

---

#### STEP 2: Pass Metadata Through App.jsx

**File:** `src/frontend/src/App.jsx`

**New State:**
```javascript
// Add new state for clip metadata (near other overlay state)
const [overlayClipMetadata, setOverlayClipMetadata] = useState(null);
```

**Update `handleProceedToOverlay`:**
```javascript
// Current signature:
const handleProceedToOverlay = async (blob) => { ... }

// New signature:
const handleProceedToOverlay = async (blob, clipMetadata = null) => {
  // ... existing blob handling ...

  // Store clip metadata for overlay mode
  setOverlayClipMetadata(clipMetadata);

  // Switch to overlay mode
  setEditorMode('overlay');
};
```

**Pass to OverlayMode:**
```javascript
<OverlayMode
  // ... existing props ...
  clipMetadata={overlayClipMetadata}  // NEW
  onClearClipMetadata={() => setOverlayClipMetadata(null)}  // Optional: clear after use
/>
```

---

#### STEP 3: Auto-Create Regions in useHighlightRegions

**File:** `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`

**New Function:** `initializeFromClipMetadata(metadata)`

```javascript
// Add to the hook's returned API:

const initializeFromClipMetadata = useCallback((metadata, videoWidth, videoHeight) => {
  if (!metadata || !metadata.source_clips || metadata.source_clips.length === 0) {
    return 0;  // No regions created
  }

  const newRegions = [];

  metadata.source_clips.forEach((clip, index) => {
    const regionStart = clip.start_time;
    const regionEnd = Math.min(clip.start_time + 3.0, clip.end_time);

    // Only create if region would be at least 0.5 seconds
    if (regionEnd - regionStart < 0.5) return;

    const regionId = `region-auto-${index}-${Date.now()}`;

    // Create default highlight keyframes for start and end
    // Uses video dimensions from loaded video metadata
    const defaultHighlight = calculateDefaultHighlight(videoWidth, videoHeight);

    newRegions.push({
      id: regionId,
      startTime: regionStart,
      endTime: regionEnd,
      enabled: true,
      label: clip.name,  // Store clip name for display
      autoGenerated: true,  // Flag to identify auto-created regions
      keyframes: [
        {
          frame: Math.round(regionStart * 30),  // 30fps
          ...defaultHighlight,
          origin: 'permanent'
        },
        {
          frame: Math.round(regionEnd * 30),
          ...defaultHighlight,
          origin: 'permanent'
        }
      ]
    });
  });

  // Set all regions at once
  setRegions(newRegions);

  return newRegions.length;  // Return count for notification
}, [calculateDefaultHighlight]);

// Return from hook:
return {
  // ... existing API ...
  initializeFromClipMetadata,
};
```

---

#### STEP 4: Trigger Auto-Creation in OverlayMode

**File:** `src/frontend/src/modes/overlay/OverlayMode.jsx`

**Add useEffect to handle incoming metadata:**
```javascript
// Props
const { clipMetadata, onClearClipMetadata } = props;

// Get the initialize function from useHighlightRegions
const { initializeFromClipMetadata, regions } = useHighlightRegions(metadata);

// Auto-create regions when clipMetadata is provided
useEffect(() => {
  if (clipMetadata && regions.length === 0) {
    const count = initializeFromClipMetadata(clipMetadata);

    if (count > 0) {
      // Show toast notification (if you have a toast system)
      console.log(`Created ${count} highlight regions from clip data`);
      // toast.success(`Created ${count} highlight regions from clip boundaries`);
    }

    // Clear metadata after processing (prevent re-triggering)
    if (onClearClipMetadata) {
      onClearClipMetadata();
    }
  }
}, [clipMetadata, regions.length, initializeFromClipMetadata, onClearClipMetadata]);
```

---

#### STEP 5: Download Meta File with Video

**File:** `src/frontend/src/components/ExportButton.jsx`

**In `handleExport()`, after video download:**
```javascript
// Download video
const videoLink = document.createElement('a');
videoLink.href = url;
videoLink.download = outputFileName;
videoLink.click();

// Also download metadata file
if (clips && clips.length > 0) {
  const clipMetadata = buildClipMetadata(clips, globalAspectRatio);
  const metaBlob = new Blob([JSON.stringify(clipMetadata, null, 2)], {
    type: 'application/json'
  });
  const metaUrl = URL.createObjectURL(metaBlob);

  // Small delay to avoid browser blocking second download
  setTimeout(() => {
    const metaLink = document.createElement('a');
    metaLink.href = metaUrl;
    metaLink.download = outputFileName.replace('.mp4', '.meta.json');
    metaLink.click();
    URL.revokeObjectURL(metaUrl);
  }, 100);
}
```

---

#### STEP 6: Handle .json Files in Add Button (Overlay Mode)

**File:** `src/frontend/src/App.jsx` (or FileUpload component)

**Update file input to accept .json files:**
```javascript
// File input should accept both video and json
<input
  type="file"
  accept="video/*,.json,application/json"
  multiple  // Allow selecting both .mp4 and .json at once
  onChange={handleFileSelect}
/>
```

**Handle both file types in selection handler:**
```javascript
const handleFileSelect = async (event) => {
  const files = Array.from(event.target.files);

  for (const file of files) {
    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      // Handle JSON metadata file
      await handleMetaFileSelect(file);
    } else if (file.type.startsWith('video/')) {
      // Handle video file (existing logic)
      await handleVideoFileSelect(file);
    }
  }
};

const handleMetaFileSelect = async (file) => {
  try {
    const text = await file.text();
    const metadata = JSON.parse(text);

    // Validate structure
    if (metadata.version && Array.isArray(metadata.source_clips)) {
      setOverlayClipMetadata(metadata);
      console.log(`Loaded clip metadata: ${metadata.source_clips.length} clips`);
    } else {
      console.warn('Invalid metadata file structure');
    }
  } catch (e) {
    console.warn('Failed to parse metadata file:', e);
  }
};
```

**User Workflow:**
1. User clicks "Add" button in Overlay mode
2. User selects `my_video.mp4` AND `my_video.json` (multi-select or add separately)
3. System loads video normally
4. System detects .json, parses it, stores in `overlayClipMetadata`
5. `useEffect` in OverlayMode triggers `initializeFromClipMetadata()`
6. Highlight regions auto-created at each clip boundary

---

### UI Considerations

**RegionLayer.jsx - Show clip labels on auto-generated regions:**
```javascript
// In region rendering:
{region.label && (
  <div className="region-label" style={{
    position: 'absolute',
    top: 2,
    left: 4,
    fontSize: '10px',
    color: 'rgba(255,255,255,0.7)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '80%'
  }}>
    {region.label}
  </div>
)}
```

**Visual indicator for auto-generated regions:**
```javascript
// Different border style for auto-generated
const regionStyle = {
  // ... existing styles ...
  borderStyle: region.autoGenerated ? 'dashed' : 'solid',
};
```

---

### Files Changed Summary

| File | Changes |
|------|---------|
| `src/frontend/src/components/ExportButton.jsx` | Add `buildClipMetadata()`, `calculateEffectiveDuration()`, download `.json`, pass metadata to `onProceedToOverlay` |
| `src/frontend/src/App.jsx` | Add `overlayClipMetadata` state, update `handleProceedToOverlay(blob, metadata)`, update file input to accept `.json`, add `handleMetaFileSelect()` |
| `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` | Add `initializeFromClipMetadata(metadata, width, height)` function |
| `src/frontend/src/modes/overlay/OverlayMode.jsx` | Add useEffect to auto-create regions when `clipMetadata` prop is set |
| `src/frontend/src/components/timeline/RegionLayer.jsx` | (Optional) Show clip labels, visual indicator for auto-generated regions |

---

### Design Decisions (Part 6)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Meta file extension | `.json` | Simple, standard format |
| Single-clip exports | Include metadata | Consistency; creates one region at time 0 |
| Manual load UX | Add button accepts .json | User can multi-select or add separately |
| Transition timestamps | Sequential (no overlap) | Simpler; can revisit if needed |

---

### Future Enhancements (Part 6)

- Add **segmentation data** to metadata file (segment boundaries, speeds)
- Auto-detect clip transitions for more precise highlight placement
- "Regenerate regions from metadata" button if user deletes auto-created regions
