# TASK-04: Self-Contained OverlayScreen

## Objective
Make OverlayScreen fully self-contained by moving all overlay-related hooks and state from App.jsx into the screen.

## Current Problem
App.jsx passes 60+ props to OverlayScreen:

```jsx
// App.jsx lines 2047-2120
<OverlayScreen
  projectId={selectedProjectId}
  project={selectedProject}
  onNavigate={setEditorMode}
  onSwitchToFraming={() => handleModeChange('framing')}
  onExportComplete={() => {...}}
  framingVideoUrl={videoUrl}
  framingMetadata={metadata}
  framingVideoFile={videoFile}
  framingKeyframes={keyframes}
  framingSegments={segments}
  framingSegmentSpeeds={segmentSpeeds}
  // ... 40+ more props for overlay state
  overlayVideoFile={overlayVideoFile}
  overlayVideoUrl={overlayVideoUrl}
  overlayVideoMetadata={overlayVideoMetadata}
  highlightBoundaries={highlightBoundaries}
  highlightRegions={highlightRegions}
  highlightRegionKeyframes={highlightRegionKeyframes}
  // ... all highlight region functions
/>
```

The overlay state (from `useOverlayState`, `useHighlightRegions`) is initialized in App.jsx and passed down. This creates tight coupling.

## Solution
OverlayScreen initializes its own hooks and manages its own state. It receives:
- Working video data from store (set by FramingScreen on export)
- Framing data from store (for pass-through mode check)

---

## Implementation Steps

### Step 1: Create Overlay Store

Store for overlay state that persists across mode switches.

**File**: `src/frontend/src/stores/overlayStore.js`

```javascript
import { create } from 'zustand';

/**
 * Store for overlay mode state
 * - Working video data (set by FramingScreen on export)
 * - Highlight regions (restored from backend)
 * - Effect settings
 */
export const useOverlayStore = create((set, get) => ({
  // Working video (from framing export or loaded from project)
  workingVideo: null, // { file, url, metadata }

  // Clip metadata for auto-generating highlight regions
  clipMetadata: null,

  // Effect settings
  effectType: 'original',

  // Loading states
  isLoadingWorkingVideo: false,
  isDataLoaded: false,

  // Actions
  setWorkingVideo: (video) => set({
    workingVideo: video,
    isLoadingWorkingVideo: false,
  }),

  setClipMetadata: (metadata) => set({ clipMetadata: metadata }),

  setEffectType: (type) => set({ effectType: type }),

  setIsLoadingWorkingVideo: (loading) => set({ isLoadingWorkingVideo: loading }),

  setIsDataLoaded: (loaded) => set({ isDataLoaded: loaded }),

  // Computed
  hasWorkingVideo: () => get().workingVideo !== null,

  getVideoDuration: () => get().workingVideo?.metadata?.duration || 0,

  reset: () => set({
    workingVideo: null,
    clipMetadata: null,
    effectType: 'original',
    isLoadingWorkingVideo: false,
    isDataLoaded: false,
  }),
}));
```

### Step 2: Update OverlayScreen to Own Its Hooks

**File**: `src/frontend/src/screens/OverlayScreen.jsx`

```jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useVideo } from '../hooks/useVideo';
import { useHighlight, useHighlightRegions, useOverlayState } from '../modes/overlay';
import { useZoom } from '../hooks/useZoom';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { OverlayModeView } from '../modes/OverlayModeView';
import { OverlayContainer } from '../containers/OverlayContainer';
import { useNavigationStore } from '../stores/navigationStore';
import { useOverlayStore } from '../stores/overlayStore';
import { useProjectDataStore } from '../stores/projectDataStore';
import { useFramingStore } from '../stores/framingStore';
import { useProject } from '../contexts/ProjectContext';
import { API_BASE } from '../config';
import { extractVideoMetadata } from '../utils/videoMetadata';

export function OverlayScreen() {
  // Navigation
  const navigate = useNavigationStore(state => state.navigate);

  // Project context
  const { projectId, project, refresh: refreshProject } = useProject();

  // Overlay store
  const {
    workingVideo,
    clipMetadata,
    effectType,
    setEffectType,
    isLoadingWorkingVideo,
    setIsLoadingWorkingVideo,
    isDataLoaded,
    setIsDataLoaded,
    setWorkingVideo,
    setClipMetadata,
  } = useOverlayStore();

  // Framing data (for pass-through mode)
  const { clips: framingClips } = useProjectDataStore();
  const { hasChangedSinceExport } = useFramingStore();

  // =========================================
  // OVERLAY STATE HOOK
  // =========================================

  const overlayState = useOverlayState();
  const {
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,
    pendingOverlaySaveRef,
    overlayDataLoadedRef,
  } = overlayState;

  // =========================================
  // VIDEO HOOK - Uses working video or framing video
  // =========================================

  // Determine effective video source
  const effectiveVideoUrl = workingVideo?.url || framingClips[0]?.url;
  const effectiveMetadata = workingVideo?.metadata || framingClips[0]?.metadata;

  const {
    videoRef,
    currentTime,
    duration,
    isPlaying,
    isLoading,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    handlers,
  } = useVideo();

  // =========================================
  // HIGHLIGHT HOOKS - OWNED BY THIS SCREEN
  // =========================================

  const highlight = useHighlight(effectiveMetadata, null);

  const highlightRegions = useHighlightRegions(effectiveMetadata);
  const {
    boundaries: highlightBoundaries,
    regions,
    keyframes: highlightRegionKeyframes,
    framerate: highlightRegionsFramerate,
    initializeWithDuration: initializeHighlightRegions,
    initializeFromClipMetadata: initializeHighlightRegionsFromClips,
    addRegion: addHighlightRegion,
    deleteRegionByIndex: deleteHighlightRegion,
    moveRegionStart: moveHighlightRegionStart,
    moveRegionEnd: moveHighlightRegionEnd,
    toggleRegionEnabled: toggleHighlightRegion,
    addOrUpdateKeyframe: addHighlightRegionKeyframe,
    removeKeyframe: removeHighlightRegionKeyframe,
    isTimeInEnabledRegion,
    getRegionAtTime,
    getHighlightAtTime: getRegionHighlightAtTime,
    getRegionsForExport,
    reset: resetHighlightRegions,
    restoreRegions: restoreHighlightRegions,
  } = highlightRegions;

  // Zoom
  const zoom = useZoom();

  // =========================================
  // INITIALIZATION
  // =========================================

  // Load working video on mount if not already loaded
  useEffect(() => {
    if (!workingVideo && project?.working_video_id && !isLoadingWorkingVideo) {
      setIsLoadingWorkingVideo(true);

      (async () => {
        try {
          const response = await fetch(`${API_BASE}/api/projects/${projectId}/working-video`);
          if (response.ok) {
            const blob = await response.blob();
            const file = new File([blob], 'working_video.mp4', { type: 'video/mp4' });
            const url = URL.createObjectURL(file);
            const metadata = await extractVideoMetadata(file);
            setWorkingVideo({ file, url, metadata });
          }
        } catch (err) {
          console.error('[OverlayScreen] Failed to load working video:', err);
        } finally {
          setIsLoadingWorkingVideo(false);
        }
      })();
    }
  }, [workingVideo, project?.working_video_id, projectId, isLoadingWorkingVideo]);

  // Initialize highlight regions when duration available
  useEffect(() => {
    const videoDuration = workingVideo?.metadata?.duration || duration;
    if (videoDuration > 0) {
      initializeHighlightRegions(videoDuration);
    }
  }, [workingVideo?.metadata?.duration, duration, initializeHighlightRegions]);

  // Auto-create highlight regions from clip metadata
  useEffect(() => {
    if (clipMetadata && effectiveMetadata && regions.length === 0) {
      const count = initializeHighlightRegionsFromClips(
        clipMetadata,
        effectiveMetadata.width,
        effectiveMetadata.height
      );
      if (count > 0) {
        console.log(`[OverlayScreen] Auto-created ${count} highlight regions`);
      }
      setClipMetadata(null);
    }
  }, [clipMetadata, effectiveMetadata, regions.length]);

  // Load overlay data from backend
  useEffect(() => {
    if (projectId && !isDataLoaded && effectiveMetadata?.duration) {
      (async () => {
        try {
          const response = await fetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`);
          const data = await response.json();

          if (data.has_data && data.highlights_data?.length > 0) {
            restoreHighlightRegions(data.highlights_data, effectiveMetadata.duration);
          }
          if (data.effect_type) {
            setEffectType(data.effect_type);
          }

          setIsDataLoaded(true);
        } catch (err) {
          console.error('[OverlayScreen] Failed to load overlay data:', err);
        }
      })();
    }
  }, [projectId, isDataLoaded, effectiveMetadata?.duration]);

  // =========================================
  // PERSISTENCE
  // =========================================

  const saveOverlayData = useCallback(async () => {
    if (!projectId) return;

    try {
      const formData = new FormData();
      formData.append('highlights_data', JSON.stringify(getRegionsForExport() || []));
      formData.append('text_overlays', JSON.stringify([]));
      formData.append('effect_type', effectType);

      await fetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`, {
        method: 'PUT',
        body: formData
      });
    } catch (err) {
      console.error('[OverlayScreen] Failed to save overlay data:', err);
    }
  }, [projectId, effectType, getRegionsForExport]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (!isDataLoaded) return;

    const timeout = setTimeout(saveOverlayData, 2000);
    return () => clearTimeout(timeout);
  }, [regions, effectType, isDataLoaded, saveOverlayData]);

  // =========================================
  // CONTAINER
  // =========================================

  const overlay = OverlayContainer({
    videoRef,
    currentTime,
    duration,
    isPlaying,
    seek,
    // Overlay state
    ...overlayState,
    // Highlight regions
    highlightRegions: regions,
    highlightBoundaries,
    highlightRegionKeyframes,
    highlightRegionsFramerate,
    // ... all highlight functions
    addHighlightRegion,
    deleteHighlightRegion,
    moveHighlightRegionStart,
    moveHighlightRegionEnd,
    toggleHighlightRegion,
    addHighlightRegionKeyframe,
    removeHighlightRegionKeyframe,
    getRegionAtTime,
    isTimeInEnabledRegion,
    getRegionHighlightAtTime,
    getRegionsForExport,
    restoreHighlightRegions,
    // Effect type
    highlightEffectType: effectType,
    setHighlightEffectType: setEffectType,
  });

  // =========================================
  // HANDLERS
  // =========================================

  const handleSwitchToFraming = useCallback(() => {
    saveOverlayData();
    navigate('framing');
  }, [saveOverlayData, navigate]);

  const handleExportComplete = useCallback(() => {
    refreshProject();
  }, [refreshProject]);

  // =========================================
  // KEYBOARD SHORTCUTS
  // =========================================

  useKeyboardShortcuts({
    hasVideo: Boolean(effectiveVideoUrl),
    togglePlay,
    stepForward,
    stepBackward,
    seek,
    editorMode: 'overlay',
    selectedLayer: 'highlight',
    // ... other keyboard config
  });

  // =========================================
  // RENDER
  // =========================================

  return (
    <OverlayModeView
      // Video
      videoRef={videoRef}
      videoUrl={effectiveVideoUrl}
      metadata={effectiveMetadata}
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
      isLoading={isLoading || isLoadingWorkingVideo}
      handlers={handlers}
      togglePlay={togglePlay}
      seek={seek}
      // Overlay
      overlay={overlay}
      highlightRegions={{
        regions,
        boundaries: highlightBoundaries,
        keyframes: highlightRegionKeyframes,
        framerate: highlightRegionsFramerate,
        // Functions
        addRegion: addHighlightRegion,
        deleteRegion: deleteHighlightRegion,
        moveRegionStart: moveHighlightRegionStart,
        moveRegionEnd: moveHighlightRegionEnd,
        toggleRegion: toggleHighlightRegion,
        addKeyframe: addHighlightRegionKeyframe,
        removeKeyframe: removeHighlightRegionKeyframe,
        getRegionAtTime,
        getHighlightAtTime: getRegionHighlightAtTime,
        getRegionsForExport,
      }}
      effectType={effectType}
      onEffectTypeChange={setEffectType}
      dragHighlight={dragHighlight}
      setDragHighlight={setDragHighlight}
      zoom={zoom}
      // Callbacks
      onSwitchToFraming={handleSwitchToFraming}
      onExportComplete={handleExportComplete}
      onBackToProjects={() => navigate('project-manager')}
    />
  );
}
```

### Step 3: Update OverlayModeView Props

**File**: `src/frontend/src/modes/OverlayModeView.jsx`

Simplify to accept consolidated objects:

```jsx
export function OverlayModeView({
  // Video
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  isPlaying,
  isLoading,
  handlers,
  togglePlay,
  seek,

  // Overlay (consolidated)
  overlay,           // From OverlayContainer
  highlightRegions,  // Consolidated object with all region state/functions
  effectType,
  onEffectTypeChange,
  dragHighlight,
  setDragHighlight,
  zoom,

  // Callbacks
  onSwitchToFraming,
  onExportComplete,
  onBackToProjects,
}) {
  // Render
}
```

---

## Migration in App.jsx

### Before (lines 2047-2120):
```jsx
<OverlayScreen
  projectId={selectedProjectId}
  project={selectedProject}
  // ... 60+ props
  highlightBoundaries={highlightBoundaries}
  highlightRegions={highlightRegions}
  // ...
/>
```

### After:
```jsx
{mode === 'overlay' && <OverlayScreen />}
```

---

## Coordination with FramingScreen

When FramingScreen exports, it updates the overlay store:

```jsx
// In FramingScreen.handleProceedToOverlay
const { setWorkingVideo, setClipMetadata } = useOverlayStore();

const handleProceedToOverlay = async (renderedVideoBlob, clipMetadata) => {
  const url = URL.createObjectURL(renderedVideoBlob);
  const metadata = await extractVideoMetadata(renderedVideoBlob);

  setWorkingVideo({ file: renderedVideoBlob, url, metadata });
  setClipMetadata(clipMetadata);

  navigate('overlay');
};
```

---

## Files Changed
- `src/frontend/src/stores/overlayStore.js` (new)
- `src/frontend/src/stores/index.js` (update)
- `src/frontend/src/screens/OverlayScreen.jsx` (major update)
- `src/frontend/src/modes/OverlayModeView.jsx` (update props)

## Verification
```bash
cd src/frontend && npm test
cd src/frontend && npx playwright test "Overlay"
```

## Manual Testing
1. Open project with working video
2. Verify highlight regions load
3. Add/edit highlight regions
4. Change effect type
5. Switch to framing and back - verify state persists
6. Export final video

## Commit Message
```
refactor: Make OverlayScreen self-contained

- OverlayScreen now owns useHighlight, useHighlightRegions hooks
- Create overlayStore for state persistence
- Remove 60+ props from OverlayScreen
- Coordinate with FramingScreen via stores
```
