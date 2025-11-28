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

## Implementation Progress

### ✅ Completed Prep Refactors

| Step | Commit | Description | Files Created/Modified |
|------|--------|-------------|------------------------|
| **Prep 1** | `5b5bbe7` | Timeline extraction | `TimelineBase.jsx`, `timeline/index.js`, mode stubs |
| **Prep 3** | `f7024a4` | KeyframeMarker extraction | `KeyframeMarker.jsx`, updated CropLayer & HighlightLayer |
| **Prep 6** | `bff516b` | Export & metadata utilities | `ExportProgress.jsx`, `videoMetadata.js` |

### Current File Structure (After Prep Refactors)

```
src/frontend/src/
├── components/
│   ├── timeline/                    ✅ CREATED
│   │   ├── TimelineBase.jsx         ✅ 359 lines - shared foundation
│   │   ├── KeyframeMarker.jsx       ✅ 113 lines - shared keyframe marker
│   │   └── index.js                 ✅ exports both
│   ├── shared/
│   │   ├── ExportProgress.jsx       ✅ 41 lines - progress UI
│   │   └── index.js                 ✅ re-exports shared components
│   ├── Timeline.jsx                 ✅ REFACTORED to use TimelineBase
│   ├── CropLayer.jsx                ✅ REFACTORED to use KeyframeMarker
│   ├── HighlightLayer.jsx           ✅ REFACTORED to use KeyframeMarker
│   ├── ExportButton.jsx             ✅ SIMPLIFIED, uses ExportProgress
│   └── VideoPlayer.jsx              ✅ SIMPLIFIED
├── modes/
│   ├── framing/
│   │   └── index.js                 ✅ stub (ready for components)
│   └── overlay/
│       └── index.js                 ✅ stub (ready for components)
├── hooks/
│   └── useHighlight.js              ✅ ENHANCED
└── utils/
    └── videoMetadata.js             ✅ 55 lines - metadata extraction
```

### Remaining Work

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1: Move files to mode dirs | 🔲 Pending | Move hooks/layers to `modes/framing/` and `modes/overlay/` |
| Phase 2: Mode containers | 🔲 Pending | Create `FramingMode.jsx`, `OverlayMode.jsx` |
| Phase 3: Mode switcher | 🔲 Pending | Add `ModeSwitcher.jsx`, mode state in App.jsx |
| Phase 4: Transitions | 🔲 Pending | Implement render-based mode transition, backend endpoint |
| Phase 5: Mode exports | 🔲 Pending | Create `FramingExport.jsx`, `OverlayExport.jsx` |
| Phase 6: Cleanup | 🔲 Pending | Remove old files, polish |

---

## Complexity Analysis

### Overall Assessment: **MEDIUM** (reduced from MEDIUM-HIGH)

The prep refactors are complete. Remaining work is primarily assembly of existing building blocks.

### Complexity Breakdown

| Component | Complexity | Risk | Status |
|-----------|------------|------|--------|
| ~~Timeline extraction~~ | ~~Medium~~ | ~~Low~~ | ✅ **DONE** - TimelineBase created |
| ~~Export progress extraction~~ | ~~Low~~ | ~~Low~~ | ✅ **DONE** - ExportProgress created |
| ~~Keyframe marker extraction~~ | ~~Low~~ | ~~Low~~ | ✅ **DONE** - KeyframeMarker created |
| ~~Video metadata utility~~ | ~~Low~~ | ~~Low~~ | ✅ **DONE** - videoMetadata.js created |
| File reorganization | Low | Medium | 🔲 Pending - mechanical imports update |
| Mode state in App.jsx | Medium | Medium | 🔲 Pending |
| Mode transition logic | Medium | Medium | 🔲 Pending |
| Backend endpoint | Low | Low | 🔲 Pending |

### ~~What Makes It Complex~~ Risks Mitigated

1. ~~**Big bang risk**~~ → Building blocks extracted, assembly is incremental
2. ~~**Timeline.jsx is 540 lines**~~ → TimelineBase (359 lines) extracted, Timeline now composes from it
3. ~~**ExportButton.jsx has export logic**~~ → ExportProgress extracted, ExportButton simplified
4. **Many import paths change** - Still applies to Phase 1 file moves

### How to Proceed

**Prep refactors COMPLETE.** Mode switching now becomes:
- ✅ TimelineBase available - mode timelines will compose from it
- ✅ ExportProgress available - mode exports will use it
- ✅ KeyframeMarker available - both CropLayer and HighlightLayer already use it
- ✅ videoMetadata.js available - will be used by overlay mode for rendered video
- 🔲 Create mode containers (FramingMode, OverlayMode)
- 🔲 Add mode state and ModeSwitcher UI

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

## 3. DRY Timeline Architecture ✅ IMPLEMENTED

### 3.1 Problem: ~~Current Timeline is Monolithic~~ SOLVED

~~The current `Timeline.jsx` (540 lines) contains:~~
- ~~Playhead/scrubber logic~~
- ~~Layer label rendering~~
- ~~All layer components inline~~
- ~~Mode-agnostic but tightly coupled~~

**Status:** TimelineBase extracted, Timeline.jsx now composes from shared foundation.

### 3.2 Solution: Extract Shared Base Components ✅ DONE

**Actual structure created:**

```
src/frontend/src/components/
├── timeline/                          ✅ CREATED
│   ├── TimelineBase.jsx               ✅ 359 lines - shared foundation
│   ├── KeyframeMarker.jsx             ✅ 113 lines - shared markers
│   └── index.js                       ✅ re-exports
```

### 3.3 TimelineBase Component ✅ IMPLEMENTED

**File: `src/frontend/src/components/timeline/TimelineBase.jsx`**

Actual implementation signature (359 lines total):

```jsx
/**
 * Shared timeline foundation used by both Framing and Overlay modes.
 * Handles: playhead, scrubbing, time display, zoom, scroll sync.
 * Does NOT handle: mode-specific layers (passed as children).
 */
export function TimelineBase({
  currentTime,
  duration,
  visualDuration,
  onSeek,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  timelineZoom = 100,
  onTimelineZoomByWheel,
  timelineScale = 1,
  timelineScrollPosition = 0,
  onTimelineScrollPositionChange,
  selectedLayer = 'playhead',
  onLayerSelect,
  layerLabels,                    // Mode-specific layer labels
  children,                       // Mode-specific timeline layers
  totalLayerHeight = '9.5rem',
  trimRange = null,
  onDetrimStart,
  onDetrimEnd,
}) { /* ... 359 lines of implementation */ }

// Exports edge padding constant for layer components
export const EDGE_PADDING = 20;
```

**Key features implemented:**
- Unified playhead extending through all layers
- Edge padding (20px) for easier keyframe selection
- Source/visual time conversion for speed changes
- Auto-scroll to keep playhead visible when zoomed
- Trim undo buttons in padding areas
- Mousewheel zoom when playhead layer selected

### 3.4 KeyframeMarker Component ✅ IMPLEMENTED

**File: `src/frontend/src/components/timeline/KeyframeMarker.jsx`**

Actual implementation (113 lines):

```jsx
/**
 * Reusable keyframe marker for timeline layers.
 * Supports different color schemes for each layer type (crop, highlight, etc.)
 * Used by CropLayer (blue/yellow) and HighlightLayer (orange).
 */
export function KeyframeMarker({
  position,              // 0-100 percentage position on timeline
  colorScheme = 'blue',  // 'blue' (crop) | 'orange' (highlight)
  isSelected = false,
  shouldHighlight = false,
  isPermanent = false,
  isStartKeyframe = false,
  isEndKeyframe = false,
  onClick,
  onCopy,
  onDelete,
  tooltip,
  edgePadding = 0,
  showCopyButton = true,
  showDeleteButton = true,
}) { /* ... implementation */ }
```

**Key features:**
- Color schemes: `blue` (crop layer) and `orange` (highlight layer)
- Copy button above keyframe (adjusts position for edge keyframes)
- Delete button below keyframe
- Edge padding support for proper positioning
- Hover states and selection ring

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

| Current Location | Extract To | Status |
|-----------------|------------|--------|
| `useCrop.js` interpolation | `useKeyframeController.js` | ✅ Already done |
| `useHighlight.js` interpolation | `useKeyframeController.js` | ✅ Already done |
| Video metadata extraction | `utils/videoMetadata.js` | ✅ **IMPLEMENTED** |

### 4.2 Shared UI Components

**Already shared (no changes):**
- `Controls.jsx` - Playback controls (play/pause/step)
- `ThreePositionToggle.jsx` - Multi-state toggle
- `ZoomControls.jsx` - Zoom in/out buttons

**Extract to shared:**

| Current Location | Extract To | Status |
|-----------------|------------|--------|
| `VideoPlayer.jsx` video element | `components/shared/VideoElement.jsx` | 🔲 Future (optional) |
| Overlay base (drag/resize) | `components/shared/DraggableOverlay.jsx` | 🔲 Future (optional) |
| Export progress UI | `components/shared/ExportProgress.jsx` | ✅ **IMPLEMENTED** |

### 4.3 Shared Utilities ✅ IMPLEMENTED

**File: `src/frontend/src/utils/videoMetadata.js`**

Actual implementation (55 lines):

```javascript
/**
 * Extract metadata from a video File or Blob.
 * Used by both Framing (original upload) and Overlay (rendered video).
 */
export async function extractVideoMetadata(videoSource) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(videoSource);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    // 10 second timeout
    const timeoutId = setTimeout(() => {
      if (video.readyState === 0) {
        cleanup();
        reject(new Error('Video metadata loading timed out'));
      }
    }, 10000);

    video.onloadedmetadata = () => {
      clearTimeout(timeoutId);
      const metadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        aspectRatio: video.videoWidth / video.videoHeight,
        fileName: videoSource.name || 'rendered_video.mp4',
        size: videoSource.size,
        format: videoSource.type?.split('/')[1] || 'mp4',
      };
      cleanup();
      resolve(metadata);
    };

    video.onerror = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = url;
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

## 9. Implementation Phases

### ✅ Prep Refactor: COMPLETE

All prerequisite prep refactors have been completed:
- **Prep 1** (`5b5bbe7`): TimelineBase extraction, mode directory stubs
- **Prep 3** (`f7024a4`): KeyframeMarker extraction
- **Prep 6** (`bff516b`): ExportProgress, videoMetadata utilities

The building blocks are in place. The remaining phases now have low-to-medium risk.

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

| Phase | Status | Risk | Notes |
|-------|--------|------|-------|
| ~~Prep Refactor~~ | ✅ **DONE** | N/A | TimelineBase, KeyframeMarker, ExportProgress, videoMetadata |
| 1. Move files | 🔲 Pending | Low | Move hooks/layers to mode directories |
| 2. Mode containers | 🔲 Pending | Low | Create FramingMode.jsx, OverlayMode.jsx |
| 3. Mode switcher | 🔲 Pending | Low | ModeSwitcher UI, mode state in App.jsx |
| 4. Transitions | 🔲 Pending | Medium | Backend endpoint, async transition logic |
| 5. Mode exports | 🔲 Pending | Low | FramingExport, OverlayExport components |
| 6. Cleanup | 🔲 Pending | Low | Remove old files, polish |

**Remaining work: ~12-17 hours** (prep refactor complete)

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
