# Codebase Context for App.jsx Reduction

This document provides detailed context about the codebase for AI assistants working on the App.jsx reduction.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite (port 5173) |
| Backend | FastAPI + Python (port 8000) |
| State Management | Zustand stores + React hooks |
| Database | SQLite |
| Video Processing | FFmpeg |

---

## Application Modes

The app has 4 mutually exclusive modes. Only one mode is active at a time.

### 1. Project Manager (`editorMode === 'project-manager'`)
- **When**: No project selected
- **Purpose**: Browse/create projects, browse/load games
- **Key Component**: `ProjectManager.jsx`
- **Current Issue**: Massive `onSelectProject` callbacks embedded in App.jsx

### 2. Annotate Mode (`editorMode === 'annotate'`)
- **When**: User clicks "Annotate Game" or loads a saved game
- **Purpose**: Mark clip regions on full game footage
- **Key Component**: `AnnotateScreen.jsx`, `AnnotateContainer.jsx`
- **Current State**: Already mostly self-contained

### 3. Framing Mode (`editorMode === 'framing'`)
- **When**: Project selected, editing clips
- **Purpose**: Crop, trim, speed adjust, segment clips
- **Key Components**: `FramingScreen.jsx`, `FramingContainer.jsx`, `FramingModeView.jsx`
- **Key Hooks**: `useVideo`, `useCrop`, `useSegments`, `useClipManager`
- **Current Issue**: All hooks called in App.jsx, 50+ props passed down

### 4. Overlay Mode (`editorMode === 'overlay'`)
- **When**: Framing exported, user switches to overlay
- **Purpose**: Add highlight effects to working video
- **Key Components**: `OverlayScreen.jsx`, `OverlayContainer.jsx`, `OverlayModeView.jsx`
- **Key Hooks**: `useOverlayState`, `useHighlight`, `useHighlightRegions`
- **Current Issue**: All hooks called in App.jsx, 60+ props passed down

---

## Key Hooks Reference

### Video Playback
```javascript
// src/frontend/src/hooks/useVideo.js
const {
  videoRef,           // React ref to <video> element
  videoUrl,           // Object URL of loaded video
  metadata,           // { width, height, duration, framerate, aspectRatio }
  isPlaying,          // Boolean
  currentTime,        // Current playback position (seconds)
  duration,           // Video duration (seconds)
  error,              // Error message if any
  isLoading,          // Boolean
  loadVideo,          // (file) => Promise - Load from File object
  loadVideoFromUrl,   // (url, filename) => Promise - Load from URL
  togglePlay,         // () => void
  seek,               // (time) => void
  stepForward,        // () => void - Move 1 frame forward
  stepBackward,       // () => void - Move 1 frame backward
  restart,            // () => void
  handlers,           // Event handlers for <video> element
} = useVideo(getSegmentAtTime, clampToVisibleRange);
```

### Crop State
```javascript
// src/frontend/src/modes/framing/hooks/useCrop.js
const {
  aspectRatio,        // e.g., '9:16', '16:9'
  keyframes,          // Array of { frame, x, y, width, height, origin }
  framerate,          // Frames per second
  updateAspectRatio,  // (ratio) => void
  addOrUpdateKeyframe,// (keyframe) => void
  removeKeyframe,     // (index) => void
  interpolateCrop,    // (time) => { x, y, width, height }
  getCropDataAtTime,  // (time) => crop data
  getKeyframesForExport, // () => Array for backend
  reset,              // () => void
  restoreState,       // (keyframes, endFrame) => void
  // ... more
} = useCrop(metadata, trimRange);
```

### Segments State
```javascript
// src/frontend/src/modes/framing/hooks/useSegments.js
const {
  boundaries,         // Array of segment boundary times
  segments,           // Array of segment objects
  trimRange,          // { start, end } or null
  segmentSpeeds,      // { [segmentIndex]: speedMultiplier }
  initializeWithDuration, // (duration) => void
  addBoundary,        // (time) => void
  removeBoundary,     // (index) => void
  setSegmentSpeed,    // (index, speed) => void
  toggleTrimSegment,  // (index) => void - Trim a segment
  getSegmentAtTime,   // (time) => segment
  clampToVisibleRange,// (time) => time - Clamp to non-trimmed range
  reset,              // () => void
  restoreState,       // (state, duration) => void
  // ... more
} = useSegments();
```

### Highlight Regions
```javascript
// src/frontend/src/modes/overlay/hooks/useHighlightRegions.js
const {
  boundaries,         // Array of region boundary times
  regions,            // Array of highlight region objects
  keyframes,          // Keyframes for all regions
  initializeWithDuration, // (duration) => void
  addRegion,          // (startTime, endTime) => void
  deleteRegionByIndex,// (index) => void
  moveRegionStart,    // (index, newStart) => void
  moveRegionEnd,      // (index, newEnd) => void
  toggleRegionEnabled,// (index) => void
  addOrUpdateKeyframe,// (regionId, keyframe) => void
  getRegionAtTime,    // (time) => region or null
  getRegionsForExport,// () => Array for backend
  reset,              // () => void
  restoreRegions,     // (regionsData, duration) => void
  // ... more
} = useHighlightRegions(metadata);
```

---

## Existing Stores

### editorStore (exists)
```javascript
// src/frontend/src/stores/editorStore.js
const {
  editorMode,         // 'project-manager' | 'annotate' | 'framing' | 'overlay'
  setEditorMode,      // (mode) => void
  modeSwitchDialog,   // { isOpen, targetMode }
  openModeSwitchDialog,
  closeModeSwitchDialog,
  selectedLayer,      // 'playhead' | 'crop' | 'highlight'
  setSelectedLayer,
} = useEditorStore();
```

### exportStore (exists)
```javascript
// src/frontend/src/stores/exportStore.js
const {
  exportingProject,   // { projectId, stage, exportId } or null
  startExport,        // (projectId, stage, exportId) => void
  clearExport,        // () => void
  globalExportProgress, // 0-100
  setGlobalExportProgress,
} = useExportStore();
```

---

## App.jsx Current Structure (2181 lines)

### Lines 1-100: Imports
- React imports
- Component imports (50+)
- Hook imports (15+)
- Store imports

### Lines 100-250: State & Hook Initialization
```javascript
// Editor mode from store
const { editorMode, setEditorMode, ... } = useEditorStore();

// Overlay state hook
const { overlayVideoFile, overlayVideoUrl, ... } = useOverlayState();

// Export state from store
const { exportingProject, startExport, ... } = useExportStore();

// Local state
const [videoFile, setVideoFile] = useState(null);
const [dragCrop, setDragCrop] = useState(null);
const [includeAudio, setIncludeAudio] = useState(true);
// ... 20+ more useState calls
```

### Lines 250-550: Hook Calls
```javascript
// These should move to FramingScreen
const segments = useSegments();
const video = useVideo(getSegmentAtTime, clampToVisibleRange);
const crop = useCrop(metadata, trimRange);

// These should move to OverlayScreen
const highlight = useHighlight(metadata, null);
const highlightRegions = useHighlightRegions(metadata);
```

### Lines 550-750: Container Initializations
```javascript
// OverlayContainer - should move to OverlayScreen
const overlay = OverlayContainer({ /* 50+ props */ });

// FramingContainer - should move to FramingScreen
const framing = FramingContainer({ /* 60+ props */ });
```

### Lines 750-1200: Handler Functions
```javascript
// Should move to respective screens
const handleFileSelect = async (file) => { ... };
const handleSelectClip = useCallback(async (clipId) => { ... });
const handleDeleteClip = useCallback((clipId) => { ... });
const handleProceedToOverlay = async (blob, meta) => { ... };
const handleModeChange = useCallback((newMode) => { ... });
// ... 20+ more handlers
```

### Lines 1200-1500: Effects
```javascript
// Segment initialization - move to FramingScreen
useEffect(() => {
  if (duration > 0) initializeSegments(duration);
}, [duration]);

// Overlay data persistence - move to OverlayScreen
useEffect(() => {
  if (editorMode === 'overlay') saveOverlayData(...);
}, [highlightRegions, effectType]);

// ... 10+ more effects
```

### Lines 1500-1900: Project Manager Render (when no project)
```javascript
if (!selectedProject && editorMode !== 'annotate') {
  return (
    <ProjectManager
      onSelectProject={async (id) => {
        // 150 LINES OF INLINE LOGIC - should be in ProjectsScreen
      }}
      onSelectProjectWithMode={async (id, options) => {
        // 150 MORE LINES - should be in ProjectsScreen
      }}
    />
  );
}
```

### Lines 1900-2181: Main Render
```javascript
return (
  <div>
    {/* Header with mode switcher */}
    {/* Sidebar for framing mode */}
    {editorMode === 'annotate' && <AnnotateScreen /* 15 props */ />}
    {editorMode === 'framing' && <FramingScreen /* 50+ props */ />}
    {editorMode === 'overlay' && <OverlayScreen /* 60+ props */ />}
    {/* Modals */}
  </div>
);
```

---

## Data Flow Between Modes

### Framing → Overlay Transition
1. User clicks "Export" in Framing mode
2. `handleProceedToOverlay(renderedVideoBlob, clipMetadata)` called
3. Creates Object URL from blob
4. Extracts video metadata
5. Sets overlay video state
6. Clears framing changed flag
7. Resets highlight state
8. Switches to overlay mode

### Overlay → Framing (Back)
1. User clicks "Framing" tab
2. If framing changed since export: show confirmation dialog
3. Options: Cancel, Discard Changes, Export First
4. If Discard: restore clips from backend, clear local changes
5. Switch mode

### Project Loading
1. User clicks project in ProjectManager
2. Determine initial mode (overlay if working_video_id exists, else framing)
3. Clear all state
4. Fetch project clips
5. Load first clip video
6. Restore framing state (crop keyframes, segments)
7. If working video exists: load in background

---

## API Endpoints Used by Frontend

### Projects
- `GET /api/projects` - List all
- `POST /api/projects` - Create
- `DELETE /api/projects/{id}` - Delete
- `PATCH /api/projects/{id}/state` - Update mode/timestamps
- `POST /api/projects/{id}/discard-uncommitted` - Revert unsaved

### Clips
- `GET /api/clips/projects/{id}/clips` - List project clips
- `PUT /api/clips/projects/{id}/clips/{clipId}` - Save framing edits
- `GET /api/clips/projects/{id}/clips/{clipId}/file` - Get clip video file

### Export
- `POST /api/export/framing` - Export framing
- `POST /api/export/overlay` - Export overlay
- `PUT /api/export/projects/{id}/overlay-data` - Save overlay data
- `GET /api/export/projects/{id}/overlay-data` - Load overlay data
- `GET /api/projects/{id}/working-video` - Get working video file

### Games
- `GET /api/games` - List all
- `POST /api/games` - Create
- `PUT /api/games/{id}/video` - Upload video
- `DELETE /api/games/{id}` - Delete

---

## Testing Commands

```bash
# Frontend unit tests (Vitest)
cd src/frontend && npm test

# E2E tests (Playwright)
cd src/frontend && npx playwright test

# Specific E2E test
cd src/frontend && npx playwright test "test name"

# Backend tests (pytest)
cd src/backend && pytest tests/ -v

# Line count
wc -l src/frontend/src/App.jsx
```

---

## Common Pitfalls

### 1. State Isolation Issue
When moving hooks to screens, ensure state is truly isolated. If two screens need the same state (e.g., `includeAudio`), use a store.

### 2. Effect Dependencies
Many effects in App.jsx have complex dependencies. When moving, verify all dependencies are available in the new location.

### 3. Circular Dependencies
Container → Screen → Container can cause issues. Containers should be functions, not components.

### 4. Video Element Reuse
The app uses a single `<video>` element with `videoRef`. When switching modes, the video source changes but the element persists. Be careful not to create multiple video elements.

### 5. Object URL Cleanup
When creating Object URLs (`URL.createObjectURL`), always revoke old URLs to prevent memory leaks.

---

## Key Files to Read

Before starting, read these files to understand current patterns:

1. **App.jsx** - The file we're reducing
2. **AnnotateScreen.jsx** - Already mostly self-contained, good reference
3. **FramingContainer.jsx** - Shows container pattern
4. **editorStore.js** - Shows Zustand pattern
5. **useVideo.js** - Core hook used by all modes
