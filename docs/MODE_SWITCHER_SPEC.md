# Mode Switcher Implementation Spec

## Overview

This spec defines the implementation of a two-phase editing workflow: **Framing Mode** and **Overlay Mode**. Each mode has completely isolated state and its own timeline instance. The transition between modes involves an internal render/export that feeds the Framing output into Overlay mode.

### Key Principles
1. **Stateless app** - No persistence, no project saving
2. **Complete memory isolation** - Each mode has independent state
3. **Overlay requires explicit video** - Must be from Framing export OR fresh upload (never pass-through of original)
4. **Desktop-optimized** - Full-featured on large screens, graceful on mobile
5. **DRY architecture** - Shared base components, mode-specific extensions
6. **File organization by mode** - Separate directories for mode-specific code

---

## Complexity Analysis

### Overall Assessment: **MEDIUM-HIGH**

The full implementation touches many files and introduces new patterns. However, it can be **significantly de-risked** by doing prep refactors first.

### Complexity Breakdown

| Component | Complexity | Risk | Notes |
|-----------|------------|------|-------|
| File reorganization | Low | Medium | Mechanical but many imports to update |
| Timeline extraction | Medium | Low | Logic extraction, no behavior change |
| Mode state in App.jsx | Medium | Medium | New state, conditional rendering |
| Mode transition logic | Medium | Medium | Render step, error handling |
| Backend endpoint | Low | Low | Reuses existing code |
| Video source enforcement | Low | Low | Just state rules |

### What Makes It Complex

1. **Big bang risk** - Changing files + adding features simultaneously is risky
2. **Timeline.jsx is 540 lines** - Hard to refactor and add features at once
3. **ExportButton.jsx has export logic** - Need to extract before splitting
4. **Many import paths change** - File moves break things

### How to Make It Easier

**Strategy: Prep refactors create building blocks, then assembly is simple.**

If we extract shared components FIRST (no behavior changes), then mode switching becomes:
- Import `TimelineBase` instead of `Timeline`
- Import `FramingExport` instead of `ExportButton`
- Add mode state and conditional rendering

---

## Prep Refactor Phase (Do First, Zero Feature Changes)

**Goal:** Extract shared components and reorganize files WITHOUT changing any behavior. App should work identically after each step. Each step is independently deployable.

### Prep 1: Create Directory Structure (30 min)

Create empty directories and index files. No file moves yet.

```bash
# Create mode directories
mkdir -p src/frontend/src/modes/framing/{hooks,layers,overlays,contexts}
mkdir -p src/frontend/src/modes/overlay/{hooks,layers,overlays,contexts}
mkdir -p src/frontend/src/components/timeline
mkdir -p src/frontend/src/components/shared

# Create index.js files for clean imports later
touch src/frontend/src/modes/framing/index.js
touch src/frontend/src/modes/overlay/index.js
touch src/frontend/src/components/timeline/index.js
touch src/frontend/src/components/shared/index.js
```

**Verification:** App builds and runs unchanged.

---

### Prep 2: Extract TimelineBase (2-3 hours)

**Current:** `Timeline.jsx` (540 lines) has playhead logic + all layers inline.

**Goal:** Extract playhead/scrubbing logic into `TimelineBase.jsx`. Timeline.jsx becomes a thin wrapper.

**File: `src/frontend/src/components/timeline/TimelineBase.jsx`**

Extract from Timeline.jsx:
- `getTimeFromPosition()` function
- `handleMouseDown/Move/Up/Leave` handlers
- `isDragging`, `hoverTime`, `hoverX` state
- Wheel zoom handling
- Scroll sync logic
- Auto-scroll to playhead
- Time display rendering
- Playhead line rendering

```jsx
/**
 * Shared timeline foundation.
 * Extracted from Timeline.jsx - handles playhead, scrubbing, zoom.
 * Mode-specific layers passed as children.
 */
export function TimelineBase({
  currentTime,
  duration,
  visualDuration,
  onSeek,
  timelineZoom,
  timelineScale,
  onTimelineZoomByWheel,
  sourceTimeToVisualTime,
  visualTimeToSourceTime,
  selectedLayer,
  layerLabels,      // ReactNode - mode provides its own labels
  children,         // ReactNode - mode-specific layers
  totalLayerHeight, // number - for playhead line height
}) {
  // ... extracted logic from Timeline.jsx lines 104-253
}
```

**File: `src/frontend/src/components/Timeline.jsx`** (modified)

After extraction, Timeline.jsx becomes:

```jsx
import { TimelineBase } from './timeline/TimelineBase';
import CropLayer from './CropLayer';
import SegmentLayer from './SegmentLayer';
import HighlightLayer from './HighlightLayer';

export function Timeline(props) {
  const layerLabels = (
    <>
      {/* Existing label JSX from lines 276-336 */}
    </>
  );

  return (
    <TimelineBase
      {...timelineBaseProps}
      layerLabels={layerLabels}
      totalLayerHeight={calculateHeight()}
    >
      <CropLayer {...cropProps} />
      {segments.length > 0 && <SegmentLayer {...segmentProps} />}
      <HighlightLayer {...highlightProps} />
    </TimelineBase>
  );
}
```

**Verification:**
- App works identically
- Timeline looks and behaves the same
- Playhead scrubbing works
- Zoom works
- All layers render correctly

---

### Prep 3: Extract KeyframeMarker (1 hour)

**Current:** CropLayer and HighlightLayer both render keyframe markers with similar code.

**Goal:** Single `KeyframeMarker` component used by both.

**File: `src/frontend/src/components/timeline/KeyframeMarker.jsx`**

```jsx
/**
 * Reusable keyframe marker for timeline layers.
 * Supports different shapes and colors for each layer type.
 */
export function KeyframeMarker({
  position,           // 0-100 percentage
  shape = 'diamond',  // 'diamond' | 'circle'
  colorClass = 'bg-yellow-500',
  selectedColorClass = 'bg-yellow-300',
  isSelected = false,
  isPermanent = false,
  onClick,
  onContextMenu,      // For right-click delete/copy
  tooltip,
  edgePadding = 20,
}) {
  const shapeClasses = {
    diamond: 'rotate-45 w-3 h-3',
    circle: 'rounded-full w-3 h-3',
  };

  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 transform -translate-x-1/2
        cursor-pointer transition-all z-20
        ${shapeClasses[shape]}
        ${isSelected ? `${selectedColorClass} ring-2 ring-white scale-125` : colorClass}
        ${isPermanent ? 'opacity-60' : 'opacity-100'}
      `}
      style={{
        left: `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${position / 100})`
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={tooltip}
    />
  );
}
```

**Update CropLayer.jsx and HighlightLayer.jsx** to use `KeyframeMarker` instead of inline rendering.

**Verification:**
- Crop keyframes render as yellow diamonds
- Highlight keyframes render as orange circles
- Selection highlighting works
- Click to seek works
- Right-click context menu works

---

### Prep 4: Extract ExportProgress (1 hour)

**Current:** ExportButton.jsx has progress UI inline (lines 338-360).

**Goal:** Extract progress display so both FramingExport and OverlayExport can use it.

**File: `src/frontend/src/components/shared/ExportProgress.jsx`**

```jsx
/**
 * Shared export progress display.
 * Shows spinner, percentage, message, and progress bar.
 */
export function ExportProgress({
  isExporting,
  progress,
  progressMessage,
  label = 'AI Upscaling',
}) {
  if (!isExporting) return null;

  return (
    <>
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <Loader className="animate-spin" size={18} />
          <span className="font-medium">{label}... {progress}%</span>
        </div>
        {progressMessage && (
          <div className="text-xs opacity-80 mb-2">
            {progressMessage}
          </div>
        )}
      </div>

      <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className="bg-green-600 h-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </>
  );
}
```

**Update ExportButton.jsx** to use `<ExportProgress ... />`.

**Verification:** Export progress looks identical during export.

---

### Prep 5: Extract videoMetadata utility (30 min)

**Current:** Video metadata extraction is inline in useVideo.js.

**Goal:** Reusable function for both modes.

**File: `src/frontend/src/utils/videoMetadata.js`**

```javascript
/**
 * Extract metadata from a video File or Blob.
 * Used by both Framing (original upload) and Overlay (rendered video).
 */
export async function extractVideoMetadata(videoSource) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
    };

    video.onloadedmetadata = () => {
      const metadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        fileName: videoSource.name || 'rendered_video.mp4',
        size: videoSource.size,
        format: videoSource.type?.split('/')[1] || 'mp4',
      };
      cleanup();
      resolve(metadata);
    };

    video.onerror = (e) => {
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = URL.createObjectURL(videoSource);
  });
}
```

**Update useVideo.js** to use this utility (optional - can keep inline too).

**Verification:** Video metadata displays correctly after upload.

---

### Prep 6: Make VideoPlayer overlay-agnostic (1 hour)

**Current:** VideoPlayer.jsx has hardcoded CropOverlay and HighlightOverlay.

**Goal:** Accept overlays as props so modes can provide their own.

**Current code (VideoPlayer.jsx):**
```jsx
{showCropOverlay && currentCrop && (
  <CropOverlay ... />
)}
{showHighlightOverlay && isHighlightEnabled && currentHighlight && (
  <HighlightOverlay ... />
)}
```

**New code:**
```jsx
export function VideoPlayer({
  // ... existing props
  overlays = [],  // Array of ReactNode overlays to render
}) {
  return (
    <div className="video-container ...">
      <video ... />

      {/* Render any overlays passed by the mode */}
      {overlays}
    </div>
  );
}
```

**Update App.jsx** to pass overlays:
```jsx
<VideoPlayer
  ...
  overlays={[
    showCropOverlay && currentCrop && <CropOverlay key="crop" ... />,
    showHighlightOverlay && isHighlightEnabled && currentHighlight && <HighlightOverlay key="highlight" ... />,
  ].filter(Boolean)}
/>
```

**Verification:** Crop and highlight overlays still render and are interactive.

---

### Prep 7: Add index.js re-exports (30 min)

Create clean import paths for when we move files.

**File: `src/frontend/src/components/timeline/index.js`**
```javascript
export { TimelineBase } from './TimelineBase';
export { KeyframeMarker } from './KeyframeMarker';
export { LayerLabel } from './LayerLabel';
// Export other timeline components as they're created
```

**File: `src/frontend/src/components/shared/index.js`**
```javascript
export { ExportProgress } from './ExportProgress';
export { default as Controls } from '../Controls';
export { default as FileUpload } from '../FileUpload';
// etc.
```

**Verification:** Can import from index files.

---

### Prep Refactor Summary

| Step | Time | Risk | Independently Deployable? |
|------|------|------|--------------------------|
| 1. Create directories | 30 min | None | Yes |
| 2. Extract TimelineBase | 2-3 hrs | Low | Yes |
| 3. Extract KeyframeMarker | 1 hr | Low | Yes |
| 4. Extract ExportProgress | 1 hr | Low | Yes |
| 5. Extract videoMetadata | 30 min | None | Yes |
| 6. VideoPlayer overlay prop | 1 hr | Low | Yes |
| 7. Add index re-exports | 30 min | None | Yes |

**Total Prep Time: ~7-8 hours**

**After Prep Completion:**
- App works exactly the same
- Shared components exist and are tested
- Directory structure is ready
- Mode implementation becomes assembly, not extraction

---

### Why This Approach Works

**Before Prep:**
```
Mode switching requires:
- Extracting TimelineBase (risky refactor)
- Extracting ExportProgress (risky refactor)
- Moving files (breaks imports)
- Adding mode state (new feature)
- All at once = high risk
```

**After Prep:**
```
Mode switching requires:
- Import existing TimelineBase ✓
- Import existing ExportProgress ✓
- Move files to prepared directories ✓
- Add mode state (isolated change)
- One thing at a time = low risk
```

---

## 1. State Management for Each Phase

### 1.1 Current Architecture (Reference)

The app currently uses a layered state management pattern:

```
Layer 1: Pure State Machine (keyframeController.js)
Layer 2: React Hook Wrapper (useKeyframeController.js)
Layer 3: Feature Hooks (useCrop.js, useHighlight.js, useSegments.js)
Layer 4: Context Providers (CropContext.jsx, HighlightContext.jsx)
Layer 5: App.jsx (orchestration)
```

### 1.2 New Mode State

**File: `src/frontend/src/App.jsx`**

Add top-level mode state:

```javascript
// NEW: Editor mode state
const [editorMode, setEditorMode] = useState('framing'); // 'framing' | 'overlay'

// NEW: Overlay video state (COMPLETELY SEPARATE from framing video)
// This is NEVER the original uploaded video - always either:
// 1. Rendered output from Framing phase
// 2. Fresh upload specifically for Overlay mode
const [overlayVideoFile, setOverlayVideoFile] = useState(null);
const [overlayVideoUrl, setOverlayVideoUrl] = useState(null);
const [overlayVideoMetadata, setOverlayVideoMetadata] = useState(null);
```

### 1.3 Video Source Rules (CRITICAL)

**Overlay mode NEVER uses the original Framing source video.**

| Scenario | Overlay Video Source |
|----------|---------------------|
| User completes Framing → "Proceed to Overlay" | Rendered video from `/api/export/frame-only` |
| User uploads video directly to Overlay mode | Fresh upload (new file) |
| User in Framing with no edits → clicks Overlay | **BLOCKED** - must either make edits OR upload new video for Overlay |

```javascript
// WRONG - Never do this:
const proceedToOverlay = () => {
  setOverlayVideoFile(videoFile);  // ❌ Passing through original
  setEditorMode('overlay');
};

// CORRECT - Always require explicit source:
const proceedToOverlay = async () => {
  // Option A: Render framing edits
  const renderedBlob = await renderFramingOnly({...});
  setOverlayVideoFile(renderedBlob);
  setEditorMode('overlay');
};

const uploadForOverlay = (file) => {
  // Option B: Fresh upload for overlay
  setOverlayVideoFile(file);
  setEditorMode('overlay');
};
```

### 1.4 State Isolation Strategy

**Framing Mode State** (existing, no changes):
- `videoFile`, `videoUrl`, `metadata` - Source video for framing
- `useCrop()` - Crop keyframes
- `useSegments()` - Trim, speed, segment boundaries
- `useZoom()` - Video preview zoom/pan

**Overlay Mode State** (completely separate):
- `overlayVideoFile`, `overlayVideoUrl`, `overlayVideoMetadata` - Overlay source
- `useHighlight()` - Already exists, move exclusively to Overlay mode
- Future: `useBallGlow()`, `useTextOverlay()`, `useScanVisualization()`, etc.

---

## 2. Transition Logic and Edge Cases

### 2.1 Mode Transition Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRAMING MODE                              │
│                             │                                    │
│              ┌──────────────┴──────────────┐                    │
│              ▼                             ▼                    │
│     ┌─────────────────┐           ┌─────────────────┐          │
│     │ Make crop/trim/ │           │ No edits made   │          │
│     │ speed edits     │           │                 │          │
│     └────────┬────────┘           └────────┬────────┘          │
│              │                             │                    │
│              ▼                             ▼                    │
│     ┌─────────────────┐           ┌─────────────────┐          │
│     │ "Proceed to     │           │ Overlay tab     │          │
│     │  Overlay"       │           │ shows:          │          │
│     │ (renders video) │           │ "Upload video   │          │
│     └────────┬────────┘           │  for overlay"   │          │
│              │                    └────────┬────────┘          │
│              │                             │                    │
└──────────────┼─────────────────────────────┼────────────────────┘
               │                             │
               ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        OVERLAY MODE                              │
│                                                                  │
│  Video source is ALWAYS one of:                                 │
│  • Rendered output from Framing (via /api/export/frame-only)    │
│  • Fresh upload specifically for Overlay                        │
│                                                                  │
│  NEVER: Original framing source passed through                  │
│                                                                  │
│         ┌─────────────────┐                                     │
│         │ Add highlight/  │                                     │
│         │ overlays        │                                     │
│         └────────┬────────┘                                     │
│                  │                                              │
│                  ▼                                              │
│         ┌─────────────────┐                                     │
│         │ "Export Final"  │                                     │
│         │ (with AI +      │                                     │
│         │  overlays)      │                                     │
│         └─────────────────┘                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Transition Functions

**File: `src/frontend/src/App.jsx`**

```javascript
/**
 * Transition from Framing to Overlay mode
 * REQUIRES rendering - never passes through original video
 */
const proceedToOverlay = async () => {
  // Must have framing edits to proceed
  if (!hasFramingWork) {
    setError('Add crop or trim edits before proceeding, or upload a video directly to Overlay mode.');
    return;
  }

  setIsRenderingForOverlay(true);

  try {
    // Render framing edits (crop/trim/speed) WITHOUT AI upscaling
    const renderedBlob = await renderFramingOnly({
      videoFile,
      cropKeyframes: getKeyframesForExport(),
      segmentData: getSegmentExportData(),
    });

    const url = URL.createObjectURL(renderedBlob);
    setOverlayVideoFile(renderedBlob);
    setOverlayVideoUrl(url);

    // Extract metadata from rendered video
    const meta = await extractVideoMetadata(renderedBlob);
    setOverlayVideoMetadata(meta);

    setEditorMode('overlay');
    resetHighlight(); // Fresh start for overlay keyframes
  } catch (err) {
    setError('Failed to render framing. Please try again.');
  } finally {
    setIsRenderingForOverlay(false);
  }
};

/**
 * Upload video directly to Overlay mode
 * Bypasses framing entirely with fresh video
 */
const uploadForOverlay = async (file) => {
  const url = URL.createObjectURL(file);
  setOverlayVideoFile(file);
  setOverlayVideoUrl(url);

  const meta = await extractVideoMetadata(file);
  setOverlayVideoMetadata(meta);

  setEditorMode('overlay');
  resetHighlight();
};

/**
 * Return to Framing mode from Overlay
 * WARNING: This discards overlay work
 */
const returnToFraming = () => {
  // Cleanup overlay state
  if (overlayVideoUrl) {
    URL.revokeObjectURL(overlayVideoUrl);
  }
  setOverlayVideoFile(null);
  setOverlayVideoUrl(null);
  setOverlayVideoMetadata(null);
  resetHighlight();

  setEditorMode('framing');
};
```

### 2.3 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| User clicks Overlay tab with framing edits | Render framing → switch to Overlay |
| User clicks Overlay tab with NO edits | Show "Upload for Overlay" prompt (don't pass through original) |
| User wants to skip framing entirely | Upload button in Overlay mode for fresh video |
| User returns to Framing from Overlay | Warn: "Return to Framing? Overlay edits will be lost." |
| Render fails during transition | Show error, stay in Framing mode |
| User uploads new video while in Overlay mode | Replace overlay video, reset overlay keyframes |
| Browser refresh | All state lost (stateless design) |

### 2.4 Backend Endpoint for Framing-Only Render

**File: `src/backend/app/main.py`**

Add new endpoint for fast render without AI:

```python
@app.post("/api/export/frame-only")
async def export_framing_only(
    video: UploadFile = File(...),
    keyframes_json: str = Form(...),
    segment_data_json: str = Form(None),
    export_id: str = Form(...),
):
    """
    Fast export that applies crop/trim/speed WITHOUT AI upscaling.
    Used as intermediate step before Overlay mode.

    Returns: Video blob with framing applied (no quality enhancement)
    """
    # Reuse existing frame extraction logic
    # Skip AI upscaling step
    # Apply crop, trim, speed only
    # Return H.264 encoded video at source resolution
```

---

## 3. DRY Timeline Architecture

### 3.1 Problem: Current Timeline is Monolithic

The current `Timeline.jsx` (540 lines) contains:
- Playhead/scrubber logic
- Layer label rendering
- All layer components inline
- Mode-agnostic but tightly coupled

### 3.2 Solution: Extract Shared Base Components

Create a shared foundation that both modes use:

```
src/frontend/src/components/
├── timeline/                          # NEW: Timeline module
│   ├── TimelineBase.jsx               # Shared: playhead, scrubber, zoom
│   ├── TimelineTrack.jsx              # Shared: generic track container
│   ├── PlayheadTrack.jsx              # Shared: video progress bar
│   ├── KeyframeMarker.jsx             # Shared: diamond/circle markers
│   ├── LayerLabel.jsx                 # Shared: left-side layer icons
│   └── index.js                       # Re-exports
```

### 3.3 TimelineBase Component (Shared)

**File: `src/frontend/src/components/timeline/TimelineBase.jsx`**

```jsx
/**
 * Shared timeline foundation used by both Framing and Overlay modes.
 * Handles: playhead, scrubbing, time display, zoom, scroll sync.
 * Does NOT handle: mode-specific layers (passed as children).
 */
export function TimelineBase({
  // Time/duration
  currentTime,
  duration,
  visualDuration,
  onSeek,

  // Zoom/scroll
  timelineZoom,
  timelineScale,
  onTimelineZoomByWheel,
  timelineScrollPosition,
  onTimelineScrollPositionChange,

  // Conversion functions
  sourceTimeToVisualTime,
  visualTimeToSourceTime,

  // Mode-specific layers passed as children
  children,

  // Layer labels (rendered in fixed left column)
  layerLabels,
}) {
  const timelineRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState(null);

  // ... shared scrubbing/zoom logic (extracted from current Timeline.jsx)

  return (
    <div className="timeline-container py-4">
      {/* Time labels */}
      <TimeDisplay
        currentTime={sourceTimeToVisualTime(currentTime)}
        duration={visualDuration || duration}
        zoom={timelineZoom}
      />

      <div className="relative">
        {/* Fixed layer labels on the left */}
        <div className="absolute left-0 top-0 w-32 z-10">
          {layerLabels}
        </div>

        {/* Scrollable timeline tracks container */}
        <div ref={scrollContainerRef} className="ml-32 overflow-x-auto">
          <div style={{ width: timelineScale > 1 ? `${timelineScale * 100}%` : '100%' }}>
            {/* Playhead track (always present) */}
            <PlayheadTrack
              ref={timelineRef}
              progress={progress}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              hoverTime={hoverTime}
            />

            {/* Unified playhead line */}
            <Playhead progress={progress} height={totalHeight} />

            {/* Mode-specific layers (passed as children) */}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 3.4 KeyframeMarker Component (Shared)

**File: `src/frontend/src/components/timeline/KeyframeMarker.jsx`**

Both CropLayer and HighlightLayer use similar keyframe markers. Extract:

```jsx
/**
 * Reusable keyframe marker for timeline layers.
 * Used by CropLayer (diamond), HighlightLayer (circle), and future layers.
 */
export function KeyframeMarker({
  position,           // 0-100 percentage
  shape = 'diamond',  // 'diamond' | 'circle' | 'square'
  color = 'yellow',   // Tailwind color name
  isSelected = false,
  isPermanent = false,
  onClick,
  onDelete,
  onCopy,
  tooltip,
}) {
  const shapes = {
    diamond: 'rotate-45 w-3 h-3',
    circle: 'rounded-full w-3 h-3',
    square: 'w-3 h-3',
  };

  return (
    <div
      className={`absolute transform -translate-x-1/2 cursor-pointer
        ${shapes[shape]}
        ${isSelected ? `bg-${color}-300 ring-2 ring-white` : `bg-${color}-500`}
        ${isPermanent ? 'opacity-50' : 'opacity-100'}
      `}
      style={{ left: `${position}%` }}
      onClick={onClick}
      title={tooltip}
    >
      {/* Context menu for delete/copy */}
    </div>
  );
}
```

### 3.5 Mode-Specific Timeline Wrappers

**File: `src/frontend/src/modes/framing/FramingTimeline.jsx`**

```jsx
import { TimelineBase, LayerLabel, KeyframeMarker } from '../components/timeline';
import CropLayer from './layers/CropLayer';
import SegmentLayer from './layers/SegmentLayer';

/**
 * Framing mode timeline - shows crop and segment layers.
 * Uses shared TimelineBase for playhead/scrubbing.
 */
export function FramingTimeline({
  // ... framing-specific props
}) {
  const layerLabels = (
    <>
      <LayerLabel icon={Film} label="Video" isSelected={selectedLayer === 'playhead'} />
      <LayerLabel icon={Crop} label="Crop" isSelected={selectedLayer === 'crop'} />
      <LayerLabel icon={Split} label="Segments" />
    </>
  );

  return (
    <TimelineBase
      currentTime={currentTime}
      duration={duration}
      // ... shared props
      layerLabels={layerLabels}
    >
      <CropLayer ... />
      <SegmentLayer ... />
    </TimelineBase>
  );
}
```

**File: `src/frontend/src/modes/overlay/OverlayTimeline.jsx`**

```jsx
import { TimelineBase, LayerLabel, KeyframeMarker } from '../components/timeline';
import HighlightLayer from './layers/HighlightLayer';

/**
 * Overlay mode timeline - shows highlight and future overlay layers.
 * Uses shared TimelineBase for playhead/scrubbing.
 */
export function OverlayTimeline({
  // ... overlay-specific props
}) {
  const layerLabels = (
    <>
      <LayerLabel icon={Film} label="Video" isSelected={selectedLayer === 'playhead'} />
      <LayerLabel icon={Circle} label="Highlight" isSelected={selectedLayer === 'highlight'} />
      {/* Future: BallGlow, Text, etc. */}
    </>
  );

  return (
    <TimelineBase
      currentTime={currentTime}
      duration={duration}
      // ... shared props
      layerLabels={layerLabels}
    >
      <HighlightLayer ... />
      {/* Future overlay layers */}
    </TimelineBase>
  );
}
```

---

## 4. DRY Opportunities Beyond Timeline

### 4.1 Shared Hooks Pattern

Both modes use keyframe-based editing. The existing `useKeyframeController.js` is already shared.

**Current shared hooks (no changes needed):**
- `useKeyframeController.js` - State machine for keyframes
- `useVideo.js` - Video playback (used by both modes with different video sources)
- `useZoom.js` - Preview zoom/pan
- `useTimelineZoom.js` - Timeline zoom

**Extract from current hooks:**

| Current Location | Extract To | Used By |
|-----------------|------------|---------|
| `useCrop.js` interpolation | `useKeyframeController.js` | Already done |
| `useHighlight.js` interpolation | `useKeyframeController.js` | Already done |
| Video metadata extraction | `utils/videoMetadata.js` | Both modes |

### 4.2 Shared UI Components

**Already shared (no changes):**
- `Controls.jsx` - Playback controls (play/pause/step)
- `ThreePositionToggle.jsx` - Multi-state toggle
- `ZoomControls.jsx` - Zoom in/out buttons

**Extract to shared:**

| Current Location | Extract To | Reason |
|-----------------|------------|--------|
| `VideoPlayer.jsx` video element | `components/shared/VideoElement.jsx` | Both modes need video display |
| Overlay base (drag/resize) | `components/shared/DraggableOverlay.jsx` | CropOverlay & HighlightOverlay share logic |
| Export progress UI | `components/shared/ExportProgress.jsx` | Both modes export |

### 4.3 Shared Utilities

**File: `src/frontend/src/utils/videoMetadata.js`** (NEW)

```javascript
/**
 * Extract metadata from video file or blob
 * Used by both Framing (original upload) and Overlay (rendered/uploaded)
 */
export async function extractVideoMetadata(videoSource) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        // ... framerate detection
      });
      URL.revokeObjectURL(video.src);
    };

    video.onerror = reject;
    video.src = URL.createObjectURL(videoSource);
  });
}
```

---

## 5. File Organization by Mode

### 5.1 Current Structure (Flat)

```
src/frontend/src/
├── components/
│   ├── VideoPlayer.jsx
│   ├── Timeline.jsx
│   ├── CropLayer.jsx
│   ├── CropOverlay.jsx
│   ├── HighlightLayer.jsx
│   ├── HighlightOverlay.jsx
│   ├── SegmentLayer.jsx
│   ├── ExportButton.jsx
│   └── ... (20+ files, mixed concerns)
├── hooks/
│   ├── useCrop.js
│   ├── useHighlight.js
│   ├── useSegments.js
│   └── ...
└── contexts/
    ├── CropContext.jsx
    └── HighlightContext.jsx
```

### 5.2 New Structure (Organized by Mode)

```
src/frontend/src/
├── App.jsx                              # Orchestrates modes
├── modes/                               # NEW: Mode-specific code
│   ├── framing/                         # Framing mode
│   │   ├── index.js                     # Exports FramingMode component
│   │   ├── FramingMode.jsx              # Framing mode container
│   │   ├── FramingTimeline.jsx          # Framing timeline wrapper
│   │   ├── FramingControls.jsx          # AspectRatio, etc.
│   │   ├── FramingExport.jsx            # "Proceed to Overlay" + "Export Framed"
│   │   ├── hooks/
│   │   │   ├── useCrop.js               # Moved from /hooks
│   │   │   └── useSegments.js           # Moved from /hooks
│   │   ├── layers/
│   │   │   ├── CropLayer.jsx            # Moved from /components
│   │   │   └── SegmentLayer.jsx         # Moved from /components
│   │   ├── overlays/
│   │   │   └── CropOverlay.jsx          # Moved from /components
│   │   └── contexts/
│   │       └── CropContext.jsx          # Moved from /contexts
│   │
│   └── overlay/                         # Overlay mode
│       ├── index.js                     # Exports OverlayMode component
│       ├── OverlayMode.jsx              # Overlay mode container
│       ├── OverlayTimeline.jsx          # Overlay timeline wrapper
│       ├── OverlayControls.jsx          # Effect selectors, etc.
│       ├── OverlayExport.jsx            # "Export Final Video"
│       ├── hooks/
│       │   ├── useHighlight.js          # Moved from /hooks
│       │   └── useBallGlow.js           # Future
│       ├── layers/
│       │   ├── HighlightLayer.jsx       # Moved from /components
│       │   └── BallGlowLayer.jsx        # Future
│       ├── overlays/
│       │   ├── HighlightOverlay.jsx     # Moved from /components
│       │   └── BallGlowOverlay.jsx      # Future
│       └── contexts/
│           └── HighlightContext.jsx     # Moved from /contexts
│
├── components/                          # SHARED components only
│   ├── shared/                          # Truly shared UI
│   │   ├── FileUpload.jsx
│   │   ├── Controls.jsx                 # Playback controls
│   │   ├── VideoElement.jsx             # Base video display
│   │   ├── ModeSwitcher.jsx             # Mode toggle
│   │   ├── ExportProgress.jsx           # Progress bar/status
│   │   └── DraggableOverlay.jsx         # Base for overlays
│   ├── timeline/                        # Shared timeline foundation
│   │   ├── TimelineBase.jsx
│   │   ├── PlayheadTrack.jsx
│   │   ├── KeyframeMarker.jsx
│   │   ├── LayerLabel.jsx
│   │   └── index.js
│   └── VideoPlayer.jsx                  # Composes VideoElement + mode overlays
│
├── hooks/                               # SHARED hooks only
│   ├── useKeyframeController.js         # Shared keyframe state machine
│   ├── useVideo.js                      # Shared video playback
│   ├── useZoom.js                       # Shared preview zoom
│   └── useTimelineZoom.js               # Shared timeline zoom
│
└── utils/                               # SHARED utilities
    ├── splineInterpolation.js           # Keyframe interpolation
    ├── keyframeUtils.js                 # Keyframe search
    ├── timeFormat.js                    # Time formatting
    ├── videoUtils.js                    # Frame/time conversion
    └── videoMetadata.js                 # NEW: Metadata extraction
```

### 5.3 Benefits of Mode-Based Organization

| Benefit | Description |
|---------|-------------|
| **Focused development** | Working on Overlay? Only look at `modes/overlay/` |
| **Clear boundaries** | No accidental coupling between modes |
| **Easy to add modes** | Copy `modes/overlay/` structure for new mode |
| **Shared code is explicit** | If it's in `/components/shared/` or `/hooks/`, it's shared |
| **Deletable** | Could delete entire mode folder if needed |

### 5.4 Import Patterns After Reorganization

**From App.jsx:**
```javascript
// Mode containers
import { FramingMode } from './modes/framing';
import { OverlayMode } from './modes/overlay';

// Shared components
import { ModeSwitcher, FileUpload, Controls } from './components/shared';
import { VideoPlayer } from './components/VideoPlayer';
```

**From FramingMode.jsx:**
```javascript
// Framing-specific (local imports)
import { useCrop } from './hooks/useCrop';
import { useSegments } from './hooks/useSegments';
import { CropLayer } from './layers/CropLayer';
import { FramingTimeline } from './FramingTimeline';

// Shared (explicit cross-boundary imports)
import { TimelineBase } from '../../components/timeline';
import { useKeyframeController } from '../../hooks/useKeyframeController';
```

---

## 6. Overlay Effect Data Model

### 6.1 Current Highlight Data Model

**File: `src/frontend/src/modes/overlay/hooks/useHighlight.js`** (after move)

```javascript
// Keyframe structure (unchanged)
{
  frame: number,           // Frame number (unique key)
  origin: 'permanent' | 'user' | 'trim',
  x: number,               // Center X position (pixels)
  y: number,               // Center Y position (pixels)
  radiusX: number,         // Horizontal radius
  radiusY: number,         // Vertical radius
  opacity: number,         // 0-1 transparency
  color: string            // Hex color (default #FFFF00)
}
```

### 6.2 Generalized Overlay Data Model

For future overlays, establish a consistent pattern:

```javascript
// Base overlay keyframe structure
{
  frame: number,
  origin: 'permanent' | 'user' | 'trim',
  type: 'highlight' | 'ball_glow' | 'text' | 'x_marker' | 'scan_viz',
  enabled: boolean,
  // Type-specific properties...
}

// Highlight overlay
{
  ...base,
  type: 'highlight',
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  opacity: number,
  color: string,
  effectType: 'brightness_boost' | 'original' | 'dark_overlay'
}

// Ball glow overlay (future)
{
  ...base,
  type: 'ball_glow',
  x: number,
  y: number,
  radius: number,
  intensity: number,
  color: string
}

// Text overlay (future)
{
  ...base,
  type: 'text',
  x: number,
  y: number,
  text: string,
  fontSize: number,
  fontFamily: string,
  color: string,
  backgroundColor: string | null
}
```

---

## 7. Export Pipeline Details

### 7.1 New Two-Phase Export Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRAMING MODE                                  │
│                                                                  │
│  "Proceed to Overlay"                "Export Framed Only"       │
│         │                                    │                   │
│         ▼                                    ▼                   │
│  POST /api/export/frame-only         POST /api/export/upscale   │
│  (no AI, fast render)                (with AI, final quality)   │
│         │                                    │                   │
│         ▼                                    ▼                   │
│  overlayVideoBlob                      Download                  │
│  (stays in browser)                    (user's video)            │
│         │                                                        │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OVERLAY MODE                                  │
│                                                                  │
│  Video source is ALWAYS one of:                                 │
│  • Rendered output from Framing (via /api/export/frame-only)    │
│  • Fresh upload specifically for Overlay                        │
│                                                                  │
│  NEVER: Original framing source passed through                  │
│                                                                  │
│         ┌─────────────────┐                                     │
│         │ "Export Final"  │                                     │
│         └────────┬────────┘                                     │
│                  │                                              │
│                  ▼                                              │
│         POST /api/export/upscale                                │
│         - video: overlayVideoBlob                               │
│         - cropKeyframes: [] (empty - already applied or N/A)    │
│         - highlightKeyframes: [...]                             │
│         - segmentData: null (already applied or N/A)            │
│                  │                                              │
│                  ▼                                              │
│         AI upscale + overlay effects                            │
│                  │                                              │
│                  ▼                                              │
│         Download final video                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Mode-Specific Export Components

**File: `src/frontend/src/modes/framing/FramingExport.jsx`**

```jsx
/**
 * Framing mode export options:
 * 1. Proceed to Overlay (renders, keeps in browser)
 * 2. Export Framed Only (renders with AI, downloads)
 */
export function FramingExport({
  videoFile,
  cropKeyframes,
  segmentData,
  onProceedToOverlay,
  hasFramingWork,
}) {
  return (
    <div className="space-y-3">
      {/* Primary action */}
      <button
        onClick={onProceedToOverlay}
        disabled={!hasFramingWork}
        className="w-full bg-purple-600 hover:bg-purple-700 ..."
      >
        Proceed to Overlay →
      </button>

      {!hasFramingWork && (
        <p className="text-sm text-gray-400">
          Add crop or trim edits to proceed, or upload directly to Overlay mode.
        </p>
      )}

      {/* Secondary action */}
      <button onClick={handleExportFramedOnly} className="w-full ...">
        Export Framed Video (skip overlays)
      </button>
    </div>
  );
}
```

**File: `src/frontend/src/modes/overlay/OverlayExport.jsx`**

```jsx
/**
 * Overlay mode export:
 * - Export Final Video (AI upscale + all overlays)
 */
export function OverlayExport({
  videoFile,        // This is overlayVideoFile, NOT original
  highlightKeyframes,
  highlightEffectType,
}) {
  return (
    <div className="space-y-3">
      {/* Export settings */}
      <ExportSettings ... />

      {/* Single export action */}
      <button onClick={handleExportFinal} className="w-full bg-blue-600 ...">
        Export Final Video
      </button>
    </div>
  );
}
```

---

## 8. Component Hierarchy (Final)

### 8.1 App.jsx (Simplified Orchestrator)

```jsx
function App() {
  const [editorMode, setEditorMode] = useState('framing');

  // Framing mode state
  const [videoFile, setVideoFile] = useState(null);
  // ... framing hooks

  // Overlay mode state (completely separate)
  const [overlayVideoFile, setOverlayVideoFile] = useState(null);
  // ... overlay hooks

  return (
    <div className="min-h-screen ...">
      <Header>
        <ModeSwitcher mode={editorMode} ... />
        <FileUpload
          onUpload={editorMode === 'framing' ? handleFramingUpload : handleOverlayUpload}
        />
      </Header>

      {editorMode === 'framing' ? (
        <FramingMode
          videoFile={videoFile}
          onProceedToOverlay={proceedToOverlay}
          // ... framing props
        />
      ) : (
        <OverlayMode
          videoFile={overlayVideoFile}
          onReturnToFraming={returnToFraming}
          // ... overlay props
        />
      )}

      {/* Shared playback controls */}
      <Controls ... />
    </div>
  );
}
```

### 8.2 FramingMode Component

**File: `src/frontend/src/modes/framing/FramingMode.jsx`**

```jsx
export function FramingMode({
  videoFile,
  videoUrl,
  metadata,
  onProceedToOverlay,
}) {
  // Framing-specific hooks
  const crop = useCrop(metadata);
  const segments = useSegments();
  const zoom = useZoom();

  return (
    <CropProvider value={crop}>
      <VideoPlayer
        videoUrl={videoUrl}
        overlay={<CropOverlay ... />}
        zoom={zoom}
      />

      <FramingTimeline
        cropKeyframes={crop.keyframes}
        segments={segments.segments}
        // ...
      />

      <FramingControls>
        <AspectRatioSelector ... />
        <ZoomControls ... />
      </FramingControls>

      <FramingExport
        onProceedToOverlay={onProceedToOverlay}
        hasFramingWork={crop.keyframes.length > 2 || segments.segments.length > 1}
        // ...
      />
    </CropProvider>
  );
}
```

### 8.3 OverlayMode Component

**File: `src/frontend/src/modes/overlay/OverlayMode.jsx`**

```jsx
export function OverlayMode({
  videoFile,    // This is overlayVideoFile, NOT the original
  videoUrl,
  metadata,
  onReturnToFraming,
}) {
  // Overlay-specific hooks
  const highlight = useHighlight(metadata);
  // Future: const ballGlow = useBallGlow(metadata);

  return (
    <HighlightProvider value={highlight}>
      <VideoPlayer
        videoUrl={videoUrl}
        overlay={<HighlightOverlay ... />}
      />

      <OverlayTimeline
        highlightKeyframes={highlight.keyframes}
        // Future: ballGlowKeyframes={ballGlow.keyframes}
        // ...
      />

      <OverlayControls>
        <HighlightEffectSelector ... />
        {/* Future: BallGlow controls, Text controls, etc. */}
      </OverlayControls>

      <OverlayExport
        videoFile={videoFile}
        highlightKeyframes={highlight.getKeyframesForExport()}
        // ...
      />
    </HighlightProvider>
  );
}
```

---

## 9. Implementation Phases (After Prep Refactor)

**Prerequisite:** Complete all Prep Refactor steps first. This dramatically reduces risk.

### Phase 1: Move Files to Mode Directories (2-3 hours)

**Goal:** Move mode-specific files to their new homes. Only import paths change.

**Framing mode files to move:**
```
hooks/useCrop.js           → modes/framing/hooks/useCrop.js
hooks/useSegments.js       → modes/framing/hooks/useSegments.js
components/CropLayer.jsx   → modes/framing/layers/CropLayer.jsx
components/SegmentLayer.jsx→ modes/framing/layers/SegmentLayer.jsx
components/CropOverlay.jsx → modes/framing/overlays/CropOverlay.jsx
contexts/CropContext.jsx   → modes/framing/contexts/CropContext.jsx
```

**Overlay mode files to move:**
```
hooks/useHighlight.js           → modes/overlay/hooks/useHighlight.js
components/HighlightLayer.jsx   → modes/overlay/layers/HighlightLayer.jsx
components/HighlightOverlay.jsx → modes/overlay/overlays/HighlightOverlay.jsx
contexts/HighlightContext.jsx   → modes/overlay/contexts/HighlightContext.jsx
```

**Update imports in:**
- `App.jsx`
- `Timeline.jsx` (temporary - will be replaced)
- `VideoPlayer.jsx`
- Any other files that import moved files

**Verification:** App works identically after all moves.

**Risk:** Low (mechanical, easy to verify)

---

### Phase 2: Create Mode Container Components (2-3 hours)

**Goal:** Create FramingMode.jsx and OverlayMode.jsx that encapsulate mode-specific logic.

**File: `modes/framing/FramingMode.jsx`**
- Import useCrop, useSegments from local hooks
- Import CropLayer, SegmentLayer from local layers
- Import CropOverlay from local overlays
- Wrap with CropProvider
- Render FramingTimeline (uses TimelineBase)

**File: `modes/overlay/OverlayMode.jsx`**
- Import useHighlight from local hooks
- Import HighlightLayer from local layers
- Import HighlightOverlay from local overlays
- Wrap with HighlightProvider
- Render OverlayTimeline (uses TimelineBase)

**File: `modes/framing/FramingTimeline.jsx`**
```jsx
// Thin wrapper using TimelineBase
import { TimelineBase } from '../../components/timeline';
import CropLayer from './layers/CropLayer';
import SegmentLayer from './layers/SegmentLayer';

export function FramingTimeline(props) {
  return (
    <TimelineBase {...baseProps}>
      <CropLayer {...cropProps} />
      <SegmentLayer {...segmentProps} />
    </TimelineBase>
  );
}
```

**File: `modes/overlay/OverlayTimeline.jsx`**
```jsx
// Thin wrapper using TimelineBase
import { TimelineBase } from '../../components/timeline';
import HighlightLayer from './layers/HighlightLayer';

export function OverlayTimeline(props) {
  return (
    <TimelineBase {...baseProps}>
      <HighlightLayer {...highlightProps} />
    </TimelineBase>
  );
}
```

**Verification:**
- Can render FramingMode in App.jsx and app works
- Can render OverlayMode in App.jsx and highlight works

**Risk:** Low (composition of existing pieces)

---

### Phase 3: Add Mode State and Switcher (2-3 hours)

**Goal:** Add mode toggle UI and conditional rendering in App.jsx.

**Create: `components/shared/ModeSwitcher.jsx`**
- Two-tab toggle: Framing | Overlay
- Visual indication of current mode
- Disabled states when appropriate

**Update: `App.jsx`**
```jsx
const [editorMode, setEditorMode] = useState('framing');

// Separate state for overlay video (NOT the framing video)
const [overlayVideoFile, setOverlayVideoFile] = useState(null);
const [overlayVideoUrl, setOverlayVideoUrl] = useState(null);
const [overlayVideoMetadata, setOverlayVideoMetadata] = useState(null);

return (
  <>
    <ModeSwitcher mode={editorMode} onChange={setEditorMode} />

    {editorMode === 'framing' ? (
      <FramingMode ... />
    ) : (
      <OverlayMode videoFile={overlayVideoFile} ... />
    )}
  </>
);
```

**At this point:** Can toggle between modes, but no transition logic yet. Overlay mode will be empty (no video).

**Verification:**
- Mode toggle switches UI
- Framing mode works as before
- Overlay mode shows empty state

**Risk:** Low (UI only, no complex logic)

---

### Phase 4: Implement Mode Transitions (3-4 hours)

**Goal:** Implement "Proceed to Overlay" with video rendering.

**Backend: Add `/api/export/frame-only` endpoint**
```python
@app.post("/api/export/frame-only")
async def export_framing_only(...):
    # Reuse existing crop/segment logic
    # Skip AI upscaling
    # Return video blob
```

**Frontend: Add transition functions to App.jsx**
```javascript
const proceedToOverlay = async () => {
  // Validate has framing work
  // Call /api/export/frame-only
  // Set overlayVideoFile/Url/Metadata
  // Switch to overlay mode
};

const uploadForOverlay = async (file) => {
  // Set overlayVideoFile directly
  // Extract metadata
  // Switch to overlay mode
};

const returnToFraming = () => {
  // Clear overlay state
  // Switch to framing mode
};
```

**Update ModeSwitcher:**
- "Proceed to Overlay" button (triggers render)
- "Upload for Overlay" option (direct upload)
- Confirmation when returning to framing

**Verification:**
- Framing edits → Proceed → Overlay mode with rendered video
- Direct upload → Overlay mode with uploaded video
- Return to Framing → Overlay state cleared

**Risk:** Medium (new backend endpoint, async transitions)

---

### Phase 5: Mode-Specific Exports (2 hours)

**Goal:** Create separate export UIs for each mode.

**Create: `modes/framing/FramingExport.jsx`**
- "Proceed to Overlay →" button (primary)
- "Export Framed Video" button (secondary, skips overlay)
- Uses shared ExportProgress

**Create: `modes/overlay/OverlayExport.jsx`**
- "Export Final Video" button
- Highlight effect selector
- Audio toggle
- Uses shared ExportProgress

**Delete:** `components/ExportButton.jsx` (replaced by mode-specific exports)

**Verification:**
- Framing export shows two options
- Overlay export shows final export
- Progress displays correctly in both

**Risk:** Low (UI refactor, logic already exists)

---

### Phase 6: Cleanup and Polish (2 hours)

**Goal:** Remove dead code, add edge case handling.

1. Delete old `Timeline.jsx` (replaced by mode-specific timelines)
2. Delete old `ExportButton.jsx` (replaced by mode-specific exports)
3. Add confirmation dialogs for destructive actions
4. Add loading states during render transitions
5. Test mobile layout
6. Update any remaining imports

**Verification:** Full end-to-end test of both workflows.

---

### Implementation Summary

| Phase | Time | Risk | Can Ship After? |
|-------|------|------|-----------------|
| Prep Refactor | 7-8 hrs | None-Low | Yes (no changes) |
| 1. Move files | 2-3 hrs | Low | Yes (no changes) |
| 2. Mode containers | 2-3 hrs | Low | Yes (hidden) |
| 3. Mode switcher | 2-3 hrs | Low | Yes (feature flag) |
| 4. Transitions | 3-4 hrs | Medium | Yes (feature complete) |
| 5. Mode exports | 2 hrs | Low | Yes (polish) |
| 6. Cleanup | 2 hrs | Low | Yes (final) |

**Total: ~20-25 hours** (including prep)

**Compared to "big bang" approach:** ~15-20 hours but HIGH risk

The prep refactor adds ~7 hours but converts a high-risk project into a series of low-risk incremental changes. Each phase is independently deployable and testable.

---

## 10. Summary of All Changes

### New Files

| File | Purpose |
|------|---------|
| `modes/framing/FramingMode.jsx` | Framing mode container |
| `modes/framing/FramingTimeline.jsx` | Framing timeline wrapper |
| `modes/framing/FramingExport.jsx` | Framing export UI |
| `modes/overlay/OverlayMode.jsx` | Overlay mode container |
| `modes/overlay/OverlayTimeline.jsx` | Overlay timeline wrapper |
| `modes/overlay/OverlayExport.jsx` | Overlay export UI |
| `components/timeline/TimelineBase.jsx` | Shared timeline foundation |
| `components/timeline/KeyframeMarker.jsx` | Shared keyframe component |
| `components/timeline/PlayheadTrack.jsx` | Shared playhead component |
| `components/shared/ModeSwitcher.jsx` | Mode toggle |
| `components/shared/ExportProgress.jsx` | Shared export progress |
| `utils/videoMetadata.js` | Shared metadata extraction |
| `main.py` (endpoint) | `/api/export/frame-only` |

### Moved Files (No Logic Changes)

| From | To |
|------|-----|
| `hooks/useCrop.js` | `modes/framing/hooks/useCrop.js` |
| `hooks/useSegments.js` | `modes/framing/hooks/useSegments.js` |
| `hooks/useHighlight.js` | `modes/overlay/hooks/useHighlight.js` |
| `components/CropLayer.jsx` | `modes/framing/layers/CropLayer.jsx` |
| `components/SegmentLayer.jsx` | `modes/framing/layers/SegmentLayer.jsx` |
| `components/CropOverlay.jsx` | `modes/framing/overlays/CropOverlay.jsx` |
| `components/HighlightLayer.jsx` | `modes/overlay/layers/HighlightLayer.jsx` |
| `components/HighlightOverlay.jsx` | `modes/overlay/overlays/HighlightOverlay.jsx` |
| `contexts/CropContext.jsx` | `modes/framing/contexts/CropContext.jsx` |
| `contexts/HighlightContext.jsx` | `modes/overlay/contexts/HighlightContext.jsx` |

### Modified Files

| File | Changes |
|------|---------|
| `App.jsx` | Simplified to orchestrate modes |
| `VideoPlayer.jsx` | Accept overlay as prop instead of hardcoded |
| `Timeline.jsx` | **Deleted** - replaced by mode-specific wrappers |
| `ExportButton.jsx` | **Deleted** - replaced by mode-specific exports |

---

## Appendix A: Quick Reference - What Goes Where

### When Working on Framing Mode

Look in: `src/frontend/src/modes/framing/`

```
modes/framing/
├── FramingMode.jsx      # Start here
├── FramingTimeline.jsx
├── FramingExport.jsx
├── hooks/useCrop.js
├── hooks/useSegments.js
├── layers/CropLayer.jsx
├── layers/SegmentLayer.jsx
├── overlays/CropOverlay.jsx
└── contexts/CropContext.jsx
```

### When Working on Overlay Mode

Look in: `src/frontend/src/modes/overlay/`

```
modes/overlay/
├── OverlayMode.jsx      # Start here
├── OverlayTimeline.jsx
├── OverlayExport.jsx
├── hooks/useHighlight.js
├── layers/HighlightLayer.jsx
├── overlays/HighlightOverlay.jsx
└── contexts/HighlightContext.jsx
```

### When Working on Shared Components

Look in: `src/frontend/src/components/` or `src/frontend/src/hooks/`

```
components/
├── timeline/            # Shared timeline foundation
├── shared/              # Shared UI components
└── VideoPlayer.jsx      # Shared video display

hooks/
├── useKeyframeController.js  # Shared state machine
├── useVideo.js              # Shared playback
├── useZoom.js               # Shared preview zoom
└── useTimelineZoom.js       # Shared timeline zoom
```
