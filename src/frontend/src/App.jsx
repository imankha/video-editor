import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Image } from 'lucide-react';
import { DownloadsPanel } from './components/DownloadsPanel';
import { useDownloads } from './hooks/useDownloads';
import { API_BASE } from './config';
import { useVideo } from './hooks/useVideo';
import useZoom from './hooks/useZoom';
import useTimelineZoom from './hooks/useTimelineZoom';
import { useClipManager } from './hooks/useClipManager';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useExportWebSocket } from './hooks/useExportWebSocket';
import { useProjects } from './hooks/useProjects';
import { useProjectClips } from './hooks/useProjectClips';
import { useGames } from './hooks/useGames';
import { useSettings } from './hooks/useSettings';
import { FileUpload } from './components/FileUpload';
import { ClipSelectorSidebar } from './components/ClipSelectorSidebar';
import AspectRatioSelector from './components/AspectRatioSelector';
import DebugInfo from './components/DebugInfo';
import { ConfirmationDialog, ModeSwitcher } from './components/shared';
import { ProjectManager } from './components/ProjectManager';
import { ProjectCreationSettings } from './components/ProjectCreationSettings';
import { ProjectHeader } from './components/ProjectHeader';
// Mode-specific imports (hooks only - components now in mode views)
import { useCrop, useSegments } from './modes/framing';
import { useHighlight, useHighlightRegions, useOverlayState } from './modes/overlay';
// ClipsSidePanel now rendered inside AnnotateScreen
// Note: Mode views (FramingModeView, AnnotateModeView, OverlayModeView) are now
// imported directly by their Screen components
// Screen components (self-contained, own their hooks)
import { FramingScreen, OverlayScreen, AnnotateScreen, ProjectsScreen } from './screens';
// Container imports for mode-specific logic encapsulation
// Note: AnnotateContainer is now only used inside AnnotateScreen (single source of truth)
import {
  OverlayContainer,
  FramingContainer,
} from './containers';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from './utils/keyframeUtils';
import { AppStateProvider } from './contexts';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from './utils/videoMetadata';
import { useCurrentVideoState } from './hooks/useCurrentVideoState';
import { useEditorStore, useExportStore } from './stores';

function App() {
  const [videoFile, setVideoFile] = useState(null);
  // Temporary state for live drag/resize preview (null when not dragging)
  const [dragCrop, setDragCrop] = useState(null);

  // Editor mode state from Zustand store (see stores/editorStore.js)
  const {
    editorMode,
    setEditorMode,
    modeSwitchDialog,
    openModeSwitchDialog,
    closeModeSwitchDialog,
    confirmModeSwitch,
    selectedLayer,
    setSelectedLayer,
  } = useEditorStore();

  // Overlay mode state (consolidated via useOverlayState hook)
  const {
    overlayVideoFile,
    overlayVideoUrl,
    overlayVideoMetadata,
    overlayClipMetadata,
    isLoadingWorkingVideo,
    setOverlayVideoFile,
    setOverlayVideoUrl,
    setOverlayVideoMetadata,
    setOverlayClipMetadata,
    setIsLoadingWorkingVideo,
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,
    highlightEffectType,
    setHighlightEffectType,
    pendingOverlaySaveRef,
    overlayDataLoadedRef,
  } = useOverlayState();

  // Track if framing has changed since last export (for showing warning on Overlay button)
  const [framingChangedSinceExport, setFramingChangedSinceExport] = useState(false);

  // Note: modeSwitchDialog now comes from useEditorStore (see above)

  // NOTE: Annotate mode state is now provided by AnnotateContainer
  // The container is called after all its required props are available (see below)

  // Export state from Zustand store (see stores/exportStore.js)
  const {
    exportProgress,
    setExportProgress,
    exportingProject,
    startExport,
    clearExport,
    globalExportProgress,
    setGlobalExportProgress,
  } = useExportStore();

  // NOTE: wasPlayingRef for pause transition detection is now in AnnotateContainer

  // Ref to track if user has made explicit edits to current clip (vs auto-generated defaults)
  // Resets when clip selection changes. Prevents saving default state as "user edits"
  const clipHasUserEditsRef = useRef(false);

  // Note: selectedLayer now comes from useEditorStore (see above)

  // Audio state - synced between export settings and playback (Framing mode only)
  const [includeAudio, setIncludeAudio] = useState(true);

  // NOTE: highlightEffectType is now provided by useOverlayState hook

  // NOTE: selectedCropKeyframeIndex and selectedHighlightKeyframeIndex are now derived via useMemo
  // (defined after hooks that provide keyframes and currentTime)

  // Multi-clip management hook
  const {
    clips,
    selectedClipId,
    selectedClip,
    hasClips,
    globalAspectRatio,
    globalTransition,
    addClip,
    addClipFromProject,
    loadProjectClips,
    clearClips,
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalAspectRatio,
    setGlobalTransition,
    getExportData: getClipExportData,
  } = useClipManager();

  // Project management hooks
  const {
    projects,
    selectedProject,
    selectedProjectId,
    loading: projectsLoading,
    hasProjects,
    fetchProjects,
    selectProject,
    createProject,
    deleteProject,
    clearSelection,
    refreshSelectedProject,
    discardUncommittedChanges
  } = useProjects();

  // Games management hook
  const {
    games,
    isLoading: gamesLoading,
    fetchGames,
    createGame,
    uploadGameVideo,
    getGame,
    deleteGame,
    saveAnnotationsDebounced,
    getGameVideoUrl,
  } = useGames();

  // Settings hook for project creation rules
  const {
    projectCreationSettings,
    updateProjectCreationSettings,
    resetSettings,
  } = useSettings();

  // Settings modal state
  const [showProjectCreationSettings, setShowProjectCreationSettings] = useState(false);

  // Pending file for annotate mode (set from ProjectManager, consumed by AnnotateScreen)
  const [pendingAnnotateFile, setPendingAnnotateFile] = useState(null);
  // Pending game ID for annotate mode (set when loading saved game from ProjectManager)
  const [pendingGameId, setPendingGameId] = useState(null);

  // Downloads panel state
  const [isDownloadsPanelOpen, setIsDownloadsPanelOpen] = useState(false);
  const { count: downloadsCount, fetchCount: refreshDownloadsCount } = useDownloads();

  // NOTE: Overlay persistence refs (pendingOverlaySaveRef, overlayDataLoadedRef)
  // are now provided by useOverlayState hook

  // Framing persistence state
  const pendingFramingSaveRef = useRef(null);

  // Export button ref (for triggering export programmatically)
  const exportButtonRef = useRef(null);

  // Export progress WebSocket (connects when export is in progress)
  // @see hooks/useExportWebSocket.js for implementation
  const handleExportComplete = useCallback(() => {
    fetchProjects();
    refreshDownloadsCount();
  }, [fetchProjects, refreshDownloadsCount]);

  useExportWebSocket({
    onExportComplete: handleExportComplete,
  });

  // Project clips (only active when project selected)
  const {
    clips: projectClips,
    fetchClips: fetchProjectClips,
    uploadClip,
    addClipFromLibrary,
    removeClip: removeProjectClip,
    reorderClips: reorderProjectClips,
    saveFramingEdits,
    getClipFileUrl
  } = useProjectClips(selectedProjectId);

  // Computed: is overlay available for this project?
  const isOverlayAvailable = selectedProject?.working_video_id != null;

  // Segments hook (defined early so we can pass getSegmentAtTime and clampToVisibleRange to useVideo)
  const {
    boundaries: segmentBoundaries,
    segments,
    sourceDuration,
    visualDuration,
    trimmedDuration,
    segmentVisualLayout,
    framerate: segmentFramerate,
    trimRange,  // NEW: Watch for trim range changes
    trimHistory,  // NEW: Trim history for de-trim buttons
    segmentSpeeds,  // Speed settings by segment index
    initializeWithDuration: initializeSegments,
    reset: resetSegments,
    restoreState: restoreSegmentState,
    addBoundary: addSegmentBoundary,
    removeBoundary: removeSegmentBoundary,
    setSegmentSpeed,
    toggleTrimSegment,
    getSegmentAtTime,
    getExportData: getSegmentExportData,
    isTimeVisible,
    clampToVisibleRange,  // NEW: Single source of truth for valid playback positions
    sourceTimeToVisualTime,
    visualTimeToSourceTime,
    createFrameRangeKey,
    isSegmentTrimmed,
    detrimStart,  // NEW: De-trim from start
    detrimEnd,  // NEW: De-trim from end
  } = useSegments();

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
  // NOTE: Only pass segment functions in Framing mode. In Overlay mode, the rendered
  // video doesn't have segments/trimming, so we pass null to avoid incorrect playback behavior.
  } = useVideo(
    editorMode === 'framing' ? getSegmentAtTime : null,
    editorMode === 'framing' ? clampToVisibleRange : null
  );

  // Crop hook - always active when video loaded
  const {
    aspectRatio,
    keyframes,
    isEndKeyframeExplicit,
    copiedCrop,
    framerate,
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,  // NEW: Clean up trim-related keyframes
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
    getCropDataAtTime,
    getKeyframesForExport,
    reset: resetCrop,
    restoreState: restoreCropState,
  } = useCrop(metadata, trimRange);

  // Highlight hook - for highlighting specific players
  // IMPORTANT: Once overlay video exists (rendered or pass-through), ALWAYS use its metadata for highlight
  // This prevents highlight keyframes from being reset when switching modes
  // The highlight is designed for the overlay video, so its metadata should be stable
  // Note: effectiveOverlayMetadata is computed later, so we use a simpler fallback here
  const effectiveHighlightMetadata = overlayVideoMetadata || metadata;
  // No trimRange for highlight - overlay video is already trimmed
  const effectiveHighlightTrimRange = null;

  const {
    keyframes: highlightKeyframes,
    framerate: highlightFramerate,
    isEnabled: isHighlightEnabled,
    addOrUpdateKeyframe: addOrUpdateHighlightKeyframe,
    deleteKeyframesInRange: deleteHighlightKeyframesInRange,
    cleanupTrimKeyframes: cleanupHighlightTrimKeyframes,
    getHighlightDataAtTime,
    reset: resetHighlight,
  } = useHighlight(effectiveHighlightMetadata, effectiveHighlightTrimRange);

  // Highlight regions hook - boundary-based system (like segments)
  const {
    boundaries: highlightBoundaries,
    regions: highlightRegions,
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
  } = useHighlightRegions(effectiveHighlightMetadata);

  // Zoom hook
  const {
    zoom,
    panOffset,
    isZoomed,
    MIN_ZOOM,
    MAX_ZOOM,
    zoomIn,
    zoomOut,
    resetZoom,
    zoomByWheel,
    updatePan,
  } = useZoom();

  // Timeline zoom hook
  const {
    timelineZoom,
    scrollPosition: timelineScrollPosition,
    zoomByWheel: timelineZoomByWheel,
    updateScrollPosition: updateTimelineScrollPosition,
    getTimelineScale,
  } = useTimelineZoom();

  // Annotate mode: AnnotateContainer is now ONLY called inside AnnotateScreen
  // This eliminates duplicate state between App.jsx and AnnotateScreen.
  // App.jsx just handles navigation - actual game loading happens in AnnotateScreen.

  // Handler for loading saved games from ProjectManager
  // Sets pendingGameId and navigates to annotate mode - AnnotateScreen handles actual loading
  const handleLoadGame = useCallback((gameId) => {
    console.log('[App] Loading game - setting pendingGameId:', gameId);
    setPendingGameId(gameId);
    setEditorMode('annotate');
  }, [setEditorMode]);

  // OverlayContainer - encapsulates all overlay mode state and handlers
  // Returns derived state and handlers for use in render. Effects run internally.
  const overlay = OverlayContainer({
    // Video controls
    videoRef,
    currentTime,
    duration,
    isPlaying,
    seek,
    // Framing video state (for pass-through mode)
    framingVideoUrl: videoUrl,
    framingMetadata: metadata,
    framingVideoFile: videoFile,
    // Keyframes and segments from Framing mode
    keyframes,
    segments,
    segmentSpeeds,
    segmentBoundaries,
    trimRange,
    // Project context
    selectedProjectId,
    selectedProject,
    // Clips state
    clips,
    hasClips,
    // Editor mode
    editorMode,
    setEditorMode,
    setSelectedLayer,
    // Overlay state from useOverlayState hook
    overlayVideoFile,
    overlayVideoUrl,
    overlayVideoMetadata,
    overlayClipMetadata,
    isLoadingWorkingVideo,
    setOverlayVideoFile,
    setOverlayVideoUrl,
    setOverlayVideoMetadata,
    setOverlayClipMetadata,
    setIsLoadingWorkingVideo,
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,
    highlightEffectType,
    setHighlightEffectType,
    pendingOverlaySaveRef,
    overlayDataLoadedRef,
    // Highlight regions from useHighlightRegions hook
    highlightRegions,
    highlightBoundaries,
    highlightRegionKeyframes,
    highlightRegionsFramerate,
    initializeHighlightRegions,
    resetHighlightRegions,
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
    initializeHighlightRegionsFromClips,
    // Callbacks
    onOverlayDataSaved: () => setFramingChangedSinceExport(false),
  });

  // FramingContainer - encapsulates framing mode logic and computed state
  // Returns derived state and handlers for crop/segment operations
  const framing = FramingContainer({
    // Video element ref and state
    videoRef,
    videoUrl,
    metadata,
    currentTime,
    duration,
    isPlaying,
    seek,

    // Project context
    selectedProjectId,
    selectedProject,

    // Editor mode
    editorMode,
    setEditorMode,

    // Crop state and actions (from useCrop)
    keyframes,
    aspectRatio,
    framerate,
    isEndKeyframeExplicit,
    copiedCrop,
    addOrUpdateKeyframe,
    removeKeyframe,
    copyCropKeyframe,
    pasteCropKeyframe,
    getCropDataAtTime,
    interpolateCrop,
    hasKeyframeAt,
    getKeyframesForExport,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    restoreCropState,
    updateAspectRatio,
    resetCrop,

    // Segment state and actions (from useSegments)
    segments,
    segmentBoundaries,
    segmentSpeeds,
    trimRange,
    trimHistory,
    sourceDuration,
    visualDuration,
    trimmedDuration,
    segmentVisualLayout,
    segmentFramerate,
    initializeSegments,
    resetSegments,
    restoreSegmentState,
    addSegmentBoundary: addBoundary => addSegmentBoundary(addBoundary),
    removeSegmentBoundary: removeSegmentBoundary,
    setSegmentSpeed,
    toggleTrimSegment,
    getSegmentAtTime,
    getSegmentExportData,
    isTimeVisible,
    clampToVisibleRange,
    sourceTimeToVisualTime,
    visualTimeToSourceTime,
    createFrameRangeKey,
    isSegmentTrimmed,
    detrimStart,
    detrimEnd,

    // Clip state and actions (from useClipManager)
    clips,
    selectedClipId,
    selectedClip,
    hasClips,
    globalAspectRatio,
    globalTransition,
    addClip,
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalAspectRatio,
    setGlobalTransition,
    getClipExportData,

    // Highlight hook (for coordinated trim operations)
    highlightHook: {
      keyframes: highlightKeyframes,
      framerate: highlightFramerate,
      duration: effectiveHighlightMetadata?.duration || duration,
      getHighlightDataAtTime: getHighlightDataAtTime,
      deleteKeyframesInRange: deleteHighlightKeyframesInRange,
      addOrUpdateKeyframe: addOrUpdateHighlightKeyframe,
      cleanupTrimKeyframes: cleanupHighlightTrimKeyframes,
    },

    // Project clips hook (for backend persistence)
    saveFramingEdits,

    // Callbacks
    onCropChange: setDragCrop,
    onUserEdit: () => { clipHasUserEditsRef.current = true; },
    setFramingChangedSinceExport,
  });

  // Destructure framing container values for use in render
  const {
    clipsWithCurrentState: framingClipsWithCurrentState,
    handleCropChange: framingHandleCropChange,
    handleCropComplete: framingHandleCropComplete,
    handleTrimSegment: framingHandleTrimSegment,
    handleDetrimStart: framingHandleDetrimStart,
    handleDetrimEnd: framingHandleDetrimEnd,
    handleKeyframeClick: framingHandleKeyframeClick,
    handleKeyframeDelete: framingHandleKeyframeDelete,
    handleCopyCrop: framingHandleCopyCrop,
    handlePasteCrop: framingHandlePasteCrop,
    saveCurrentClipState: framingSaveCurrentClipState,
  } = framing;

  // Frame tolerance for selection - approximately 5 pixels on each side
  // Derived selection state - computed from playhead position and keyframes
  // This eliminates race conditions between auto-selection and manual selection
  const selectedCropKeyframeIndex = useMemo(() => {
    if (!videoUrl) return null;
    const currentFrame = Math.round(currentTime * framerate);
    const index = findKeyframeIndexNearFrame(keyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, framerate, keyframes]);

  const selectedHighlightKeyframeIndex = useMemo(() => {
    if (!videoUrl || !isHighlightEnabled) return null;
    const currentFrame = Math.round(currentTime * highlightFramerate);
    const index = findKeyframeIndexNearFrame(highlightKeyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, highlightFramerate, highlightKeyframes, isHighlightEnabled]);

  // NOTE: clipsWithCurrentState, autoSaveFramingEdits, and framingSaveCurrentClipState
  // are now managed by FramingContainer and accessed via framingClipsWithCurrentState, etc.

  /**
   * Calculate clip metadata for overlay mode from loaded project clips
   * Used when reopening a project with an existing working video
   * @param {Array} clipsData - Array of clip data from backend (with segments_data JSON)
   * @returns {Object|null} Metadata object with source_clips array, or null if no clips
   */
  const buildClipMetadataFromProjectClips = useCallback((clipsData) => {
    if (!clipsData || clipsData.length === 0) return null;

    // Helper to calculate effective duration (same logic as ExportButton)
    const calculateEffectiveDuration = (clip) => {
      const segments = clip.segments_data ? JSON.parse(clip.segments_data) : {};
      const boundaries = segments.boundaries || [0, clip.duration || 0];
      const segmentSpeeds = segments.segmentSpeeds || {};
      const trimRange = segments.trimRange;

      const start = trimRange?.start ?? 0;
      const end = trimRange?.end ?? (clip.duration || 0);

      // If no speed changes, simple calculation
      if (Object.keys(segmentSpeeds).length === 0) {
        return end - start;
      }

      // Calculate duration accounting for speed changes per segment
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

    let currentTime = 0;
    const sourceClips = clipsData.map(clip => {
      const effectiveDuration = calculateEffectiveDuration(clip);
      const clipMeta = {
        name: clip.filename || clip.name || 'Clip',
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
  }, []);

  /**
   * Handle file selection - adds clip to clip manager
   */
  const handleFileSelect = async (file) => {
    try {
      // Extract metadata first
      const videoMetadata = await extractVideoMetadata(file);

      // Add clip to the clip manager
      const newClipId = addClip(file, videoMetadata);

      console.log('[App] handleFileSelect: hasClips=', hasClips, 'clips.length=', clips.length, 'selectedClipId=', selectedClipId);

      // If this is the first clip, load it immediately
      if (!hasClips || clips.length === 0) {
        console.log('[App] First clip - loading immediately');
        // Reset all state for fresh start
        resetSegments();
        resetCrop();
        resetHighlight();
        resetHighlightRegions();
        setSelectedLayer('playhead');
        setVideoFile(file);
        await loadVideo(file);
      } else {
        // Additional clips - just add to the list, don't switch to it
        // User stays on the currently selected clip
        console.log('[App] Additional clip added (staying on current clip):', selectedClipId);
      }

      console.log('[App] Added clip:', newClipId, file.name);
    } catch (err) {
      console.error('[App] Failed to add clip:', err);
    }
  };

  // NOTE: Annotate mode handlers (handleGameVideoSelect, handleLoadGame, etc.)
  // are now provided by AnnotateContainer (see destructuring above)
  // NOTE: The following annotate handlers are now provided by AnnotateContainer:
  // - handleLoadGame
  // - handleCreateAnnotatedVideo
  // - handleImportIntoProjects
  // - handleToggleFullscreen
  // - handleAddClipFromButton
  // - handleFullscreenCreateClip / handleFullscreenUpdateClip
  // - handleOverlayClose / handleOverlayResume
  // - handleSelectAnnotateRegion
  // Effects for auto-select, playback speed sync, fullscreen detection are also in container.

  /**
   * Handle clip selection from sidebar
   */
  const handleSelectClip = useCallback(async (clipId) => {
    if (clipId === selectedClipId) return;

    // Save current clip's state
    framingSaveCurrentClipState();

    // Find the clip to load
    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      console.error('[App] Clip not found:', clipId);
      return;
    }

    // Select the new clip
    selectClip(clipId);

    // Reset hooks first
    resetSegments();
    resetCrop();
    resetHighlight();
    resetHighlightRegions();
    setSelectedLayer('playhead');

    // Ensure crop aspect ratio matches project/global setting
    const effectiveAspectRatio = selectedProject?.aspect_ratio || globalAspectRatio;
    if (effectiveAspectRatio) {
      updateAspectRatio(effectiveAspectRatio);
    }

    // Load the video - project clips use fileUrl, local clips use file
    if (clip.file) {
      setVideoFile(clip.file);
      await loadVideo(clip.file);
    } else if (clip.fileUrl) {
      console.log('[App] Loading clip from URL:', clip.fileUrl);
      const loadedFile = await loadVideoFromUrl(clip.fileUrl, clip.fileName);
      if (loadedFile) {
        setVideoFile(loadedFile); // Update App's videoFile state for export
      }
    } else {
      console.error('[App] Clip has no file or fileUrl:', clipId);
      return;
    }

    // Restore saved state for this clip (if any)
    const hasSavedSegments = clip.segments && (
      (clip.segments.boundaries && clip.segments.boundaries.length > 2) ||
      (clip.segments.segmentSpeeds && Object.keys(clip.segments.segmentSpeeds).length > 0) ||
      clip.segments.trimRange
    );
    const hasSavedCrop = clip.cropKeyframes && clip.cropKeyframes.length > 0;

    if (hasSavedSegments) {
      console.log('[App] Restoring segment state for clip:', clipId, clip.segments);
      restoreSegmentState(clip.segments, clip.duration);
    }

    if (hasSavedCrop) {
      const endFrame = Math.round(clip.duration * (clip.framerate || 30));
      console.log('[App] Restoring crop keyframes for clip:', clipId, 'endFrame:', endFrame, clip.cropKeyframes);
      restoreCropState(clip.cropKeyframes, endFrame);
    }

    console.log('[App] Switched to clip:', clipId, clip.fileName);
  }, [selectedClipId, framingSaveCurrentClipState, clips, selectClip, resetSegments, resetCrop, resetHighlight, resetHighlightRegions, loadVideo, loadVideoFromUrl, restoreSegmentState, restoreCropState, selectedProject, globalAspectRatio, updateAspectRatio]);

  /**
   * Handle clip deletion from sidebar
   */
  const handleDeleteClip = useCallback((clipId) => {
    const clipToDelete = clips.find(c => c.id === clipId);
    if (!clipToDelete) return;

    // If deleting the currently selected clip, need to handle differently
    if (clipId === selectedClipId) {
      // Find another clip to select
      const remainingClips = clips.filter(c => c.id !== clipId);

      if (remainingClips.length > 0) {
        // Select the first remaining clip
        handleSelectClip(remainingClips[0].id);
      } else {
        // No more clips - reset everything
        resetSegments();
        resetCrop();
        resetHighlight();
        resetHighlightRegions();
        setVideoFile(null);
        // Clear video - loadVideo with null will handle cleanup
      }
    }

    // Delete the clip
    deleteClip(clipId);

    console.log('[App] Deleted clip:', clipId, clipToDelete.fileName);
  }, [clips, selectedClipId, handleSelectClip, deleteClip, resetSegments, resetCrop, resetHighlight, resetHighlightRegions]);

  /**
   * Handle adding a new clip from sidebar
   */
  const handleAddClipFromSidebar = useCallback((file) => {
    handleFileSelect(file);
  }, []);

  // Initialize segments when video duration is available
  useEffect(() => {
    if (duration && duration > 0) {
      initializeSegments(duration);
    }
  }, [duration, initializeSegments]);

  // Initialize highlight regions when overlay video duration is available
  useEffect(() => {
    const highlightDuration = overlayVideoMetadata?.duration || duration;
    if (highlightDuration && highlightDuration > 0) {
      initializeHighlightRegions(highlightDuration);
    }
  }, [overlayVideoMetadata?.duration, duration, initializeHighlightRegions]);

  // Auto-create highlight regions from clip metadata when transitioning from Framing
  // This creates a 5-second region at the start of each clip for easy highlighting
  useEffect(() => {
    if (overlayClipMetadata && overlayVideoMetadata && highlightRegions.length === 0) {
      const count = initializeHighlightRegionsFromClips(
        overlayClipMetadata,
        overlayVideoMetadata.width,
        overlayVideoMetadata.height
      );

      if (count > 0) {
        console.log(`[App] Auto-created ${count} highlight regions from clip metadata`);
      }

      // Clear clip metadata after processing to prevent re-triggering
      setOverlayClipMetadata(null);
    }
  }, [overlayClipMetadata, overlayVideoMetadata, highlightRegions.length, initializeHighlightRegionsFromClips]);

  // Sync video mute state with export audio setting
  // When user turns off audio in export settings, also mute playback preview
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = !includeAudio;
    }
  }, [includeAudio, videoRef]);

  // NOTE: Annotate mode effects (playback speed sync, metadata extraction, fullscreen detection,
  // pause overlay, auto-save annotations) are now handled by AnnotateContainer.

  // DERIVED STATE: Single source of truth
  // - If dragging: show live preview (dragCrop)
  // - Otherwise: interpolate from keyframes
  // IMPORTANT: Extract only spatial properties (x, y, width, height) - no time!
  const currentCropState = useMemo(() => {
    let crop;
    if (dragCrop) {
      crop = dragCrop;
    } else if (keyframes.length === 0) {
      return null;
    } else {
      crop = interpolateCrop(currentTime);
    }

    // Strip time property - CropOverlay should only know about spatial coords
    if (!crop) return null;
    return {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height
    };
  }, [dragCrop, keyframes, currentTime, interpolateCrop]);

  // DERIVED STATE: From OverlayContainer
  // These values are computed by OverlayContainer and aliased here for compatibility
  // NOTE: handleProceedToOverlay is defined in App.jsx (has additional framing save logic)
  const {
    currentHighlightState,
    hasFramingEdits,
    hasMultipleClips,
    effectiveOverlayVideoUrl,
    effectiveOverlayMetadata,
    effectiveOverlayFile,
    playerDetectionEnabled,
    playerDetections,
    isDetectionLoading,
    isDetectionUploading,
    detectionError,
    handlePlayerSelect,
    handleHighlightChange,
    handleHighlightComplete,
  } = overlay;

  // Unified video state based on current editor mode
  // This hook provides a single interface to access video state regardless of mode
  // Note: Annotate state is now owned by AnnotateScreen, so we pass null here.
  // AnnotateScreen handles its own video state internally.
  const currentVideoState = useCurrentVideoState(
    editorMode,
    { videoUrl, metadata, videoFile, isLoading },
    { overlayVideoUrl: effectiveOverlayVideoUrl, overlayVideoMetadata: effectiveOverlayMetadata, overlayVideoFile: effectiveOverlayFile, isLoadingWorkingVideo },
    { annotateVideoUrl: null, annotateVideoMetadata: null, annotateVideoFile: null, isLoading: false }
  );

  // NOTE: Player detection (playerDetectionEnabled, playerDetections, isDetectionLoading,
  // isDetectionUploading, detectionError) and handlePlayerSelect are now provided by OverlayContainer

  // Debug: Log keyframes changes (disabled - too frequent, use React DevTools instead)

  // Debug: Log currentCropState changes (disabled - too spammy)
  // useEffect(() => {
  //   console.log('[App] Current crop state:', currentCropState);
  // }, [currentCropState]);

  // BUG FIX: Auto-cleanup trim keyframes when trimRange is cleared
  // Use ref to track previous value to avoid cleanup on initial mount
  const prevTrimRangeRef = useRef(undefined);
  useEffect(() => {
    // Only cleanup if transitioning from non-null to null (not on initial mount)
    if (prevTrimRangeRef.current !== undefined && prevTrimRangeRef.current !== null && trimRange === null) {
      cleanupTrimKeyframes();
      cleanupHighlightTrimKeyframes();
    }
    prevTrimRangeRef.current = trimRange;
  }, [trimRange, cleanupTrimKeyframes, cleanupHighlightTrimKeyframes]);

  // BUG FIX: Auto-reposition playhead when it becomes invalid after trim operation
  // This ensures the playhead is always within the visible (non-trimmed) range
  const lastSeekTimeRef = useRef(null);
  useEffect(() => {
    if (!trimRange || !videoUrl) return;

    // Check if current playhead position is outside the valid trim range
    const isPlayheadInvalid = currentTime < trimRange.start || currentTime > trimRange.end;

    if (isPlayheadInvalid) {
      // Clamp to the nearest valid position
      const validTime = clampToVisibleRange(currentTime);

      // Only seek if the difference is significant (avoid floating point precision loops)
      const threshold = 0.001; // 1ms threshold
      const needsSeek = lastSeekTimeRef.current === null ||
                        Math.abs(validTime - lastSeekTimeRef.current) > threshold;

      if (needsSeek) {
        lastSeekTimeRef.current = validTime;
        seek(validTime);
      }
    }
  }, [trimRange, currentTime, videoUrl, clampToVisibleRange, seek]);

  // Auto-update selected layer based on which keyframes are at current position
  // Selection state (selectedCropKeyframeIndex, selectedHighlightKeyframeIndex) is now
  // derived via useMemo, eliminating race conditions between auto and manual selection
  useEffect(() => {
    if (!videoUrl) return;

    const hasCropKeyframe = selectedCropKeyframeIndex !== null;
    const hasHighlightKeyframe = selectedHighlightKeyframeIndex !== null;

    // Update selected layer based on what's available
    // Only change layer if current layer has no keyframe but another does
    if (hasCropKeyframe && hasHighlightKeyframe) {
      // Both have keyframes - keep current layer selection, but ensure it's a keyframe layer
      if (selectedLayer === 'playhead') {
        setSelectedLayer('crop'); // Default to crop when coming from playhead
      }
    } else if (hasCropKeyframe && !hasHighlightKeyframe) {
      // Only crop has keyframe
      if (selectedLayer !== 'crop') {
        setSelectedLayer('crop');
      }
    } else if (!hasCropKeyframe && hasHighlightKeyframe) {
      // Only highlight has keyframe
      if (selectedLayer !== 'highlight') {
        setSelectedLayer('highlight');
      }
    }
    // If neither has keyframe, don't change selectedLayer
  }, [selectedCropKeyframeIndex, selectedHighlightKeyframeIndex, videoUrl, selectedLayer]);

  // NOTE: handleCopyCrop/handlePasteCrop and handleCropChange/handleCropComplete/handleKeyframeClick/handleKeyframeDelete
  // are now provided by FramingContainer and accessed via framingHandle* versions
  // NOTE: handleHighlightChange and handleHighlightComplete are provided by OverlayContainer

  // Keyboard shortcuts (space bar, copy/paste, arrow keys)
  // @see hooks/useKeyboardShortcuts.js for implementation
  // NOTE: Annotate mode keyboard shortcuts are now handled inside AnnotateScreen
  // to avoid duplicate state. We pass null for annotate-related props here.
  useKeyboardShortcuts({
    hasVideo: Boolean(videoUrl || effectiveOverlayVideoUrl) || editorMode === 'annotate',
    togglePlay,
    stepForward,
    stepBackward,
    seek,
    editorMode,
    selectedLayer,
    copiedCrop,
    onCopyCrop: framingHandleCopyCrop,
    onPasteCrop: framingHandlePasteCrop,
    keyframes,
    framerate,
    selectedCropKeyframeIndex,
    highlightKeyframes,
    highlightFramerate,
    selectedHighlightKeyframeIndex,
    isHighlightEnabled,
    // Annotate mode props - keyboard handling is now in AnnotateScreen
    annotateVideoUrl: null,
    annotateSelectedLayer: null,
    clipRegions: [],
    annotateSelectedRegionId: null,
    selectAnnotateRegion: null,
  });

  /**
   * Handle transition from Framing to Overlay mode
   * Called when user exports from Framing mode
   * @param {Blob} renderedVideoBlob - The rendered video from framing export
   * @param {Object|null} clipMetadata - Optional clip metadata for auto-generating highlight regions
   */
  const handleProceedToOverlay = async (renderedVideoBlob, clipMetadata = null) => {
    try {
      // Flush any pending framing saves to database before transitioning
      // This ensures framing data is persisted if user refreshes after going to overlay
      if (selectedClipId && pendingFramingSaveRef.current) {
        clearTimeout(pendingFramingSaveRef.current);
        pendingFramingSaveRef.current = null;
        await framingSaveCurrentClipState();
      }

      // Create URL for the rendered video
      const url = URL.createObjectURL(renderedVideoBlob);

      // Extract metadata from the rendered video
      const meta = await extractVideoMetadata(renderedVideoBlob);

      // Clean up old overlay video URL if exists
      if (overlayVideoUrl) {
        URL.revokeObjectURL(overlayVideoUrl);
      }

      // Set overlay video state
      setOverlayVideoFile(renderedVideoBlob);
      setOverlayVideoUrl(url);
      setOverlayVideoMetadata(meta);

      // Store clip metadata for auto-generating highlight regions
      setOverlayClipMetadata(clipMetadata);

      // Save the current framing state snapshot (for comparison later)
      exportedFramingStateRef.current = {
        keyframesHash: JSON.stringify(keyframes),
        segmentsHash: JSON.stringify(segments),
        clipsCount: clips.length,
      };

      // Clear the "framing changed" flag since we just exported
      setFramingChangedSinceExport(false);

      // Reset highlight state for fresh start in overlay mode
      resetHighlight();
      resetHighlightRegions();

      // Switch to overlay mode
      setEditorMode('overlay');

      // Wait for video element to load the new source, then seek to beginning
      // Use a small delay to allow React to update and video to start loading
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.currentTime = 0;
          // Also pause to ensure it's ready to play from the start
          videoRef.current.pause();
        }
      }, 100);

      console.log('[App] Transitioned to Overlay mode with rendered video:', {
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        aspectRatio: meta.aspectRatio,
        hasClipMetadata: !!clipMetadata,
        clipCount: clipMetadata?.source_clips?.length || 0,
      });
    } catch (err) {
      console.error('[App] Failed to transition to Overlay mode:', err);
      throw err; // Re-throw so ExportButton can show error
    }
  };

  /**
   * Handle mode change between Framing and Overlay
   *
   * IMPORTANT: Do NOT reload videos when switching modes!
   * - Framing video (videoUrl) persists even when viewing overlay
   * - Overlay video (effectiveOverlayVideoUrl) persists even when viewing framing
   * - Reloading would reset all crop/segment/highlight state
   *
   * The VideoPlayer uses currentVideoState.url (from useCurrentVideoState hook)
   * which automatically selects the correct video based on editorMode.
   *
   * Pass-through behavior: If no framing edits were made AND only a single clip,
   * the original video is used directly in overlay mode (via effectiveOverlayVideoUrl).
   * Multiple clips always require export to combine them first.
   */

  // ============================================================================
  // Overlay Data Persistence
  // ============================================================================

  /**
   * Save overlay data to backend (debounced)
   */
  const saveOverlayData = useCallback(async (data) => {
    // Don't save if no project or not in overlay mode
    if (!selectedProjectId || editorMode !== 'overlay') return;

    // Cancel pending debounced save
    if (pendingOverlaySaveRef.current) {
      clearTimeout(pendingOverlaySaveRef.current);
    }

    // Debounce: wait 2 seconds after last change
    pendingOverlaySaveRef.current = setTimeout(async () => {
      const saveProjectId = selectedProjectId; // Capture for closure

      try {
        const formData = new FormData();
        formData.append('highlights_data', JSON.stringify(data.highlightRegions || []));
        formData.append('text_overlays', JSON.stringify(data.textOverlays || []));
        formData.append('effect_type', data.effectType || 'original');

        await fetch(`${API_BASE}/api/export/projects/${saveProjectId}/overlay-data`, {
          method: 'PUT',
          body: formData
        });

        console.log('[App] Overlay data saved for project:', saveProjectId);
      } catch (e) {
        console.error('[App] Failed to save overlay data:', e);
      }
    }, 2000);
  }, [selectedProjectId, editorMode]);

  /**
   * Load overlay data from backend
   */
  const loadOverlayData = useCallback(async (projectId, videoDuration) => {
    if (!projectId) return;

    try {
      console.log('[App] Loading overlay data for project:', projectId);
      const response = await fetch(
        `${API_BASE}/api/export/projects/${projectId}/overlay-data`
      );
      const data = await response.json();

      if (data.has_data && data.highlights_data?.length > 0) {
        // Restore highlight regions
        restoreHighlightRegions(data.highlights_data, videoDuration);
        console.log('[App] Restored', data.highlights_data.length, 'highlight regions');
      }
      // Restore effect type
      if (data.effect_type) {
        setHighlightEffectType(data.effect_type);
      }

      overlayDataLoadedRef.current = true;
    } catch (e) {
      console.error('[App] Failed to load overlay data:', e);
    }
  }, [restoreHighlightRegions, setHighlightEffectType]);

  /**
   * Load overlay data when entering overlay mode
   */
  useEffect(() => {
    const effectiveDuration = overlayVideoMetadata?.duration || metadata?.duration;
    if (editorMode === 'overlay' && selectedProjectId && !overlayDataLoadedRef.current && effectiveDuration) {
      loadOverlayData(selectedProjectId, effectiveDuration);
    }

    // Reset loaded flag when leaving overlay mode or changing project
    if (editorMode !== 'overlay') {
      overlayDataLoadedRef.current = false;
    }
  }, [editorMode, selectedProjectId, loadOverlayData, overlayVideoMetadata?.duration, metadata?.duration]);

  /**
   * Auto-save overlay data when highlight regions or effect type changes
   */
  useEffect(() => {
    // Only save after initial load and when in overlay mode
    if (editorMode === 'overlay' && overlayDataLoadedRef.current && selectedProjectId) {
      saveOverlayData({
        highlightRegions: getRegionsForExport(),
        textOverlays: [], // Add when text overlays implemented
        effectType: highlightEffectType
      });
    }
  }, [highlightRegions, highlightEffectType, editorMode, selectedProjectId, saveOverlayData, getRegionsForExport]);

  // NOTE: User edit tracking reset and auto-save useEffects are now in FramingContainer

  /**
   * Save all pending changes before browser close or navigation
   */
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Flush any pending saves immediately
      if (pendingFramingSaveRef.current) {
        clearTimeout(pendingFramingSaveRef.current);
        pendingFramingSaveRef.current = null;
        // Synchronous save using navigator.sendBeacon for reliability
        if (selectedClipId && selectedProjectId) {
          const currentClip = clips.find(c => c.id === selectedClipId);
          if (currentClip?.workingClipId) {
            const segmentState = {
              boundaries: segmentBoundaries,
              segmentSpeeds: segmentSpeeds,
              trimRange: trimRange,
            };
            const payload = {
              crop_data: JSON.stringify(keyframes),
              segments_data: JSON.stringify(segmentState),
              timing_data: JSON.stringify({ trimRange })
            };
            // Use sendBeacon for reliable async save on page unload
            const url = `${API_BASE}/api/clips/projects/${selectedProjectId}/clips/${currentClip.workingClipId}`;
            navigator.sendBeacon(url, JSON.stringify(payload));
          }
        }
      }

      if (pendingOverlaySaveRef.current) {
        clearTimeout(pendingOverlaySaveRef.current);
        pendingOverlaySaveRef.current = null;
        if (selectedProjectId) {
          const formData = new FormData();
          formData.append('highlights_data', JSON.stringify(getRegionsForExport() || []));
          formData.append('text_overlays', JSON.stringify([]));
          formData.append('effect_type', highlightEffectType || 'original');
          // Use fetch with keepalive for FormData
          fetch(`${API_BASE}/api/export/projects/${selectedProjectId}/overlay-data`, {
            method: 'PUT',
            body: formData,
            keepalive: true
          }).catch(() => {});
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [selectedClipId, selectedProjectId, clips, segmentBoundaries, segmentSpeeds, trimRange, keyframes, getRegionsForExport, highlightEffectType]);

  /**
   * Track when framing edits are made (for showing warning on Overlay button)
   * Compares current framing state against the state that produced the overlay video
   */
  const exportedFramingStateRef = useRef(null);
  useEffect(() => {
    // Clear exported state if no overlay video
    if (!overlayVideoUrl) {
      exportedFramingStateRef.current = null;
      return;
    }

    // If we have an overlay video but no exported state, capture the current loaded state
    // This handles the case of loading a project that was exported in a previous session
    if (!exportedFramingStateRef.current) {
      // Only capture if we have actual framing data loaded (not default/empty state)
      const hasLoadedData = keyframes.length > 0 || (segments.boundaries && segments.boundaries.length > 1);
      if (hasLoadedData) {
        console.log("[App] Capturing loaded framing state as exported baseline (existing working video)");
        exportedFramingStateRef.current = {
          keyframesHash: JSON.stringify(keyframes),
          segmentsHash: JSON.stringify(segments),
          clipsCount: clips.length,
        };
      }
      return;
    }

    // Only check for changes when in framing mode
    if (editorMode !== 'framing') {
      return;
    }

    // Create current state snapshot
    const currentState = {
      keyframesHash: JSON.stringify(keyframes),
      segmentsHash: JSON.stringify(segments),
      clipsCount: clips.length,
    };

    // Compare current state against the exported state
    const hasChanged =
      currentState.keyframesHash !== exportedFramingStateRef.current.keyframesHash ||
      currentState.segmentsHash !== exportedFramingStateRef.current.segmentsHash ||
      currentState.clipsCount !== exportedFramingStateRef.current.clipsCount;

    // Update flag based on comparison
    if (hasChanged !== framingChangedSinceExport) {
      if (hasChanged) {
        console.log('[App] Framing state differs from exported state - marking overlay as out of sync');
      } else {
        console.log('[App] Framing state matches exported state - clearing out of sync flag');
      }
      setFramingChangedSinceExport(hasChanged);
    }
  }, [keyframes, segments, clips.length, editorMode, overlayVideoUrl, framingChangedSinceExport]);

  const handleModeChange = useCallback((newMode) => {
    if (newMode === editorMode) return;

    console.log(`[App] Switching from ${editorMode} to ${newMode} mode`);

    // Check if switching from framing to overlay with uncommitted changes
    // This would invalidate the existing working video
    if (editorMode === 'framing' && newMode === 'overlay' && overlayVideoUrl && framingChangedSinceExport) {
      console.log('[App] Uncommitted framing changes detected - showing confirmation dialog');
      openModeSwitchDialog('overlay');
      return; // Don't switch yet - wait for dialog action
    }

    // Flush any pending saves before switching modes

    // Flush overlay save if leaving overlay mode
    if (editorMode === 'overlay' && pendingOverlaySaveRef.current) {
      clearTimeout(pendingOverlaySaveRef.current);
      pendingOverlaySaveRef.current = null;
      if (selectedProjectId) {
        const formData = new FormData();
        formData.append('highlights_data', JSON.stringify(getRegionsForExport() || []));
        formData.append('text_overlays', JSON.stringify([]));
        formData.append('effect_type', highlightEffectType || 'original');
        fetch(`${API_BASE}/api/export/projects/${selectedProjectId}/overlay-data`, {
          method: 'PUT',
          body: formData
        }).catch(e => console.error('[App] Failed to flush overlay save:', e));
      }
    }

    // Flush framing save if leaving framing mode
    if (editorMode === 'framing' && pendingFramingSaveRef.current) {
      clearTimeout(pendingFramingSaveRef.current);
      pendingFramingSaveRef.current = null;
      // Fire immediate save (non-debounced)
      framingSaveCurrentClipState().catch(e => console.error('[App] Failed to flush framing save:', e));
    }

    // Switch the mode
    setEditorMode(newMode);

    // Force video element to reload source when switching back to framing
    // This fixes the blank video issue when returning from overlay mode
    if (newMode === 'framing') {
      setTimeout(async () => {
        // If we have clips, ALWAYS reload the selected clip to ensure it's showing
        if (hasClips && clips.length > 0 && selectedProjectId) {
          const clipToLoad = selectedClip || clips[0];
          // Use workingClipId (database ID) not id (temporary local ID)
          if (clipToLoad?.workingClipId) {
            console.log('[App] Switching to framing mode - reloading clip video:', clipToLoad.workingClipId);
            const clipUrl = getClipFileUrl(clipToLoad.workingClipId, selectedProjectId);

            try {
              await loadVideoFromUrl(clipUrl, clipToLoad.fileName || 'clip.mp4');

              // Restore framing state from clip data
              if (clipToLoad.segments || clipToLoad.cropKeyframes) {
                console.log('[App] Restoring framing state for clip:', clipToLoad.id);

                // Restore segments if saved
                if (clipToLoad.segments) {
                  restoreSegmentState(clipToLoad.segments, clipToLoad.duration);
                }

                // Restore crop keyframes if saved
                if (clipToLoad.cropKeyframes && clipToLoad.cropKeyframes.length > 0) {
                  const endFrame = Math.round(clipToLoad.duration * (clipToLoad.framerate || 30));
                  restoreCropState(clipToLoad.cropKeyframes, endFrame);
                }
              }
            } catch (e) {
              console.error('[App] Failed to reload clip video:', e);
            }
          }
        }
      }, 100);
    }
  }, [editorMode, selectedProjectId, getRegionsForExport, highlightEffectType, framingSaveCurrentClipState, videoRef, videoUrl, currentTime, hasClips, clips, selectedClip, loadVideoFromUrl, getClipFileUrl, restoreSegmentState, restoreCropState, overlayVideoUrl, framingChangedSinceExport]);

  /**
   * Mode switch dialog handlers
   */
  const handleModeSwitchCancel = useCallback(() => {
    closeModeSwitchDialog();
  }, []);

  const handleModeSwitchExport = useCallback(() => {
    // Close dialog and trigger export
    closeModeSwitchDialog();
    console.log('[App] User chose to export first - triggering export');

    // Trigger export via ref (this will export and then proceed to overlay mode via onProceedToOverlay)
    if (exportButtonRef.current?.triggerExport) {
      exportButtonRef.current.triggerExport();
    }
  }, []);

  const handleModeSwitchDiscard = useCallback(async () => {
    // Restore clip states from backend (discard uncommitted changes)
    if (selectedProjectId) {
      try {
        console.log('[App] Discarding framing changes - calling backend to discard uncommitted');

        // Tell backend to delete uncommitted clip versions
        await discardUncommittedChanges(selectedProjectId);

        // Fetch fresh clip data from backend (now returns previous exported versions)
        const freshClips = await fetchProjectClips(selectedProjectId);

        // Reload clips with their saved state (this will clear local changes)
        if (freshClips.length > 0) {
          await loadProjectClips(
            freshClips,
            (clipId) => getClipFileUrl(clipId, selectedProjectId),
            extractVideoMetadataFromUrl,
            selectedProject?.aspect_ratio || '9:16'
          );
        }

        // Don't reset exportedFramingStateRef here - keep the original exported state (v1)
        // The restored clip state (also v1) will match the ref, so hasChanged will be false

        // Clear the changed flag
        setFramingChangedSinceExport(false);

        // Now switch to overlay mode
        closeModeSwitchDialog();
        setEditorMode('overlay');
      } catch (err) {
        console.error('[App] Failed to restore clip states:', err);
        closeModeSwitchDialog();
      }
    } else {
      closeModeSwitchDialog();
    }
  }, [selectedProjectId, fetchProjectClips, loadProjectClips, getClipFileUrl, selectedProject, discardUncommittedChanges]);

  // Prepare crop context value
  const cropContextValue = useMemo(() => ({
    keyframes,
    isEndKeyframeExplicit,
    aspectRatio,
    copiedCrop,
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
  }), [keyframes, isEndKeyframeExplicit, aspectRatio, copiedCrop, updateAspectRatio, addOrUpdateKeyframe, removeKeyframe, copyCropKeyframe, pasteCropKeyframe, interpolateCrop, hasKeyframeAt]);

  // Backward-compatible wrapper for setExportingProject
  // Components should migrate to using useExportStore directly
  const setExportingProject = useCallback((value) => {
    if (value === null) {
      clearExport();
    } else {
      startExport(value.projectId, value.stage, value.exportId);
    }
  }, [clearExport, startExport]);

  // App-level shared state for context (reduces prop drilling to ExportButton, ModeSwitcher, ProjectManager)
  const appStateValue = useMemo(() => ({
    // Editor mode
    editorMode,
    setEditorMode,

    // Project state
    selectedProjectId,
    selectedProject,

    // Export progress
    exportingProject,
    setExportingProject,
    globalExportProgress,
    setGlobalExportProgress,

    // Downloads
    downloadsCount,
    refreshDownloadsCount,
  }), [
    editorMode,
    selectedProjectId,
    selectedProject,
    exportingProject,
    setExportingProject,
    globalExportProgress,
    downloadsCount,
    refreshDownloadsCount,
  ]);

  /**
   * Get filtered keyframes for export
   * Includes keyframes within trim range PLUS surrounding keyframes for proper interpolation
   */
  const getFilteredKeyframesForExport = useMemo(() => {
    const allKeyframes = getKeyframesForExport();
    const segmentData = getSegmentExportData();

    // If no trimming, return all keyframes
    if (!segmentData || (!segmentData.trim_start && !segmentData.trim_end)) {
      return allKeyframes;
    }

    const trimStart = segmentData.trim_start || 0;
    const trimEnd = segmentData.trim_end || duration || Infinity;

    // Find keyframes needed for proper interpolation:
    // 1. All keyframes within trim range
    // 2. Last keyframe BEFORE trim start (for interpolation at trim start)
    // 3. First keyframe AFTER trim end (for interpolation at trim end)
    let lastBeforeTrimStart = null;
    let firstAfterTrimEnd = null;
    const keyframesInRange = [];

    allKeyframes.forEach(kf => {
      if (kf.time >= trimStart && kf.time <= trimEnd) {
        // Keyframe is within trim range
        keyframesInRange.push(kf);
      } else if (kf.time < trimStart) {
        // Track last keyframe before trim start
        if (!lastBeforeTrimStart || kf.time > lastBeforeTrimStart.time) {
          lastBeforeTrimStart = kf;
        }
      } else if (kf.time > trimEnd) {
        // Track first keyframe after trim end
        if (!firstAfterTrimEnd || kf.time < firstAfterTrimEnd.time) {
          firstAfterTrimEnd = kf;
        }
      }
    });

    // Combine all needed keyframes
    const filtered = [
      ...(lastBeforeTrimStart ? [lastBeforeTrimStart] : []),
      ...keyframesInRange,
      ...(firstAfterTrimEnd ? [firstAfterTrimEnd] : [])
    ];

    // Debug log (disabled - too spammy)
    // console.log('[App] Filtered keyframes for export:', {
    //   original: allKeyframes.length,
    //   filtered: filtered.length,
    //   trimStart,
    //   trimEnd,
    //   includedBefore: !!lastBeforeTrimStart,
    //   includedAfter: !!firstAfterTrimEnd
    // });

    return filtered;
  }, [getKeyframesForExport, getSegmentExportData, duration]);

  // If no project selected and not in annotate mode, show ProjectManager
  if (!selectedProject && editorMode !== 'annotate') {
    return (
      <AppStateProvider value={appStateValue}>
      <div className="min-h-screen bg-gray-900">
        {/* Hidden file input for Annotate Game - triggers navigation to annotate mode */}
        <input
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              clearSelection();
              // Store file to pass to AnnotateScreen
              setPendingAnnotateFile(file);
              setEditorMode('annotate');
            }
            // Reset input so same file can be selected again
            e.target.value = '';
          }}
          id="annotate-file-input"
        />
        <ProjectManager
          projects={projects}
          loading={projectsLoading}
          onSelectProject={async (id) => {
            console.log('[App] Selecting project:', id);
            const project = await selectProject(id);

            // Update last_opened_at timestamp (non-blocking)
            fetch(`${API_BASE}/api/projects/${id}/state?update_last_opened=true`, {
              method: 'PATCH'
            }).catch(e => console.error('[App] Failed to update last_opened_at:', e));

            // Derive mode from project state:
            // - If working_video_id exists → framing is complete, open in overlay mode
            // - Otherwise → open in framing mode
            const initialMode = project?.working_video_id ? 'overlay' : 'framing';
            setEditorMode(initialMode);

            // Clear all state before loading new project to prevent stale data
            clearClips();
            resetCrop();
            resetSegments();
            resetHighlightRegions();  // Clear stale highlight regions
            setVideoFile(null);
            setOverlayClipMetadata(null);  // Clear stale clip metadata
            overlayDataLoadedRef.current = false;  // Reset so overlay data is loaded for new project

            // Set crop aspect ratio to match project BEFORE loading video
            const projectAspectRatio = project?.aspect_ratio || '9:16';
            updateAspectRatio(projectAspectRatio);

            // Fetch clips for the project - pass project ID explicitly since React state may not have updated yet
            const projectClipsData = await fetchProjectClips(id);
            console.log('[App] Fetched project clips:', projectClipsData);

            if (projectClipsData && projectClipsData.length > 0) {
              // Helper to get video metadata from URL
              const getMetadataFromUrl = async (url) => {
                return await extractVideoMetadataFromUrl(url);
              };

              // Helper to get clip URL with explicit project ID
              const getClipUrl = (clipId) => getClipFileUrl(clipId, id);

              // Load all clips into the clip manager
              console.log('[App] Loading clips into clip manager...');
              await loadProjectClips(
                projectClipsData,
                getClipUrl,
                getMetadataFromUrl,
                projectAspectRatio
              );

              // Load the first clip for video playback
              const firstClip = projectClipsData[0];
              const clipUrl = getClipFileUrl(firstClip.id, id);
              console.log('[App] Loading first clip for playback:', firstClip.id, clipUrl);
              const loadedFile = await loadVideoFromUrl(clipUrl, firstClip.filename || 'clip.mp4');
              if (loadedFile) {
                setVideoFile(loadedFile); // Update App's videoFile state for export
              }

              // BUGFIX: Restore first clip's framing state from persisted data
              // The loadProjectClips loads data into useClipManager, but we also need
              // to restore the crop/segment state to the useCrop/useSegments hooks
              if (firstClip.segments_data || firstClip.crop_data) {
                console.log('[App] Restoring first clip framing state from persistence');

                // Get video metadata for duration
                const firstClipMetadata = await extractVideoMetadataFromUrl(clipUrl);

                // Restore segments if saved
                if (firstClip.segments_data) {
                  try {
                    const savedSegments = JSON.parse(firstClip.segments_data);
                    console.log('[App] Restoring segment state:', savedSegments);
                    restoreSegmentState(savedSegments, firstClipMetadata?.duration || 0);
                  } catch (e) {
                    console.warn('[App] Failed to parse segments_data:', e);
                  }
                }

                // Restore crop keyframes if saved
                if (firstClip.crop_data) {
                  try {
                    const savedCropKeyframes = JSON.parse(firstClip.crop_data);
                    if (savedCropKeyframes.length > 0) {
                      const endFrame = Math.round((firstClipMetadata?.duration || 0) * (firstClipMetadata?.framerate || 30));
                      console.log('[App] Restoring crop keyframes:', savedCropKeyframes.length, 'keyframes, endFrame:', endFrame);
                      restoreCropState(savedCropKeyframes, endFrame);
                    }
                  } catch (e) {
                    console.warn('[App] Failed to parse crop_data:', e);
                  }
                }
              }
            }

            // Load working video in background if it exists (enables Overlay mode)
            // This runs in background to avoid blocking project load
            if (project?.working_video_id) {
              console.log('[App] Project has working video, loading in background:', project.working_video_id);
              setIsLoadingWorkingVideo(true);

              // Load in background (non-blocking)
              (async () => {
                try {
                  const workingVideoUrl = `${API_BASE}/api/projects/${id}/working-video`;
                  const response = await fetch(workingVideoUrl);
                  if (response.ok) {
                    const blob = await response.blob();
                    const workingVideoBlob = new File([blob], 'working_video.mp4', { type: 'video/mp4' });
                    const workingVideoObjectUrl = URL.createObjectURL(workingVideoBlob);
                    const workingVideoMeta = await extractVideoMetadata(workingVideoBlob);

                    // Set overlay video state
                    setOverlayVideoFile(workingVideoBlob);
                    setOverlayVideoUrl(workingVideoObjectUrl);
                    setOverlayVideoMetadata(workingVideoMeta);

                    // Calculate clip metadata for auto-generating default highlights
                    // This enables the useEffect that creates 5-second highlight regions at clip boundaries
                    if (projectClipsData && projectClipsData.length > 0) {
                      const clipMetadata = buildClipMetadataFromProjectClips(projectClipsData);
                      if (clipMetadata) {
                        console.log('[App] Setting clip metadata for overlay mode:', clipMetadata);
                        setOverlayClipMetadata(clipMetadata);
                      }
                    }

                    // Don't set exportedFramingStateRef here - we don't know what framing
                    // state produced this existing working video. The ref should only be set
                    // when we actually export (in handleExportWorkingVideo). This means the
                    // asterisk won't appear until the user makes actual changes after a fresh export.

                    console.log('[App] Loaded working video for overlay mode');
                  } else {
                    console.warn('[App] Failed to load working video:', response.status);
                  }
                } catch (err) {
                  console.error('[App] Error loading working video:', err);
                } finally {
                  setIsLoadingWorkingVideo(false);
                }
              })();
            }
          }}
          onSelectProjectWithMode={async (id, options) => {
            console.log('[App] Selecting project with mode:', id, options);
            const project = await selectProject(id);

            // Update last_opened_at timestamp (non-blocking)
            fetch(`${API_BASE}/api/projects/${id}/state?update_last_opened=true`, {
              method: 'PATCH'
            }).catch(e => console.error('[App] Failed to update last_opened_at:', e));

            // Use specified mode or derive from project state
            const targetMode = options?.mode || (project?.working_video_id ? 'overlay' : 'framing');
            setEditorMode(targetMode);

            // Clear all state before loading new project
            clearClips();
            resetCrop();
            resetSegments();
            resetHighlightRegions();  // Clear stale highlight regions
            setVideoFile(null);
            setOverlayClipMetadata(null);  // Clear stale clip metadata
            overlayDataLoadedRef.current = false;  // Reset so overlay data is loaded for new project

            // Set crop aspect ratio to match project
            const projectAspectRatio = project?.aspect_ratio || '9:16';
            updateAspectRatio(projectAspectRatio);

            // Fetch clips for the project
            const projectClipsData = await fetchProjectClips(id);
            console.log('[App] Fetched project clips:', projectClipsData);

            if (projectClipsData && projectClipsData.length > 0) {
              const getMetadataFromUrl = async (url) => await extractVideoMetadataFromUrl(url);
              const getClipUrl = (clipId) => getClipFileUrl(clipId, id);

              // Load all clips into the clip manager
              await loadProjectClips(projectClipsData, getClipUrl, getMetadataFromUrl, projectAspectRatio);

              // Determine which clip to load
              const clipIndex = options?.clipIndex ?? 0;
              const targetClip = projectClipsData[Math.min(clipIndex, projectClipsData.length - 1)];
              const clipUrl = getClipFileUrl(targetClip.id, id);
              console.log('[App] Loading clip at index', clipIndex, ':', targetClip.id);

              const loadedFile = await loadVideoFromUrl(clipUrl, targetClip.filename || 'clip.mp4');
              if (loadedFile) {
                setVideoFile(loadedFile);
              }

              // Restore clip's framing state
              if (targetClip.segments_data || targetClip.crop_data) {
                const clipMetadata = await extractVideoMetadataFromUrl(clipUrl);

                if (targetClip.segments_data) {
                  try {
                    const savedSegments = JSON.parse(targetClip.segments_data);
                    restoreSegmentState(savedSegments, clipMetadata?.duration || 0);
                  } catch (e) {
                    console.warn('[App] Failed to parse segments_data:', e);
                  }
                }

                if (targetClip.crop_data) {
                  try {
                    const savedCropKeyframes = JSON.parse(targetClip.crop_data);
                    if (savedCropKeyframes.length > 0) {
                      const endFrame = Math.round((clipMetadata?.duration || 0) * (clipMetadata?.framerate || 30));
                      restoreCropState(savedCropKeyframes, endFrame);
                    }
                  } catch (e) {
                    console.warn('[App] Failed to parse crop_data:', e);
                  }
                }
              }

              // Note: The video for the target clip is already loaded above.
              // Sidebar selection will sync when clips state updates.
            }

            // Load working video in background if it exists
            if (project?.working_video_id) {
              setIsLoadingWorkingVideo(true);
              (async () => {
                try {
                  const response = await fetch(`${API_BASE}/api/projects/${id}/working-video`);
                  if (response.ok) {
                    const workingVideoBlob = await response.blob();
                    const workingVideoObjectUrl = URL.createObjectURL(workingVideoBlob);
                    const workingVideoMeta = await extractVideoMetadata(workingVideoBlob);
                    setOverlayVideoFile(workingVideoBlob);
                    setOverlayVideoUrl(workingVideoObjectUrl);
                    setOverlayVideoMetadata(workingVideoMeta);

                    // Calculate clip metadata for auto-generating default highlights
                    if (projectClipsData && projectClipsData.length > 0) {
                      const clipMetadata = buildClipMetadataFromProjectClips(projectClipsData);
                      if (clipMetadata) {
                        console.log('[App] Setting clip metadata for overlay mode:', clipMetadata);
                        setOverlayClipMetadata(clipMetadata);
                      }
                    }

                    console.log('[App] Loaded working video for overlay mode');
                  }
                } catch (err) {
                  console.error('[App] Error loading working video:', err);
                } finally {
                  setIsLoadingWorkingVideo(false);
                }
              })();
            }
          }}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
          onAnnotate={() => {
            // Trigger file picker - when file selected, onChange navigates to annotate mode
            document.getElementById('annotate-file-input')?.click();
          }}
          // Games props
          games={games}
          gamesLoading={gamesLoading}
          onLoadGame={handleLoadGame}
          onDeleteGame={deleteGame}
          onFetchGames={fetchGames}
          // Note: downloadsCount and exportingProject are now from AppStateContext
          onOpenDownloads={() => setIsDownloadsPanelOpen(true)}
        />

        {/* Downloads Panel - also available from Project Manager */}
        <DownloadsPanel
          isOpen={isDownloadsPanelOpen}
          onClose={() => setIsDownloadsPanelOpen(false)}
          onOpenProject={(projectId) => {
            // Navigate to project in overlay mode
            selectProject(projectId);
            setEditorMode('overlay');
            setIsDownloadsPanelOpen(false);
          }}
          onCountChange={refreshDownloadsCount}
        />
      </div>
      </AppStateProvider>
    );
  }

  return (
    <AppStateProvider value={appStateValue}>
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex">
      {/* Sidebar - Framing mode (when clips exist) */}
      {hasClips && clips.length > 0 && editorMode === 'framing' && (
        <ClipSelectorSidebar
          clips={clips}
          selectedClipId={selectedClipId}
          onSelectClip={handleSelectClip}
          onAddClip={handleAddClipFromSidebar}
          onDeleteClip={handleDeleteClip}
          onReorderClips={reorderClips}
          globalTransition={globalTransition}
          onTransitionChange={setGlobalTransition}
        />
      )}

      {/* Annotate mode: AnnotateScreen handles its own sidebar + main content */}
      {editorMode === 'annotate' && (
        <AnnotateScreen
          // Navigation
          onNavigate={setEditorMode}
          onBackToProjects={() => setEditorMode('project-manager')}
          // Settings modal
          onOpenProjectCreationSettings={() => setShowProjectCreationSettings(true)}
          // Downloads
          downloadsCount={downloadsCount}
          onOpenDownloads={() => setIsDownloadsPanelOpen(true)}
          // Shared refs
          videoRef={videoRef}
          // Initial file from ProjectManager (if user selected file before navigating)
          initialFile={pendingAnnotateFile}
          onInitialFileHandled={() => setPendingAnnotateFile(null)}
          // Initial game ID (when loading a saved game from ProjectManager)
          initialGameId={pendingGameId}
          onInitialGameHandled={() => setPendingGameId(null)}
          // Game management hooks
          createGame={createGame}
          uploadGameVideo={uploadGameVideo}
          getGame={getGame}
          getGameVideoUrl={getGameVideoUrl}
          saveAnnotationsDebounced={saveAnnotationsDebounced}
          // Project hooks
          fetchProjects={fetchProjects}
          projectCreationSettings={projectCreationSettings}
          // Export state
          exportProgress={exportProgress}
        />
      )}

      {/* Main Content - For framing/overlay modes */}
      {editorMode !== 'annotate' && (
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              {/* Back to Projects button - show in all editor modes */}
              {(editorMode === 'annotate' || editorMode === 'framing' || editorMode === 'overlay') && (
                <button
                  onClick={() => {
                    // Clear project selection
                    clearSelection();
                    // Note: Annotate state is now owned by AnnotateScreen and will be
                    // cleaned up when the screen unmounts (mode changes)
                    // Refresh project list to show updated progress/status
                    fetchProjects();
                    // Return to project manager
                    setEditorMode('project-manager');
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  ← Projects
                </button>
              )}
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">
                  {editorMode === 'annotate' ? 'Annotate Game' : 'Player Showcase'}
                </h1>
                <p className="text-gray-400">
                  {editorMode === 'annotate'
                    ? 'Mark clips to extract from your game footage'
                    : 'Showcase your player\'s brilliance'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Gallery button - always visible */}
              <button
                onClick={() => setIsDownloadsPanelOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 rounded-lg transition-colors"
                title="Gallery"
              >
                <Image size={18} className="text-purple-400" />
                <span className="text-sm text-gray-400">Gallery</span>
                {downloadsCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
                    {downloadsCount > 9 ? '9+' : downloadsCount}
                  </span>
                )}
              </button>
              {/* AspectRatioSelector - only in Framing mode when video is loaded */}
              {/* Read-only when a project is selected (aspect ratio is set at project level) */}
              {editorMode === 'framing' && videoUrl && (
                <AspectRatioSelector
                  aspectRatio={selectedProject?.aspect_ratio || globalAspectRatio || aspectRatio}
                  onAspectRatioChange={selectedProject ? null : (hasClips ? (newRatio) => {
                    setGlobalAspectRatio(newRatio);
                    updateAspectRatio(newRatio);
                  } : updateAspectRatio)}
                  readOnly={!!selectedProject}
                />
              )}
              {/* Mode toggle - project-aware visibility */}
              <ModeSwitcher
                mode={editorMode}
                onModeChange={handleModeChange}
                disabled={isLoading}
                hasOverlayVideo={!!overlayVideoUrl}
                framingOutOfSync={framingChangedSinceExport && !!overlayVideoUrl}
                hasAnnotateVideo={editorMode === 'annotate'}  // AnnotateScreen handles its own video state
                isLoadingWorkingVideo={isLoadingWorkingVideo}
                // Note: hasProject and hasWorkingVideo are now from AppStateContext
              />
              {/* Annotate mode file upload is now handled by AnnotateScreen */}
            </div>
          </div>

        {/* Mode-specific views */}
        {editorMode === 'framing' && (
          <FramingScreen
            // Project context
            projectId={selectedProjectId}
            project={selectedProject}
            // Export callback
            onExportComplete={() => {
              fetchProjects();
              refreshDownloadsCount();
            }}
            // Shared video state (from App.jsx)
            videoRef={videoRef}
            videoUrl={videoUrl}
            metadata={metadata}
            videoFile={videoFile}
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            isLoading={isLoading}
            error={error}
            handlers={handlers}
            loadVideo={loadVideo}
            loadVideoFromUrl={loadVideoFromUrl}
            togglePlay={togglePlay}
            seek={seek}
            stepForward={stepForward}
            stepBackward={stepBackward}
            restart={restart}
            setVideoFile={setVideoFile}
            // Highlight hook (for coordinated trim operations)
            highlightHook={{
              deleteHighlightKeyframesInRange,
              cleanupHighlightTrimKeyframes,
            }}
            // Audio settings
            includeAudio={includeAudio}
            onIncludeAudioChange={setIncludeAudio}
            // Overlay transition handler
            onProceedToOverlay={handleProceedToOverlay}
          />
        )}

        {editorMode === 'overlay' && (
          <OverlayScreen
            // Project context
            projectId={selectedProjectId}
            project={selectedProject}
            // Navigation
            onNavigate={setEditorMode}
            onSwitchToFraming={() => handleModeChange('framing')}
            // Export callback
            onExportComplete={() => {
              fetchProjects();
              refreshDownloadsCount();
            }}
            // Shared refs
            videoRef={videoRef}
            // Framing data (for pass-through mode and comparison)
            framingVideoUrl={videoUrl}
            framingMetadata={metadata}
            framingVideoFile={videoFile}
            framingKeyframes={keyframes}
            framingSegments={segments}
            framingSegmentSpeeds={segmentSpeeds}
            framingSegmentBoundaries={segmentBoundaries}
            framingTrimRange={trimRange}
            framingClips={clips}
            hasFramingClips={hasClips}
            hasFramingEdits={hasFramingEdits}
            hasMultipleClips={hasMultipleClips}
            // Audio settings
            includeAudio={includeAudio}
            onIncludeAudioChange={setIncludeAudio}
          />
        )}

        </div>
      </div>
      )}

      {/* Debug Info - Shows current branch and commit */}
      <DebugInfo />

      {/* Project Creation Settings Modal */}
      <ProjectCreationSettings
        isOpen={showProjectCreationSettings}
        onClose={() => setShowProjectCreationSettings(false)}
        settings={projectCreationSettings}
        onUpdateSettings={updateProjectCreationSettings}
        onReset={resetSettings}
      />

      {/* Downloads Panel */}
      <DownloadsPanel
        isOpen={isDownloadsPanelOpen}
        onClose={() => setIsDownloadsPanelOpen(false)}
        onOpenProject={(projectId) => {
          // Navigate to project in overlay mode
          selectProject(projectId);
          setEditorMode('overlay');
          setIsDownloadsPanelOpen(false);
        }}
        onCountChange={refreshDownloadsCount}
      />

      {/* Mode Switch Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={modeSwitchDialog.isOpen}
        title="Uncommitted Framing Changes"
        message="You have made framing edits that haven't been exported yet. The current working video doesn't reflect these changes. What would you like to do?"
        onClose={handleModeSwitchCancel}
        buttons={[
          {
            label: 'Cancel',
            onClick: handleModeSwitchCancel,
            variant: 'secondary'
          },
          {
            label: 'Discard Changes',
            onClick: handleModeSwitchDiscard,
            variant: 'danger'
          },
          {
            label: 'Export First',
            onClick: handleModeSwitchExport,
            variant: 'primary'
          }
        ]}
      />
    </div>
    </AppStateProvider>
  );
}

export default App;
