import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import extractionWebSocketManager from '../services/ExtractionWebSocketManager';
import { FramingModeView } from '../modes';
import { FramingContainer } from '../containers';
import { useCrop, useSegments } from '../modes/framing';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { useVideo } from '../hooks/useVideo';
import { useClipManager } from '../hooks/useClipManager';
import { useProjectClips } from '../hooks/useProjectClips';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ClipSelectorSidebar } from '../components/ClipSelectorSidebar';
import { FileUpload } from '../components/FileUpload';
import { ConfirmationDialog } from '../components/shared';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import { forceRefreshUrl } from '../utils/storageUrls';
import { API_BASE } from '../config';
import { useProjectDataStore, useFramingStore, useEditorStore, useOverlayStore, useNavigationStore } from '../stores';
import { useProject } from '../contexts/ProjectContext';

/**
 * FramingScreen - Self-contained screen for Framing mode
 *
 * This component owns all framing-related hooks and state:
 * - useVideo - video playback (NOW OWNED BY THIS SCREEN)
 * - useCrop - crop keyframe management
 * - useSegments - segment/trim management
 * - useZoom - video zoom/pan
 * - useTimelineZoom - timeline zoom
 * - useClipManager - multi-clip management
 * - FramingContainer - framing logic and handlers
 *
 * Reads project data from stores/contexts:
 * - useProject - project context (id, aspect ratio)
 * - useProjectDataStore - loaded clips from ProjectsScreen
 * - useFramingStore - persistent framing state
 *
 * @see AppJSX_REDUCTION/TASK-03-self-contained-framing-screen.md
 */
export function FramingScreen({
  // Legacy integration callbacks (will be simplified in Task 07)
  onExportComplete,
  onProceedToOverlay,
  // Cross-mode coordination for trim operations
  highlightHook,
  // Export button ref (for mode switch dialog to trigger export)
  exportButtonRef: externalExportButtonRef,
}) {
  // Navigation - use editorStore which App.jsx subscribes to
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // Project context
  const { projectId, project, aspectRatio: projectAspectRatio, refresh: refreshProject } = useProject();

  // Project data store state
  const isProjectLoading = useProjectDataStore(state => state.isLoading);
  const loadingStage = useProjectDataStore(state => state.loadingStage);
  // Working video and clip metadata are set on export
  const setWorkingVideo = useProjectDataStore(state => state.setWorkingVideo);
  const setOverlayClipMetadata = useProjectDataStore(state => state.setClipMetadata);

  // Framing persistent state
  const {
    includeAudio,
    setIncludeAudio,
    videoFile: storedVideoFile,
    setVideoFile: setStoredVideoFile,
    framingChangedSinceExport,
    setFramingChangedSinceExport,
  } = useFramingStore();

  // Overlay store - for resetting overlay state and signaling working video load
  const resetOverlayStore = useOverlayStore(state => state.reset);
  const setIsLoadingWorkingVideo = useOverlayStore(state => state.setIsLoadingWorkingVideo);

  // Local state
  const [dragCrop, setDragCrop] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const [videoFile, setVideoFile] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [outdatedClipsDialog, setOutdatedClipsDialog] = useState({ isOpen: false, clips: [] });
  const clipHasUserEditsRef = useRef(false);
  const localExportButtonRef = useRef(null);
  const initialLoadDoneRef = useRef(false);
  const previousClipIdRef = useRef(null);
  const isRestoringClipStateRef = useRef(false);
  const fullscreenContainerRef = useRef(null);
  const outdatedClipsCheckedRef = useRef(false);

  // Use external ref if provided (for mode switch dialog), otherwise use local ref
  const exportButtonRef = externalExportButtonRef || localExportButtonRef;

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
    clearClips,
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalAspectRatio,
    setGlobalTransition,
    getExportData: getClipExportData,
  } = useClipManager();

  // Project clips hook (for backend persistence)
  const {
    clips: projectClips,
    fetchClips: fetchProjectClips,
    uploadClip,
    uploadClipWithMetadata,
    addClipFromLibrary,
    removeClip: removeProjectClip,
    reorderClips: reorderProjectClips,
    saveFramingEdits,
    getClipFileUrl,
    retryExtraction,
  } = useProjectClips(projectId);

  // Games — Zustand store (for game name display and library filters)
  const games = useGamesDataStore(state => state.games);
  const fetchGames = useGamesDataStore(state => state.fetchGames);

  // Extraction state - calculated from clips
  // T249: Track failed/retrying clips for UI
  const extractionState = useMemo(() => {
    if (!clips || clips.length === 0) {
      return { allExtracting: false, anyExtracting: false, allFailed: false, extractedCount: 0, totalCount: 0 };
    }
    const extractedClips = clips.filter(c => c.isExtracted);
    const extractingClips = clips.filter(c => c.isExtracting);
    const failedClips = clips.filter(c => c.isFailed);
    const retryingClips = clips.filter(c => c.extractionStatus === 'retrying');
    const pendingClips = clips.filter(c => !c.isExtracted && !c.isExtracting && !c.isFailed && c.extractionStatus !== 'retrying');
    const activeExtracting = extractingClips.length > 0 || pendingClips.length > 0 || retryingClips.length > 0;
    return {
      allExtracting: extractedClips.length === 0 && activeExtracting && failedClips.length === 0,
      anyExtracting: activeExtracting,
      allFailed: extractedClips.length === 0 && failedClips.length > 0 && !activeExtracting,
      extractedCount: extractedClips.length,
      totalCount: clips.length,
      extractingCount: extractingClips.length,
      pendingCount: pendingClips.length,
      failedCount: failedClips.length,
      retryingCount: retryingClips.length,
    };
  }, [clips]);

  // T249: Track extraction start time for spinner timeout message
  const extractionStartRef = useRef(null);
  const [extractionTimedOut, setExtractionTimedOut] = useState(false);

  useEffect(() => {
    if (extractionState.allExtracting) {
      if (!extractionStartRef.current) {
        extractionStartRef.current = Date.now();
      }
      const timer = setTimeout(() => setExtractionTimedOut(true), 300000); // 5 minutes
      return () => clearTimeout(timer);
    } else {
      extractionStartRef.current = null;
      setExtractionTimedOut(false);
    }
  }, [extractionState.allExtracting]);

  // Listen for extraction completion via WebSocket
  useEffect(() => {
    if (!extractionState.anyExtracting || !projectId) return;

    console.log('[FramingScreen] Starting extraction WebSocket listener -', extractionState);

    // Connect to extraction WebSocket
    extractionWebSocketManager.connect();

    // Listen for extraction events
    const unsubComplete = extractionWebSocketManager.addEventListener('extraction_complete', (data) => {
      console.log('[FramingScreen] Extraction complete:', data);
      // Refresh clips when our project's clip completes
      if (data.project_id === projectId || !data.project_id) {
        fetchProjectClips();
      }
    });

    const unsubFailed = extractionWebSocketManager.addEventListener('extraction_failed', (data) => {
      console.log('[FramingScreen] Extraction failed:', data);
      if (data.project_id === projectId || !data.project_id) {
        fetchProjectClips();
      }
    });

    // T249: On WebSocket reconnect, refresh clips to catch any missed events
    const unsubReconnect = extractionWebSocketManager.addEventListener('reconnect', () => {
      console.log('[FramingScreen] WebSocket reconnected — refreshing clips');
      fetchProjectClips();
    });

    // T249: Safety-net refresh — if no WebSocket update within 60s, poll once
    const safetyTimeout = setTimeout(() => {
      console.log('[FramingScreen] Safety-net refresh after 60s');
      fetchProjectClips();
    }, 60000);

    return () => {
      unsubComplete();
      unsubFailed();
      unsubReconnect();
      clearTimeout(safetyTimeout);
    };
  }, [extractionState.anyExtracting, projectId, fetchProjectClips]);

  // T249: Sync extraction status from backend (projectClips) into clip manager
  // When fetchProjectClips() runs (on WebSocket event or retry), the raw API data
  // updates but the clip manager's transformed clips don't automatically refresh.
  // This effect bridges that gap by updating extraction-related fields.
  useEffect(() => {
    if (!projectClips || projectClips.length === 0 || !clips || clips.length === 0) return;

    for (const backendClip of projectClips) {
      const managerClip = clips.find(c => c.workingClipId === backendClip.id);
      if (!managerClip) continue;

      const newIsExtracted = !!backendClip.filename;
      const newIsExtracting = backendClip.extraction_status === 'running' || backendClip.extraction_status === 'pending';
      const newIsFailed = backendClip.extraction_status === 'failed';
      const newExtractionStatus = backendClip.extraction_status || null;

      // Only update if extraction state actually changed
      if (managerClip.isExtracted !== newIsExtracted ||
          managerClip.isExtracting !== newIsExtracting ||
          managerClip.isFailed !== newIsFailed ||
          managerClip.extractionStatus !== newExtractionStatus) {
        const updates = {
          isExtracted: newIsExtracted,
          isExtracting: newIsExtracting,
          isFailed: newIsFailed,
          extractionStatus: newExtractionStatus,
        };
        // If clip just became extracted, also update the file URL
        if (newIsExtracted && !managerClip.isExtracted) {
          const clipFileUrl = backendClip.file_url || getClipFileUrl(backendClip.id, null, backendClip);
          if (clipFileUrl) {
            updates.fileUrl = clipFileUrl;
            updates.url = clipFileUrl;
          }
          updates.fileName = backendClip.filename || managerClip.fileName;
        }
        updateClipData(managerClip.id, updates);
      }
    }
  }, [projectClips, clips, updateClipData, getClipFileUrl]);

  // Fetch games on mount
  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  // Check for outdated clips when entering framing mode for a project with existing framing
  useEffect(() => {
    // Only check once per project, and only if project has been framed before
    if (!projectId || outdatedClipsCheckedRef.current) return;
    if (!project?.working_video_id) return;

    outdatedClipsCheckedRef.current = true;

    const checkOutdatedClips = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/projects/${projectId}/outdated-clips`);
        if (!response.ok) {
          console.warn('[FramingScreen] Failed to check outdated clips:', response.status);
          return;
        }

        const data = await response.json();
        if (data.has_outdated_clips && data.outdated_clips?.length > 0) {
          console.log('[FramingScreen] Found outdated clips:', data.outdated_clips);
          setOutdatedClipsDialog({ isOpen: true, clips: data.outdated_clips });
        }
      } catch (err) {
        console.error('[FramingScreen] Error checking outdated clips:', err);
      }
    };

    checkOutdatedClips();
  }, [projectId, project?.working_video_id]);

  // Reset outdated clips check when project changes
  useEffect(() => {
    outdatedClipsCheckedRef.current = false;
  }, [projectId]);

  // Segments hook (needed for useVideo initialization)
  const {
    boundaries: segmentBoundaries,
    segments,
    sourceDuration,
    visualDuration,
    trimmedDuration,
    segmentVisualLayout,
    framerate: segmentFramerate,
    trimRange,
    trimHistory,
    segmentSpeeds,
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
    clampToVisibleRange,
    sourceTimeToVisualTime,
    visualTimeToSourceTime,
    createFrameRangeKey,
    isSegmentTrimmed,
    detrimStart,
    detrimEnd,
  } = useSegments();

  // Video hook - NOW OWNED BY THIS SCREEN
  const {
    videoRef,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    error,
    isLoading,
    isVideoElementLoading,
    loadingProgress,
    loadingElapsedSeconds,
    loadVideo,
    loadVideoFromUrl,
    loadVideoFromStreamingUrl,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    seekForward,
    seekBackward,
    restart,
    clearError,
    isUrlExpiredError,
    handlers,
  } = useVideo(getSegmentAtTime, clampToVisibleRange);

  // Crop hook - pass selectedClip's keyframes so useCrop restores them via prop-based data flow
  // This follows "data always ready" pattern: UI updates when data changes, no timing flags needed
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
    cleanupTrimKeyframes,
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
    getCropDataAtTime,
    getKeyframesForExport,
    reset: resetCrop,
    restoreState: restoreCropState,
  } = useCrop(metadata, trimRange, selectedClip?.cropKeyframes);

  // Zoom hooks
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

  const {
    timelineZoom,
    scrollPosition: timelineScrollPosition,
    zoomByWheel: timelineZoomByWheel,
    updateScrollPosition: updateTimelineScrollPosition,
    getTimelineScale,
  } = useTimelineZoom();

  // FramingContainer - encapsulates framing mode logic
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
    setEditorMode: setEditorMode,
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
    addSegmentBoundary,
    removeSegmentBoundary,
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
    highlightHook: highlightHook || {
      deleteHighlightKeyframesInRange: () => {},
      cleanupHighlightTrimKeyframes: () => {},
    },
    saveFramingEdits,
    onCropChange: setDragCrop,
    onUserEdit: () => { clipHasUserEditsRef.current = true; },
    setFramingChangedSinceExport,
  });

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
    handleAddSplit: framingHandleAddSplit,
    handleRemoveSplit: framingHandleRemoveSplit,
    handleSegmentSpeedChange: framingHandleSegmentSpeedChange,
    saveCurrentClipState: framingSaveCurrentClipState,
  } = framing;

  // Track the last loaded URL to detect when extraction completes
  const lastLoadedUrlRef = useRef(null);

  // Initialize video playback when entering framing mode
  // With single-store architecture, clips are already in projectDataStore (UI format)
  // useClipManager reads directly from projectDataStore, so we just need to load the video
  useEffect(() => {
    // Skip if no clips
    if (clips.length === 0) return;

    const firstClip = clips[0];
    const clipUrl = firstClip?.fileUrl || firstClip?.url;

    // Skip if no URL yet (still extracting) or already loaded this URL
    if (!clipUrl) {
      if (!initialLoadDoneRef.current) {
        console.log('[FramingScreen] First clip has no URL yet (extraction pending)');
        initialLoadDoneRef.current = true; // Mark as "attempted" to avoid log spam
      }
      return;
    }

    // Skip if we already loaded this exact URL
    if (lastLoadedUrlRef.current === clipUrl) return;

    console.log('[FramingScreen] Initializing video for first clip:', firstClip?.id);
    lastLoadedUrlRef.current = clipUrl;
    initialLoadDoneRef.current = true;

    // Set previousClipIdRef to prevent clip switching effect from double-loading
    if (firstClip?.id) {
      previousClipIdRef.current = firstClip.id;
    }

    const loadFirstClipVideo = async () => {

      // Clips already have parsed data (segments, cropKeyframes) from useProjectLoader
      // Restore framing state BEFORE loading video to prevent race conditions
      if (firstClip.segments) {
        console.log('[FramingScreen] Restoring segments:', JSON.stringify(firstClip.segments));
        restoreSegmentState(firstClip.segments, firstClip.duration || 0);
      }

      if (firstClip.cropKeyframes && firstClip.cropKeyframes.length > 0) {
        const endFrame = Math.round((firstClip.duration || 0) * (firstClip.framerate || 30));
        console.log('[FramingScreen] Restoring crop keyframes:', firstClip.cropKeyframes.length, 'keyframes');
        restoreCropState(firstClip.cropKeyframes, endFrame);
      }

      // Load video (with metadata already available from useProjectLoader)
      console.log('[FramingScreen] Loading first clip video:', clipUrl);
      if (!clipUrl.startsWith('blob:')) {
        loadVideoFromStreamingUrl(clipUrl, firstClip.metadata || null);
      } else {
        const file = await loadVideoFromUrl(clipUrl, firstClip.fileName || 'clip.mp4');
        if (file) {
          setVideoFile(file);
        }
      }
    };

    loadFirstClipVideo();
  }, [clips, loadVideoFromUrl, loadVideoFromStreamingUrl, restoreSegmentState, restoreCropState]);

  // Set aspect ratio from project (only if different to avoid loops)
  useEffect(() => {
    if (projectAspectRatio && projectAspectRatio !== aspectRatio) {
      updateAspectRatio(projectAspectRatio);
    }
  }, [projectAspectRatio, aspectRatio, updateAspectRatio]);

  // Refs to capture current state for clip switching (avoids stale closures)
  const currentSegmentStateRef = useRef({ segmentBoundaries, segmentSpeeds, trimRange });
  const currentKeyframesRef = useRef(keyframes);

  // Keep refs updated with current values
  useEffect(() => {
    currentSegmentStateRef.current = { segmentBoundaries, segmentSpeeds, trimRange };
  }, [segmentBoundaries, segmentSpeeds, trimRange]);

  useEffect(() => {
    currentKeyframesRef.current = keyframes;
  }, [keyframes]);

  // Handle clip switching - save previous clip's state and load new clip's state
  useEffect(() => {
    // Skip if no clip is selected
    if (!selectedClipId) return;

    // Skip if it's the same clip (no switch happening)
    if (selectedClipId === previousClipIdRef.current) return;

    const previousClipId = previousClipIdRef.current;
    const newClip = clips.find(c => c.id === selectedClipId);

    if (!newClip) {
      console.warn('[FramingScreen] Selected clip not found:', selectedClipId);
      return;
    }

    console.log('[FramingScreen] Switching clips:', previousClipId, '->', selectedClipId);

    // Set ref immediately to prevent race condition with multiple effect runs
    // (clips array changes can trigger re-runs before async work completes)
    previousClipIdRef.current = selectedClipId;

    const switchClip = async () => {
      // Prevent re-entry during restoration
      if (isRestoringClipStateRef.current) return;
      isRestoringClipStateRef.current = true;

      try {
        // 1. Save previous clip's state to clipStore (if there was a previous clip)
        if (previousClipId && clipHasUserEditsRef.current) {
          const prevClip = clips.find(c => c.id === previousClipId);
          if (prevClip) {
            console.log('[FramingScreen] Saving previous clip state:', previousClipId);
            const { segmentBoundaries: bounds, segmentSpeeds: speeds, trimRange: trim } = currentSegmentStateRef.current;
            const kfs = currentKeyframesRef.current;
            const segmentState = {
              boundaries: bounds,
              segmentSpeeds: speeds,
              trimRange: trim,
            };
            updateClipData(previousClipId, {
              segments: segmentState,
              cropKeyframes: kfs,
              trimRange: trim
            });
          }
        }

        // 2. Restore state BEFORE loading video (prevents useEffect race condition)
        // The useCrop useEffect runs when metadata changes and can re-initialize keyframes
        // before we have a chance to restore them. So restore FIRST.

        // 2a. Restore new clip's segments state
        if (newClip.segments) {
          console.log('[FramingScreen] Restoring segments for clip:', selectedClipId);
          restoreSegmentState(newClip.segments, newClip.duration || 0);
        } else {
          // Initialize with default segments
          resetSegments();
          if (newClip.duration) {
            initializeSegments(newClip.duration);
          }
        }

        // 2b. Restore new clip's crop keyframes BEFORE loading video
        if (newClip.cropKeyframes && newClip.cropKeyframes.length > 0) {
          console.log('[FramingScreen] Restoring crop keyframes BEFORE video load:', selectedClipId, newClip.cropKeyframes.length, 'keyframes');
          const endFrame = Math.round((newClip.duration || 0) * (newClip.framerate || 30));
          restoreCropState(newClip.cropKeyframes, endFrame);
        } else {
          // Reset crop to let it initialize with defaults
          resetCrop();
        }

        // 3. NOW load new clip's video (after state is restored)
        if (newClip.fileUrl) {
          console.log('[FramingScreen] Loading new clip video:', newClip.fileUrl);
          // Use streaming for presigned R2 URLs (non-blob) to avoid CORS issues
          if (!newClip.fileUrl.startsWith('blob:')) {
            console.log('[FramingScreen] Using streaming mode for clip switch');
            // Pass metadata so useCrop's useEffect sees it AND our restored keyframes together
            loadVideoFromStreamingUrl(newClip.fileUrl, newClip.metadata || null);
          } else {
            const file = await loadVideoFromUrl(newClip.fileUrl, newClip.fileName || 'clip.mp4');
            if (file) {
              setVideoFile(file);
            }
          }
        } else if (newClip.file) {
          console.log('[FramingScreen] Loading new clip from file:', newClip.fileName);
          await loadVideo(newClip.file);
          setVideoFile(newClip.file);
        }

        // Reset edit tracking for new clip
        clipHasUserEditsRef.current = false;

      } finally {
        isRestoringClipStateRef.current = false;
      }
    };

    switchClip();
  }, [selectedClipId, clips, updateClipData, loadVideoFromUrl, loadVideoFromStreamingUrl, loadVideo, restoreSegmentState, resetSegments, initializeSegments, restoreCropState, resetCrop]);

  // Derived selection state
  const selectedCropKeyframeIndex = useMemo(() => {
    if (!videoUrl) return null;
    const currentFrame = Math.round(currentTime * framerate);
    const index = findKeyframeIndexNearFrame(keyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, framerate, keyframes]);

  // Current crop state (live preview during drag, or interpolated from keyframes)
  const currentCropState = useMemo(() => {
    let crop;
    if (dragCrop) {
      crop = dragCrop;
    } else if (keyframes.length === 0) {
      return null;
    } else {
      crop = interpolateCrop(currentTime);
    }
    if (!crop) return null;
    return {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height
    };
  }, [dragCrop, keyframes, currentTime, interpolateCrop]);

  // Crop context value for child components
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

  // Initialize segments when video duration is available
  useEffect(() => {
    if (duration && duration > 0) {
      initializeSegments(duration);
    }
  }, [duration, initializeSegments]);

  // Get filtered keyframes for export
  const getFilteredKeyframesForExport = useMemo(() => {
    const allKeyframes = getKeyframesForExport();
    const segmentData = getSegmentExportData();

    if (!segmentData || (!segmentData.trim_start && !segmentData.trim_end)) {
      return allKeyframes;
    }

    const trimStart = segmentData.trim_start || 0;
    const trimEnd = segmentData.trim_end || duration || Infinity;

    let lastBeforeTrimStart = null;
    let firstAfterTrimEnd = null;
    const keyframesInRange = [];

    allKeyframes.forEach(kf => {
      if (kf.time >= trimStart && kf.time <= trimEnd) {
        keyframesInRange.push(kf);
      } else if (kf.time < trimStart) {
        if (!lastBeforeTrimStart || kf.time > lastBeforeTrimStart.time) {
          lastBeforeTrimStart = kf;
        }
      } else if (kf.time > trimEnd) {
        if (!firstAfterTrimEnd || kf.time < firstAfterTrimEnd.time) {
          firstAfterTrimEnd = kf;
        }
      }
    });

    return [
      ...(lastBeforeTrimStart ? [lastBeforeTrimStart] : []),
      ...keyframesInRange,
      ...(firstAfterTrimEnd ? [firstAfterTrimEnd] : [])
    ];
  }, [getKeyframesForExport, getSegmentExportData, duration]);

  // Keyboard shortcuts (space bar, copy/paste, arrow keys)
  // FramingScreen owns its own useVideo, so it handles its own keyboard shortcuts
  useKeyboardShortcuts({
    hasVideo: Boolean(videoUrl),
    togglePlay,
    stepForward,
    stepBackward,
    seekForward,
    seekBackward,
    seek,
    editorMode: 'framing',
    selectedLayer,
    copiedCrop,
    onCopyCrop: framingHandleCopyCrop,
    onPasteCrop: framingHandlePasteCrop,
    keyframes,
    framerate,
    selectedCropKeyframeIndex,
    // Not used in framing mode
    highlightKeyframes: [],
    highlightFramerate: 30,
    selectedHighlightKeyframeIndex: null,
    isHighlightEnabled: false,
    annotateVideoUrl: null,
    annotateSelectedLayer: null,
    clipRegions: [],
    annotateSelectedRegionId: null,
    selectAnnotateRegion: null,
  });

  // Fullscreen toggle handler - uses CSS fixed positioning instead of browser API
  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Retry video loading when URL expires
  const handleRetryVideo = useCallback(async () => {
    if (!selectedClip) return;

    console.log('[FramingScreen] Retrying video load for clip:', selectedClip.id);
    clearError();

    // Get a fresh presigned URL
    const filename = selectedClip.filename || `${selectedClip.id}.mp4`;
    const localFallbackUrl = `${API_BASE}/api/clips/${selectedClip.id}/file`;

    try {
      const freshUrl = await forceRefreshUrl('raw_clips', filename, localFallbackUrl);
      console.log('[FramingScreen] Got fresh URL:', freshUrl?.substring(0, 60));

      if (freshUrl && !freshUrl.startsWith('blob:')) {
        loadVideoFromStreamingUrl(freshUrl, selectedClip.metadata || null);
      } else {
        // Fallback to blob download
        await loadVideoFromUrl(freshUrl || localFallbackUrl, filename);
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to retry video load:', err);
    }
  }, [selectedClip, clearError, loadVideoFromStreamingUrl, loadVideoFromUrl]);

  // Outdated clips dialog handlers
  const handleContinueWithOriginal = useCallback(() => {
    console.log('[FramingScreen] User chose to continue with original framing');
    setOutdatedClipsDialog({ isOpen: false, clips: [] });
  }, []);

  const handleUseLatestClips = useCallback(async () => {
    const workingClipIds = outdatedClipsDialog.clips.map(c => c.working_clip_id);
    console.log('[FramingScreen] User chose to use latest clips:', workingClipIds);

    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/refresh-outdated-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_clip_ids: workingClipIds })
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh clips: ${response.status}`);
      }

      const data = await response.json();
      console.log('[FramingScreen] Refreshed clips:', data);

      // Refresh project to get updated working_video_id (now null)
      await refreshProject();

      // Reset the clip manager and reload clips from backend
      clearClips();
      initialLoadDoneRef.current = false;

      // Fetch fresh clip data from backend
      const freshClips = await fetchProjectClips();
      console.log('[FramingScreen] Fetched fresh clips after refresh:', freshClips?.length);

    } catch (err) {
      console.error('[FramingScreen] Failed to refresh outdated clips:', err);
    }

    setOutdatedClipsDialog({ isOpen: false, clips: [] });
  }, [outdatedClipsDialog.clips, projectId, refreshProject, clearClips, fetchProjectClips]);

  // Handle Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Handle file selection
  const handleFileSelect = async (file) => {
    try {
      const videoMetadata = await extractVideoMetadata(file);
      const newClipId = addClip(file, videoMetadata);

      if (!hasClips || clips.length === 0) {
        resetSegments();
        resetCrop();
        setSelectedLayer('playhead');
        setVideoFile(file);
        await loadVideo(file);
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to add clip:', err);
    }
  };

  // Handle proceed to overlay
  const handleProceedToOverlayInternal = useCallback(async (renderedVideoBlob, clipMetadata, exportedProjectId) => {
    // CRITICAL: Get the CURRENT project from navigation store, not the stale closure value
    // When user switches projects during export, the closure's projectId is stale
    // but the navigation store always has the currently viewed project
    const currentlyViewingProjectId = useNavigationStore.getState().projectId;

    console.log('[FramingScreen] Starting overlay transition...', {
      exportedProjectId,
      currentProjectId: currentlyViewingProjectId,
      closureProjectId: projectId
    });

    // IMPORTANT: Check if the completed export is for the CURRENTLY VIEWED project
    // User may have switched to a different project while export was running
    if (exportedProjectId && exportedProjectId !== currentlyViewingProjectId) {
      console.log('[FramingScreen] Export completed for different project, ignoring navigation', {
        exportedProjectId,
        currentProjectId: currentlyViewingProjectId
      });
      // Still refresh projects list so the completed export shows up
      if (onExportComplete) {
        onExportComplete();
      }
      return;
    }

    // Save pending edits (non-blocking - continue even if this fails)
    try {
      await framingSaveCurrentClipState();
      console.log('[FramingScreen] Saved current clip state');
    } catch (err) {
      console.warn('[FramingScreen] Failed to save clip state (continuing):', err);
    }

    // MVC: If blob is null, the backend has already saved the working video
    // OverlayScreen will fetch it from the server using project.working_video_id
    let workingVideoSet = false;

    if (renderedVideoBlob) {
      // Legacy flow: blob provided, set in memory
      const url = URL.createObjectURL(renderedVideoBlob);

      try {
        console.log('[FramingScreen] Creating blob URL and extracting metadata...');
        const meta = await extractVideoMetadata(renderedVideoBlob);
        console.log('[FramingScreen] Video metadata extracted:', { duration: meta?.duration, width: meta?.width, height: meta?.height });

        setWorkingVideo({ file: renderedVideoBlob, url, metadata: meta });
        workingVideoSet = true;
      } catch (err) {
        console.warn('[FramingScreen] Metadata extraction failed, using fallback:', err.message);

        // Fallback: construct metadata from clip data and aspect ratio
        const totalDuration = clipMetadata?.source_clips?.length > 0
          ? clipMetadata.source_clips[clipMetadata.source_clips.length - 1].end_time
          : clips.reduce((sum, c) => sum + (c.duration || 0), 0);

        const [ratioW, ratioH] = (globalAspectRatio || '9:16').split(':').map(Number);
        const isPortrait = ratioH > ratioW;
        const width = isPortrait ? 1080 : 1920;
        const height = isPortrait ? 1920 : 1080;

        const fallbackMeta = {
          width,
          height,
          duration: totalDuration,
          aspectRatio: ratioW / ratioH,
          fileName: 'rendered_video.mp4',
          size: renderedVideoBlob.size,
          format: 'mp4',
        };

        console.log('[FramingScreen] Using fallback metadata:', fallbackMeta);
        setWorkingVideo({ file: renderedVideoBlob, url, metadata: fallbackMeta });
        workingVideoSet = true;
      }
    } else {
      // MVC flow: blob is null, working video saved on server
      // Signal that OverlayScreen should wait for server working video
      // This prevents race condition where OverlayScreen loads raw clip before project refreshes
      setIsLoadingWorkingVideo(true);
      console.log('[FramingScreen] MVC flow: working video on server, signaling OverlayScreen to wait');
      setWorkingVideo(null);

      // Refresh project data so OverlayScreen sees the new working_video_id
      console.log('[FramingScreen] Refreshing project to get new working_video_id');
      await refreshProject();

      workingVideoSet = true; // Will be fetched by OverlayScreen
    }

    if (clipMetadata) {
      setOverlayClipMetadata(clipMetadata);
      console.log('[FramingScreen] Clip metadata set:', clipMetadata?.source_clips?.length, 'clips');
    }

    // Clear the "framing changed" flag since we just exported
    setFramingChangedSinceExport(false);

    // Call parent handler (for any legacy cleanup)
    if (onProceedToOverlay) {
      try {
        await onProceedToOverlay(renderedVideoBlob, clipMetadata);
      } catch (err) {
        console.warn('[FramingScreen] Parent onProceedToOverlay failed (continuing):', err);
      }
    }

    // Navigate to overlay mode
    if (workingVideoSet) {
      console.log('[FramingScreen] Navigating to overlay mode');
      setEditorMode('overlay');
    } else {
      console.error('[FramingScreen] Cannot navigate to overlay - working video not set');
    }
  }, [framingSaveCurrentClipState, onProceedToOverlay, setWorkingVideo, setOverlayClipMetadata, setFramingChangedSinceExport, setEditorMode, clips, globalAspectRatio, refreshProject, projectId, onExportComplete, setIsLoadingWorkingVideo]);

  // Derive game name for selected clip
  const selectedClipGameName = useMemo(() => {
    if (!selectedClip?.gameId || !games?.length) return null;
    const game = games.find(g => g.id === selectedClip.gameId);
    return game?.name || null;
  }, [selectedClip?.gameId, games]);

  // Handle clip selection from sidebar
  const handleSelectClip = useCallback((clipId) => {
    if (clipId !== selectedClipId) {
      selectClip(clipId);
    }
  }, [selectedClipId, selectClip]);

  // Handle clip deletion from sidebar
  const handleDeleteClip = useCallback((clipId) => {
    deleteClip(clipId);
  }, [deleteClip]);

  // Handle adding clip from sidebar
  const handleAddClipFromSidebar = useCallback((file) => {
    handleFileSelect(file);
  }, [handleFileSelect]);

  // Handle upload with metadata from sidebar
  const handleUploadWithMetadata = useCallback(async (uploadData) => {
    try {
      const clip = await uploadClipWithMetadata(uploadData);
      if (clip) {
        // Refresh project clips to get the new clip with proper metadata
        await fetchProjectClips();
        // Add to clip manager
        const videoMetadata = await extractVideoMetadata(uploadData.file);
        addClip(uploadData.file, videoMetadata);
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to upload clip with metadata:', err);
    }
  }, [uploadClipWithMetadata, fetchProjectClips, addClip]);

  // Handle adding clip from library
  const handleAddFromLibrary = useCallback(async (rawClipId) => {
    try {
      const clip = await addClipFromLibrary(rawClipId);
      if (clip) {
        // Refresh project clips to get the new clip
        const updatedClips = await fetchProjectClips();
        // Find the newly added clip and load it
        const newClip = updatedClips?.find(c => c.raw_clip_id === rawClipId);
        if (newClip) {
          const clipUrl = getClipFileUrl(newClip.id, projectId);
          const videoMetadata = await extractVideoMetadataFromUrl(clipUrl);
          addClipFromProject({
            id: newClip.id,
            filename: newClip.filename,
            name: newClip.name,
            notes: newClip.notes,
            duration: videoMetadata?.duration || 0,
            game_id: newClip.game_id,
          }, clipUrl, videoMetadata);
        }
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to add clip from library:', err);
    }
  }, [addClipFromLibrary, fetchProjectClips, getClipFileUrl, projectId, addClipFromProject]);

  // Determine if we're in a loading state (project data being fetched)
  // With single-store architecture, clips from useClipManager ARE the projectDataStore clips
  const isLoadingProjectData = isProjectLoading;

  // Only show FileUpload when truly empty (not loading and no project/clips)
  // If we have a projectId, show the UI skeleton with loading states instead
  if (!hasClips && !videoUrl && !isLoadingProjectData && !projectId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <FileUpload onGameVideoSelect={handleFileSelect} />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar - show when clips exist or when loading */}
      {(hasClips && clips.length > 0) ? (
        <ClipSelectorSidebar
          clips={clips}
          selectedClipId={selectedClipId}
          onSelectClip={handleSelectClip}
          onAddClip={handleAddClipFromSidebar}
          onDeleteClip={handleDeleteClip}
          onReorderClips={reorderClips}
          globalTransition={globalTransition}
          onTransitionChange={setGlobalTransition}
          onUploadWithMetadata={handleUploadWithMetadata}
          onAddFromLibrary={handleAddFromLibrary}
          onRetryExtraction={retryExtraction}
          existingRawClipIds={clips.map(c => c.rawClipId).filter(Boolean)}
          games={games}
        />
      ) : isLoadingProjectData && (
        <div className="w-64 border-r border-gray-700 bg-gray-800/50 p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-700 rounded w-20"></div>
            <div className="space-y-2">
              <div className="h-16 bg-gray-700 rounded"></div>
              <div className="h-16 bg-gray-700 rounded"></div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1">
        {/* Show extraction progress when all clips are extracting, or all-failed state */}
        {extractionState.allFailed ? (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-center px-8">
            <div className="max-w-md">
              <div className="mb-4 text-red-400">
                <svg className="h-12 w-12 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.194-.833-2.964 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-xl font-medium text-white mb-2">Extraction Failed</h3>
              <p className="text-gray-400 mb-4">
                {extractionState.failedCount} clip{extractionState.failedCount > 1 ? 's' : ''} failed to extract.
                Use the retry button in the sidebar to try again.
              </p>
            </div>
          </div>
        ) : extractionState.allExtracting ? (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-center px-8">
            <div className="max-w-md">
              <div className="mb-4">
                <svg className="animate-spin h-12 w-12 text-purple-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-xl font-medium text-white mb-2">Extracting Clip{extractionState.totalCount > 1 ? 's' : ''}</h3>
              <p className="text-gray-400 mb-4">
                {extractionState.extractingCount > 0
                  ? `Processing ${extractionState.extractingCount} clip${extractionState.extractingCount > 1 ? 's' : ''}...`
                  : `${extractionState.pendingCount} clip${extractionState.pendingCount > 1 ? 's' : ''} waiting in queue`}
              </p>
              {extractionTimedOut ? (
                <p className="text-amber-400 text-sm">
                  Taking longer than expected. Extraction may have failed — check the sidebar for status.
                </p>
              ) : (
                <p className="text-gray-500 text-sm">
                  This page will automatically refresh when extraction completes.
                </p>
              )}
            </div>
          </div>
        ) : (
        <FramingModeView
      // Video state - now owned by this screen
      videoRef={videoRef}
      videoUrl={videoUrl}
      metadata={metadata}
      videoFile={videoFile}
      clipTitle={selectedClip?.annotateName || selectedClip?.fileNameDisplay}
      clipGameName={selectedClipGameName}
      clipTags={selectedClip?.tags}
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
      isLoading={isLoading}
      isVideoElementLoading={isVideoElementLoading}
      loadingProgress={loadingProgress}
      loadingElapsedSeconds={loadingElapsedSeconds}
      isProjectLoading={isLoadingProjectData}
      loadingStage={loadingStage}
      error={error}
      isUrlExpiredError={isUrlExpiredError}
      onRetryVideo={handleRetryVideo}
      handlers={handlers}
      // Fullscreen
      fullscreenContainerRef={fullscreenContainerRef}
      isFullscreen={isFullscreen}
      onToggleFullscreen={handleToggleFullscreen}
      // File handling
      onFileSelect={handleFileSelect}
      // Playback controls
      togglePlay={togglePlay}
      stepForward={stepForward}
      stepBackward={stepBackward}
      restart={restart}
      seek={seek}
      // Crop state
      currentCropState={currentCropState}
      aspectRatio={aspectRatio}
      keyframes={keyframes}
      framerate={framerate}
      selectedCropKeyframeIndex={selectedCropKeyframeIndex}
      copiedCrop={copiedCrop}
      dragCrop={dragCrop}
      // Crop handlers
      onCropChange={framingHandleCropChange}
      onCropComplete={framingHandleCropComplete}
      onKeyframeClick={framingHandleKeyframeClick}
      onKeyframeDelete={framingHandleKeyframeDelete}
      onCopyCrop={framingHandleCopyCrop}
      onPasteCrop={framingHandlePasteCrop}
      // Zoom state
      zoom={zoom}
      panOffset={panOffset}
      MIN_ZOOM={MIN_ZOOM}
      MAX_ZOOM={MAX_ZOOM}
      onZoomIn={zoomIn}
      onZoomOut={zoomOut}
      onResetZoom={resetZoom}
      onZoomByWheel={zoomByWheel}
      onPanChange={updatePan}
      // Timeline zoom
      timelineZoom={timelineZoom}
      timelineScrollPosition={timelineScrollPosition}
      onTimelineZoomByWheel={timelineZoomByWheel}
      onTimelineScrollPositionChange={updateTimelineScrollPosition}
      getTimelineScale={getTimelineScale}
      // Segments
      segments={segments}
      segmentBoundaries={segmentBoundaries}
      segmentVisualLayout={segmentVisualLayout}
      visualDuration={visualDuration}
      trimRange={trimRange}
      trimHistory={trimHistory}
      onAddSegmentBoundary={framingHandleAddSplit}
      onRemoveSegmentBoundary={framingHandleRemoveSplit}
      onSegmentSpeedChange={framingHandleSegmentSpeedChange}
      onSegmentTrim={framingHandleTrimSegment}
      onDetrimStart={framingHandleDetrimStart}
      onDetrimEnd={framingHandleDetrimEnd}
      sourceTimeToVisualTime={sourceTimeToVisualTime}
      visualTimeToSourceTime={visualTimeToSourceTime}
      // Layers
      selectedLayer={selectedLayer}
      onLayerSelect={setSelectedLayer}
      // Clips
      hasClips={hasClips}
      clipsWithCurrentState={framingClipsWithCurrentState}
      globalAspectRatio={globalAspectRatio}
      globalTransition={globalTransition}
      // Export
      exportButtonRef={exportButtonRef}
      getFilteredKeyframesForExport={getFilteredKeyframesForExport}
      getSegmentExportData={getSegmentExportData}
      includeAudio={includeAudio}
      onIncludeAudioChange={setIncludeAudio}
      onProceedToOverlay={handleProceedToOverlayInternal}
      onExportComplete={onExportComplete}
      saveCurrentClipState={framingSaveCurrentClipState}
      // Context
      cropContextValue={cropContextValue}
    />
        )}
      </div>

      {/* Outdated Clips Dialog */}
      <ConfirmationDialog
        isOpen={outdatedClipsDialog.isOpen}
        title="Updated Clip Boundaries"
        message={
          outdatedClipsDialog.clips.length === 1
            ? `The clip "${outdatedClipsDialog.clips[0]?.clip_name}" has been re-annotated since you last framed it. Would you like to use the latest boundaries (your framing progress will be reset) or continue with the original boundaries?`
            : `${outdatedClipsDialog.clips.length} clips have been re-annotated since you last framed them. Would you like to use the latest boundaries (framing progress will be reset for these clips) or continue with the original boundaries?`
        }
        onClose={handleContinueWithOriginal}
        buttons={[
          {
            label: 'Continue with Original',
            onClick: handleContinueWithOriginal,
            variant: 'secondary'
          },
          {
            label: 'Use Latest Clips',
            onClick: handleUseLatestClips,
            variant: 'primary'
          }
        ]}
      />
    </div>
  );
}

export default FramingScreen;
