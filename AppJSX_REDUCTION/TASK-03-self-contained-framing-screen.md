# TASK-03: Self-Contained FramingScreen

## Objective
Make FramingScreen fully self-contained by moving all framing-related hooks and state from App.jsx into the screen.

## Current Problem
App.jsx passes 50+ props to FramingScreen:

```jsx
// App.jsx lines 2006-2044
<FramingScreen
  projectId={selectedProjectId}
  project={selectedProject}
  onExportComplete={() => {...}}
  videoRef={videoRef}         // From useVideo in App.jsx
  videoUrl={videoUrl}         // From useVideo in App.jsx
  metadata={metadata}         // From useVideo in App.jsx
  videoFile={videoFile}       // useState in App.jsx
  currentTime={currentTime}   // From useVideo
  duration={duration}         // From useVideo
  isPlaying={isPlaying}       // From useVideo
  isLoading={isLoading}       // From useVideo
  error={error}               // From useVideo
  handlers={handlers}         // From useVideo
  loadVideo={loadVideo}       // From useVideo
  loadVideoFromUrl={loadVideoFromUrl}
  togglePlay={togglePlay}
  seek={seek}
  stepForward={stepForward}
  stepBackward={stepBackward}
  restart={restart}
  setVideoFile={setVideoFile}
  highlightHook={{...}}       // For coordinated trim
  includeAudio={includeAudio}
  onIncludeAudioChange={setIncludeAudio}
  onProceedToOverlay={handleProceedToOverlay}
/>
```

This is massive prop drilling. FramingScreen should own its video state.

## Solution
FramingScreen initializes its own hooks and manages its own state. It only receives:
- Navigation callbacks (or uses store)
- Initial clip data (from store)

---

## Implementation Steps

### Step 1: Update FramingScreen to Own Its Hooks

**File**: `src/frontend/src/screens/FramingScreen.jsx`

```jsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVideo } from '../hooks/useVideo';
import { useClipManager } from '../hooks/useClipManager';
import { useProjectClips } from '../hooks/useProjectClips';
import { useCrop, useSegments } from '../modes/framing';
import { useHighlight, useHighlightRegions } from '../modes/overlay';
import { useZoom } from '../hooks/useZoom';
import { useTimelineZoom } from '../hooks/useTimelineZoom';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { FramingModeView } from '../modes/FramingModeView';
import { FramingContainer } from '../containers/FramingContainer';
import { useNavigationStore, useProjectDataStore } from '../stores';
import { useProject } from '../contexts/ProjectContext';
import { API_BASE } from '../config';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';

export function FramingScreen() {
  // Navigation
  const navigate = useNavigationStore(state => state.navigate);

  // Project context
  const { projectId, project, aspectRatio: projectAspectRatio, refresh: refreshProject } = useProject();

  // Loaded project data from store
  const {
    clips: loadedClips,
    selectedClipIndex,
    setSelectedClipIndex,
    workingVideo,
    setWorkingVideo,
    clipStates,
    setClipState,
  } = useProjectDataStore();

  // Local state
  const [videoFile, setVideoFile] = useState(null);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [dragCrop, setDragCrop] = useState(null);
  const clipHasUserEditsRef = useRef(false);

  // =========================================
  // HOOKS - All owned by this screen
  // =========================================

  // Segments hook (defined early for useVideo)
  const segments = useSegments();
  const {
    boundaries: segmentBoundaries,
    trimRange,
    getSegmentAtTime,
    clampToVisibleRange,
    initializeWithDuration: initializeSegments,
    reset: resetSegments,
    restoreState: restoreSegmentState,
    // ... other segment exports
  } = segments;

  // Video hook - OWNED BY THIS SCREEN
  const {
    videoRef,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    error,
    isLoading,
    loadVideo,
    loadVideoFromUrl,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,
    handlers,
  } = useVideo(getSegmentAtTime, clampToVisibleRange);

  // Crop hook - OWNED BY THIS SCREEN
  const crop = useCrop(metadata, trimRange);
  const {
    keyframes,
    aspectRatio,
    framerate,
    updateAspectRatio,
    reset: resetCrop,
    restoreState: restoreCropState,
    // ... other crop exports
  } = crop;

  // Highlight hooks (for coordinated trim operations)
  const highlight = useHighlight(metadata, null);
  const highlightRegions = useHighlightRegions(metadata);

  // Zoom hooks
  const zoom = useZoom();
  const timelineZoom = useTimelineZoom();

  // Clip manager
  const clipManager = useClipManager();
  const {
    clips,
    selectedClipId,
    selectedClip,
    hasClips,
    selectClip,
    // ... other clip manager exports
  } = clipManager;

  // Project clips API
  const projectClipsApi = useProjectClips(projectId);
  const { saveFramingEdits, getClipFileUrl } = projectClipsApi;

  // =========================================
  // INITIALIZATION
  // =========================================

  // Initialize from loaded project data
  useEffect(() => {
    if (loadedClips.length > 0 && clips.length === 0) {
      // Load clips into clip manager
      loadedClips.forEach(clip => {
        clipManager.addClipFromProject(clip);
      });

      // Load first clip video
      const firstClip = loadedClips[selectedClipIndex];
      if (firstClip?.url) {
        loadVideoFromUrl(firstClip.url, firstClip.filename || 'clip.mp4');
      }
    }
  }, [loadedClips, selectedClipIndex]);

  // Set aspect ratio from project
  useEffect(() => {
    if (projectAspectRatio) {
      updateAspectRatio(projectAspectRatio);
    }
  }, [projectAspectRatio, updateAspectRatio]);

  // Initialize segments when duration available
  useEffect(() => {
    if (duration > 0) {
      initializeSegments(duration);
    }
  }, [duration, initializeSegments]);

  // =========================================
  // CONTAINER
  // =========================================

  const framing = FramingContainer({
    videoRef,
    videoUrl,
    metadata,
    currentTime,
    duration,
    isPlaying,
    seek,
    selectedProjectId: projectId,
    selectedProject: project,
    editorMode: 'framing',
    setEditorMode: navigate,
    // Pass all crop and segment state
    ...crop,
    ...segments,
    // Clip state
    ...clipManager,
    // Highlight for coordinated trim
    highlightHook: {
      keyframes: highlight.keyframes,
      framerate: highlight.framerate,
      deleteKeyframesInRange: highlight.deleteKeyframesInRange,
      addOrUpdateKeyframe: highlight.addOrUpdateKeyframe,
      cleanupTrimKeyframes: highlight.cleanupTrimKeyframes,
    },
    // Persistence
    saveFramingEdits,
    // Callbacks
    onCropChange: setDragCrop,
    onUserEdit: () => { clipHasUserEditsRef.current = true; },
    setFramingChangedSinceExport: () => {}, // Handle in overlay transition
  });

  // =========================================
  // HANDLERS
  // =========================================

  const handleSelectClip = useCallback(async (clipId) => {
    if (clipId === selectedClipId) return;

    // Save current clip state
    framing.saveCurrentClipState();

    // Find and load new clip
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    selectClip(clipId);
    resetSegments();
    resetCrop();

    if (clip.fileUrl) {
      await loadVideoFromUrl(clip.fileUrl, clip.fileName);
    }

    // Restore saved state
    if (clip.segments) {
      restoreSegmentState(clip.segments, clip.duration);
    }
    if (clip.cropKeyframes?.length > 0) {
      const endFrame = Math.round(clip.duration * (clip.framerate || 30));
      restoreCropState(clip.cropKeyframes, endFrame);
    }
  }, [selectedClipId, clips, selectClip, resetSegments, resetCrop, loadVideoFromUrl, restoreSegmentState, restoreCropState, framing]);

  const handleProceedToOverlay = useCallback(async (renderedVideoBlob, clipMetadata = null) => {
    try {
      // Save pending edits
      await framing.saveCurrentClipState();

      // Create working video
      const url = URL.createObjectURL(renderedVideoBlob);
      const meta = await extractVideoMetadata(renderedVideoBlob);

      // Store in project data store
      setWorkingVideo({ file: renderedVideoBlob, url, metadata: meta, clipMetadata });

      // Refresh project
      await refreshProject();

      // Navigate to overlay
      navigate('overlay');
    } catch (err) {
      console.error('[FramingScreen] Failed to proceed to overlay:', err);
      throw err;
    }
  }, [framing, setWorkingVideo, refreshProject, navigate]);

  const handleExportComplete = useCallback(() => {
    refreshProject();
  }, [refreshProject]);

  // =========================================
  // KEYBOARD SHORTCUTS
  // =========================================

  useKeyboardShortcuts({
    hasVideo: Boolean(videoUrl),
    togglePlay,
    stepForward,
    stepBackward,
    seek,
    editorMode: 'framing',
    selectedLayer: 'crop',
    copiedCrop: crop.copiedCrop,
    onCopyCrop: framing.handleCopyCrop,
    onPasteCrop: framing.handlePasteCrop,
    keyframes,
    framerate,
    selectedCropKeyframeIndex: null, // Computed in framing
    highlightKeyframes: [],
    highlightFramerate: 30,
    selectedHighlightKeyframeIndex: null,
    isHighlightEnabled: false,
  });

  // =========================================
  // RENDER
  // =========================================

  return (
    <FramingModeView
      // Video
      videoRef={videoRef}
      videoUrl={videoUrl}
      metadata={metadata}
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
      isLoading={isLoading}
      error={error}
      handlers={handlers}
      togglePlay={togglePlay}
      seek={seek}
      // Framing
      framing={framing}
      crop={crop}
      segments={segments}
      zoom={zoom}
      timelineZoom={timelineZoom}
      dragCrop={dragCrop}
      // Clips
      clips={clips}
      selectedClipId={selectedClipId}
      hasClips={hasClips}
      onSelectClip={handleSelectClip}
      // Audio
      includeAudio={includeAudio}
      onIncludeAudioChange={setIncludeAudio}
      // Export
      onProceedToOverlay={handleProceedToOverlay}
      onExportComplete={handleExportComplete}
      // Navigation
      onBackToProjects={() => navigate('project-manager')}
    />
  );
}
```

### Step 2: Update FramingModeView Props

**File**: `src/frontend/src/modes/FramingModeView.jsx`

Update to accept consolidated prop objects instead of 50+ individual props:

```jsx
export function FramingModeView({
  // Video (consolidated)
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  isPlaying,
  isLoading,
  error,
  handlers,
  togglePlay,
  seek,

  // Framing (consolidated objects)
  framing,    // From FramingContainer
  crop,       // From useCrop
  segments,   // From useSegments
  zoom,       // From useZoom
  timelineZoom,
  dragCrop,

  // Clips
  clips,
  selectedClipId,
  hasClips,
  onSelectClip,

  // Settings
  includeAudio,
  onIncludeAudioChange,

  // Callbacks
  onProceedToOverlay,
  onExportComplete,
  onBackToProjects,
}) {
  // Render using the consolidated props
  // ...
}
```

### Step 3: Create Framing Store (Optional)

For persisting framing state across mode switches without reloading.

**File**: `src/frontend/src/stores/framingStore.js`

```javascript
import { create } from 'zustand';

/**
 * Store for framing mode state that needs to persist across mode switches
 */
export const useFramingStore = create((set, get) => ({
  // Per-clip framing state
  clipStates: {},

  // Global settings
  includeAudio: true,

  // Export state
  hasExported: false,
  exportedStateHash: null,

  // Actions
  setClipState: (clipId, state) => set(prev => ({
    clipStates: { ...prev.clipStates, [clipId]: state }
  })),

  getClipState: (clipId) => get().clipStates[clipId] || null,

  setIncludeAudio: (value) => set({ includeAudio: value }),

  markExported: (stateHash) => set({
    hasExported: true,
    exportedStateHash: stateHash,
  }),

  hasChangedSinceExport: (currentStateHash) => {
    const { hasExported, exportedStateHash } = get();
    if (!hasExported) return false;
    return currentStateHash !== exportedStateHash;
  },

  reset: () => set({
    clipStates: {},
    hasExported: false,
    exportedStateHash: null,
  }),
}));
```

---

## Migration in App.jsx

### Before (lines 2005-2045):
```jsx
<FramingScreen
  projectId={selectedProjectId}
  project={selectedProject}
  videoRef={videoRef}
  videoUrl={videoUrl}
  // ... 50+ props
/>
```

### After:
```jsx
{mode === 'framing' && <FramingScreen />}
```

---

## Key Changes

1. **FramingScreen owns useVideo** - No more passing videoRef, videoUrl, etc. from App.jsx
2. **FramingScreen owns useCrop** - Keyframes, aspect ratio managed internally
3. **FramingScreen owns useSegments** - Boundaries, trim range managed internally
4. **State persists via stores** - projectDataStore and framingStore preserve state across renders
5. **Minimal props** - Only navigation callbacks and initial data

---

## Files Changed
- `src/frontend/src/screens/FramingScreen.jsx` (major update)
- `src/frontend/src/modes/FramingModeView.jsx` (update props)
- `src/frontend/src/stores/framingStore.js` (new)
- `src/frontend/src/stores/index.js` (update)

## Verification
```bash
cd src/frontend && npm test
cd src/frontend && npx playwright test "Framing"
```

## Manual Testing
1. Open a project with clips
2. Edit crop keyframes
3. Split segments
4. Export framing
5. Switch to overlay and back - verify state persists
6. Add second clip - verify switching works

## Commit Message
```
refactor: Make FramingScreen self-contained

- FramingScreen now owns useVideo, useCrop, useSegments hooks
- Remove 50+ props from FramingScreen
- Create framingStore for persistent state
- Use projectDataStore for loaded clip data
```
