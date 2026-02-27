import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import extractionWebSocketManager from '../services/ExtractionWebSocketManager';
import { FramingModeView } from '../modes';
import { FramingContainer } from '../containers';
import { useCrop, useSegments } from '../modes/framing';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { useVideo } from '../hooks/useVideo';
import { useClipManager } from '../hooks/useClipManager';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ClipSelectorSidebar } from '../components/ClipSelectorSidebar';
import { FileUpload } from '../components/FileUpload';
import { ConfirmationDialog } from '../components/shared';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import { forceRefreshUrl } from '../utils/storageUrls';
import { isExtracted, isExtracting, isFailed, isRetrying, clipFileUrl as getClipFileUrlSelector, clipCropKeyframes, clipSegments } from '../utils/clipSelectors';
import { API_BASE } from '../config';
import { useProjectDataStore, useFramingStore, useEditorStore, useOverlayStore, useNavigationStore } from '../stores';
import { useProject } from '../contexts/ProjectContext';

/**
 * FramingScreen - Self-contained screen for Framing mode
 *
 * T250: Uses raw backend clip data from projectDataStore.
 * No sync effect needed — store is the single source of truth.
 * Backend integer IDs used everywhere. Derived values via selectors.
 */
export function FramingScreen({
  onExportComplete,
  onProceedToOverlay,
  highlightHook,
  exportButtonRef: externalExportButtonRef,
}) {
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // Project context
  const { projectId, project, aspectRatio: projectAspectRatio, refresh: refreshProject } = useProject();

  // Project data store state
  const isProjectLoading = useProjectDataStore(state => state.isLoading);
  const loadingStage = useProjectDataStore(state => state.loadingStage);
  const clipMetadataCache = useProjectDataStore(state => state.clipMetadataCache);
  const setWorkingVideo = useProjectDataStore(state => state.setWorkingVideo);
  const setOverlayClipMetadata = useProjectDataStore(state => state.setClipMetadata);
  const fetchClips = useProjectDataStore(state => state.fetchClips);
  const retryExtractionAction = useProjectDataStore(state => state.retryExtraction);
  const addClipFromLibraryAction = useProjectDataStore(state => state.addClipFromLibrary);
  const uploadClipWithMetadataAction = useProjectDataStore(state => state.uploadClipWithMetadata);
  const saveFramingEdits = useProjectDataStore(state => state.saveFramingEdits);
  const updateClipMetadata = useProjectDataStore(state => state.updateClipMetadata);

  // Framing persistent state
  const {
    includeAudio,
    setIncludeAudio,
    videoFile: storedVideoFile,
    setVideoFile: setStoredVideoFile,
    framingChangedSinceExport,
    setFramingChangedSinceExport,
  } = useFramingStore();

  // Overlay store
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

  const exportButtonRef = externalExportButtonRef || localExportButtonRef;

  // Multi-clip management hook (reads from projectDataStore)
  const {
    clips,
    selectedClipId,
    selectedClip,
    hasClips,
    globalAspectRatio,
    globalTransition,
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalAspectRatio,
    setGlobalTransition,
    getExportData: getClipExportData,
  } = useClipManager();

  // Games — Zustand store
  const games = useGamesDataStore(state => state.games);
  const fetchGames = useGamesDataStore(state => state.fetchGames);

  // Helper: fetch and refresh clips from backend
  const fetchProjectClips = useCallback(() => {
    if (projectId) return fetchClips(projectId);
    return Promise.resolve([]);
  }, [projectId, fetchClips]);

  // Helper: retry extraction for a clip
  const retryExtraction = useCallback((clipId) => {
    if (projectId) return retryExtractionAction(projectId, clipId);
    return Promise.resolve(false);
  }, [projectId, retryExtractionAction]);

  // Helper: get clip file URL
  const getClipFileUrl = useCallback((clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip) return getClipFileUrlSelector(clip, projectId);
    return `${API_BASE}/api/clips/projects/${projectId}/clips/${clipId}/file`;
  }, [clips, projectId]);

  // Extraction state - computed from raw clips using selectors
  const extractionState = useMemo(() => {
    if (!clips || clips.length === 0) {
      return { allExtracting: false, anyExtracting: false, allFailed: false, extractedCount: 0, totalCount: 0 };
    }
    const extractedClips = clips.filter(c => isExtracted(c));
    const extractingClips = clips.filter(c => isExtracting(c));
    const failedClips = clips.filter(c => isFailed(c));
    const retryingClips = clips.filter(c => isRetrying(c));
    const pendingClips = clips.filter(c => !isExtracted(c) && !isExtracting(c) && !isFailed(c) && !isRetrying(c));
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
      const timer = setTimeout(() => setExtractionTimedOut(true), 300000);
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

    extractionWebSocketManager.connect();

    const unsubComplete = extractionWebSocketManager.addEventListener('extraction_complete', (data) => {
      console.log('[FramingScreen] Extraction complete:', data);
      if (data.project_id === projectId || !data.project_id) {
        fetchProjectClips().then(async (freshClips) => {
          // Load metadata for newly extracted clips
          if (freshClips) {
            for (const clip of freshClips) {
              if (isExtracted(clip) && !clipMetadataCache[clip.id]) {
                const url = getClipFileUrlSelector(clip, projectId);
                try {
                  const meta = await extractVideoMetadataFromUrl(url);
                  updateClipMetadata(clip.id, {
                    duration: meta?.duration || 0,
                    width: meta?.width || 0,
                    height: meta?.height || 0,
                    framerate: meta?.framerate || 30,
                    metadata: meta,
                  });
                } catch (err) {
                  console.warn('[FramingScreen] Failed to load metadata for clip', clip.id, err);
                }
              }
            }
          }
        });
      }
    });

    const unsubFailed = extractionWebSocketManager.addEventListener('extraction_failed', (data) => {
      console.log('[FramingScreen] Extraction failed:', data);
      if (data.project_id === projectId || !data.project_id) {
        fetchProjectClips();
      }
    });

    const unsubReconnect = extractionWebSocketManager.addEventListener('reconnect', () => {
      console.log('[FramingScreen] WebSocket reconnected — refreshing clips');
      fetchProjectClips();
    });

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
  }, [extractionState.anyExtracting, projectId, fetchProjectClips, clipMetadataCache, updateClipMetadata]);

  // T250: No sync effect needed — clips in store ARE the raw backend data.
  // Extraction status is computed via selectors, not stored boolean flags.

  // Fetch games on mount
  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  // Check for outdated clips when entering framing mode
  useEffect(() => {
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

  useEffect(() => {
    outdatedClipsCheckedRef.current = false;
  }, [projectId]);

  // Segments hook
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

  // Video hook
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

  // Helper: get a clip merged with its metadata cache
  const getClipWithMeta = useCallback((clip) => {
    if (!clip) return null;
    const meta = clipMetadataCache[clip.id];
    if (!meta) return clip;
    return {
      ...clip,
      duration: meta.duration,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      framerate: meta.framerate || 30,
      metadata: meta.metadata,
    };
  }, [clipMetadataCache]);

  // Get the selected clip with metadata for crop/segment hooks
  const selectedClipWithMeta = useMemo(() => getClipWithMeta(selectedClip), [selectedClip, getClipWithMeta]);

  // Parse crop keyframes from raw clip data for useCrop
  const selectedClipCropKeyframes = useMemo(() => {
    if (!selectedClip) return undefined;
    const kfs = clipCropKeyframes(selectedClip);
    return kfs.length > 0 ? kfs : undefined;
  }, [selectedClip]);

  // Crop hook
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
  } = useCrop(metadata, trimRange, selectedClipCropKeyframes);

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

  // Wrap saveFramingEdits to bind projectId
  const boundSaveFramingEdits = useCallback((clipId, data) => {
    if (projectId) return saveFramingEdits(projectId, clipId, data);
    return Promise.resolve({ success: false });
  }, [projectId, saveFramingEdits]);

  // FramingContainer
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
    selectedClip: selectedClipWithMeta,
    hasClips,
    globalAspectRatio,
    globalTransition,
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
    saveFramingEdits: boundSaveFramingEdits,
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
  // T250: Clips are raw backend data. Get metadata from cache.
  useEffect(() => {
    if (clips.length === 0) return;

    const firstClip = clips[0];
    if (!isExtracted(firstClip)) {
      if (!initialLoadDoneRef.current) {
        console.log('[FramingScreen] First clip has no URL yet (extraction pending)');
        initialLoadDoneRef.current = true;
      }
      return;
    }

    const clipUrl = getClipFileUrlSelector(firstClip, projectId);
    if (!clipUrl) return;

    if (lastLoadedUrlRef.current === clipUrl) return;

    console.log('[FramingScreen] Initializing video for first clip:', firstClip.id);
    lastLoadedUrlRef.current = clipUrl;
    initialLoadDoneRef.current = true;

    if (firstClip.id) {
      previousClipIdRef.current = firstClip.id;
    }

    const firstClipWithMeta = getClipWithMeta(firstClip);
    const parsedSegments = clipSegments(firstClip, firstClipWithMeta?.duration || 0);
    const parsedCropKfs = clipCropKeyframes(firstClip);

    const loadFirstClipVideo = async () => {
      // Restore framing state BEFORE loading video
      if (parsedSegments) {
        console.log('[FramingScreen] Restoring segments:', JSON.stringify(parsedSegments));
        restoreSegmentState(parsedSegments, firstClipWithMeta?.duration || 0);
      }

      if (parsedCropKfs && parsedCropKfs.length > 0) {
        const endFrame = Math.round((firstClipWithMeta?.duration || 0) * (firstClipWithMeta?.framerate || 30));
        console.log('[FramingScreen] Restoring crop keyframes:', parsedCropKfs.length, 'keyframes');
        restoreCropState(parsedCropKfs, endFrame);
      }

      console.log('[FramingScreen] Loading first clip video:', clipUrl);
      if (!clipUrl.startsWith('blob:')) {
        loadVideoFromStreamingUrl(clipUrl, firstClipWithMeta?.metadata || null);
      } else {
        const file = await loadVideoFromUrl(clipUrl, firstClip.filename || 'clip.mp4');
        if (file) {
          setVideoFile(file);
        }
      }
    };

    loadFirstClipVideo();
  }, [clips, projectId, clipMetadataCache, loadVideoFromUrl, loadVideoFromStreamingUrl, restoreSegmentState, restoreCropState, getClipWithMeta]);

  // Set aspect ratio from project
  useEffect(() => {
    if (projectAspectRatio && projectAspectRatio !== aspectRatio) {
      updateAspectRatio(projectAspectRatio);
    }
  }, [projectAspectRatio, aspectRatio, updateAspectRatio]);

  // Refs to capture current state for clip switching
  const currentSegmentStateRef = useRef({ segmentBoundaries, segmentSpeeds, trimRange });
  const currentKeyframesRef = useRef(keyframes);

  useEffect(() => {
    currentSegmentStateRef.current = { segmentBoundaries, segmentSpeeds, trimRange };
  }, [segmentBoundaries, segmentSpeeds, trimRange]);

  useEffect(() => {
    currentKeyframesRef.current = keyframes;
  }, [keyframes]);

  // Handle clip switching - save previous clip's state and load new clip's state
  // T250: Uses raw backend clip data. Parse JSON fields on demand.
  useEffect(() => {
    if (!selectedClipId) return;
    if (selectedClipId === previousClipIdRef.current) return;

    const previousClipId = previousClipIdRef.current;
    const newClip = clips.find(c => c.id === selectedClipId);

    if (!newClip) {
      console.warn('[FramingScreen] Selected clip not found:', selectedClipId);
      return;
    }

    console.log('[FramingScreen] Switching clips:', previousClipId, '->', selectedClipId);
    previousClipIdRef.current = selectedClipId;

    const newClipWithMeta = getClipWithMeta(newClip);
    const newParsedSegments = clipSegments(newClip, newClipWithMeta?.duration || 0);
    const newParsedCropKfs = clipCropKeyframes(newClip);

    const switchClip = async () => {
      if (isRestoringClipStateRef.current) return;
      isRestoringClipStateRef.current = true;

      try {
        // 1. Save previous clip's state
        if (previousClipId && clipHasUserEditsRef.current) {
          const prevClip = clips.find(c => c.id === previousClipId);
          if (prevClip) {
            console.log('[FramingScreen] Saving previous clip state:', previousClipId);
            const { segmentBoundaries: bounds, segmentSpeeds: speeds, trimRange: trim } = currentSegmentStateRef.current;
            const kfs = currentKeyframesRef.current;
            // Save as JSON strings to match raw backend format
            updateClipData(previousClipId, {
              segments_data: JSON.stringify({
                boundaries: bounds,
                segmentSpeeds: speeds,
                trimRange: trim,
              }),
              crop_data: JSON.stringify(kfs),
              timing_data: JSON.stringify({ trimRange: trim }),
            });
          }
        }

        // 2a. Restore new clip's segments state
        if (newParsedSegments) {
          console.log('[FramingScreen] Restoring segments for clip:', selectedClipId);
          restoreSegmentState(newParsedSegments, newClipWithMeta?.duration || 0);
        } else {
          resetSegments();
          if (newClipWithMeta?.duration) {
            initializeSegments(newClipWithMeta.duration);
          }
        }

        // 2b. Restore new clip's crop keyframes BEFORE loading video
        if (newParsedCropKfs && newParsedCropKfs.length > 0) {
          console.log('[FramingScreen] Restoring crop keyframes BEFORE video load:', selectedClipId, newParsedCropKfs.length, 'keyframes');
          const endFrame = Math.round((newClipWithMeta?.duration || 0) * (newClipWithMeta?.framerate || 30));
          restoreCropState(newParsedCropKfs, endFrame);
        } else {
          resetCrop();
        }

        // 3. Load new clip's video
        if (isExtracted(newClip)) {
          const newClipUrl = getClipFileUrlSelector(newClip, projectId);
          if (newClipUrl) {
            console.log('[FramingScreen] Loading new clip video:', newClipUrl);
            if (!newClipUrl.startsWith('blob:')) {
              loadVideoFromStreamingUrl(newClipUrl, newClipWithMeta?.metadata || null);
            } else {
              const file = await loadVideoFromUrl(newClipUrl, newClip.filename || 'clip.mp4');
              if (file) {
                setVideoFile(file);
              }
            }
          }
        }

        clipHasUserEditsRef.current = false;
      } finally {
        isRestoringClipStateRef.current = false;
      }
    };

    switchClip();
  }, [selectedClipId, clips, projectId, clipMetadataCache, updateClipData, loadVideoFromUrl, loadVideoFromStreamingUrl, loadVideo, restoreSegmentState, resetSegments, initializeSegments, restoreCropState, resetCrop, getClipWithMeta]);

  // Derived selection state
  const selectedCropKeyframeIndex = useMemo(() => {
    if (!videoUrl) return null;
    const currentFrame = Math.round(currentTime * framerate);
    const index = findKeyframeIndexNearFrame(keyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, framerate, keyframes]);

  // Current crop state
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

  // Keyboard shortcuts
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

  // Fullscreen toggle
  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Retry video loading when URL expires
  const handleRetryVideo = useCallback(async () => {
    if (!selectedClipWithMeta) return;

    console.log('[FramingScreen] Retrying video load for clip:', selectedClipWithMeta.id);
    clearError();

    const filename = selectedClipWithMeta.filename || `${selectedClipWithMeta.id}.mp4`;
    const localFallbackUrl = `${API_BASE}/api/clips/${selectedClipWithMeta.id}/file`;

    try {
      const freshUrl = await forceRefreshUrl('raw_clips', filename, localFallbackUrl);
      console.log('[FramingScreen] Got fresh URL:', freshUrl?.substring(0, 60));

      if (freshUrl && !freshUrl.startsWith('blob:')) {
        loadVideoFromStreamingUrl(freshUrl, selectedClipWithMeta.metadata || null);
      } else {
        await loadVideoFromUrl(freshUrl || localFallbackUrl, filename);
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to retry video load:', err);
    }
  }, [selectedClipWithMeta, clearError, loadVideoFromStreamingUrl, loadVideoFromUrl]);

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

      await refreshProject();

      initialLoadDoneRef.current = false;

      const freshClips = await fetchProjectClips();
      console.log('[FramingScreen] Fetched fresh clips after refresh:', freshClips?.length);

    } catch (err) {
      console.error('[FramingScreen] Failed to refresh outdated clips:', err);
    }

    setOutdatedClipsDialog({ isOpen: false, clips: [] });
  }, [outdatedClipsDialog.clips, projectId, refreshProject, fetchProjectClips]);

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

  // Handle file selection (local upload - not from library)
  const handleFileSelect = async (file) => {
    try {
      const videoMetadata = await extractVideoMetadata(file);
      // Upload to backend
      if (projectId) {
        await uploadClipWithMetadataAction(projectId, { file, name: file.name });
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to add clip:', err);
    }
  };

  // Handle proceed to overlay
  const handleProceedToOverlayInternal = useCallback(async (renderedVideoBlob, clipMetadata, exportedProjectId) => {
    const currentlyViewingProjectId = useNavigationStore.getState().projectId;

    console.log('[FramingScreen] Starting overlay transition...', {
      exportedProjectId,
      currentProjectId: currentlyViewingProjectId,
      closureProjectId: projectId
    });

    if (exportedProjectId && exportedProjectId !== currentlyViewingProjectId) {
      console.log('[FramingScreen] Export completed for different project, ignoring navigation', {
        exportedProjectId,
        currentProjectId: currentlyViewingProjectId
      });
      if (onExportComplete) {
        onExportComplete();
      }
      return;
    }

    try {
      await framingSaveCurrentClipState();
      console.log('[FramingScreen] Saved current clip state');
    } catch (err) {
      console.warn('[FramingScreen] Failed to save clip state (continuing):', err);
    }

    let workingVideoSet = false;

    if (renderedVideoBlob) {
      const url = URL.createObjectURL(renderedVideoBlob);

      try {
        console.log('[FramingScreen] Creating blob URL and extracting metadata...');
        const meta = await extractVideoMetadata(renderedVideoBlob);
        console.log('[FramingScreen] Video metadata extracted:', { duration: meta?.duration, width: meta?.width, height: meta?.height });

        setWorkingVideo({ file: renderedVideoBlob, url, metadata: meta });
        workingVideoSet = true;
      } catch (err) {
        console.warn('[FramingScreen] Metadata extraction failed, using fallback:', err.message);

        const totalDuration = clipMetadata?.source_clips?.length > 0
          ? clipMetadata.source_clips[clipMetadata.source_clips.length - 1].end_time
          : clips.reduce((sum, c) => {
              const meta = clipMetadataCache[c.id];
              return sum + (meta?.duration || 0);
            }, 0);

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
      setIsLoadingWorkingVideo(true);
      console.log('[FramingScreen] MVC flow: working video on server, signaling OverlayScreen to wait');
      setWorkingVideo(null);

      console.log('[FramingScreen] Refreshing project to get new working_video_id');
      await refreshProject();

      workingVideoSet = true;
    }

    if (clipMetadata) {
      setOverlayClipMetadata(clipMetadata);
      console.log('[FramingScreen] Clip metadata set:', clipMetadata?.source_clips?.length, 'clips');
    }

    setFramingChangedSinceExport(false);

    if (onProceedToOverlay) {
      try {
        await onProceedToOverlay(renderedVideoBlob, clipMetadata);
      } catch (err) {
        console.warn('[FramingScreen] Parent onProceedToOverlay failed (continuing):', err);
      }
    }

    if (workingVideoSet) {
      console.log('[FramingScreen] Navigating to overlay mode');
      setEditorMode('overlay');
    } else {
      console.error('[FramingScreen] Cannot navigate to overlay - working video not set');
    }
  }, [framingSaveCurrentClipState, onProceedToOverlay, setWorkingVideo, setOverlayClipMetadata, setFramingChangedSinceExport, setEditorMode, clips, clipMetadataCache, globalAspectRatio, refreshProject, projectId, onExportComplete, setIsLoadingWorkingVideo]);

  // Derive game name for selected clip
  const selectedClipGameName = useMemo(() => {
    if (!selectedClipWithMeta?.game_id || !games?.length) return null;
    const game = games.find(g => g.id === selectedClipWithMeta.game_id);
    return game?.name || null;
  }, [selectedClipWithMeta?.game_id, games]);

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
      if (projectId) {
        await uploadClipWithMetadataAction(projectId, uploadData);
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to upload clip with metadata:', err);
    }
  }, [projectId, uploadClipWithMetadataAction]);

  // Handle adding clip from library
  const handleAddFromLibrary = useCallback(async (rawClipId) => {
    try {
      if (projectId) {
        await addClipFromLibraryAction(projectId, rawClipId);
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to add clip from library:', err);
    }
  }, [projectId, addClipFromLibraryAction]);

  const isLoadingProjectData = isProjectLoading;

  // Only show FileUpload when truly empty
  if (!hasClips && !videoUrl && !isLoadingProjectData && !projectId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <FileUpload onGameVideoSelect={handleFileSelect} />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
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
          existingRawClipIds={clips.map(c => c.raw_clip_id).filter(Boolean)}
          games={games}
          clipMetadataCache={clipMetadataCache}
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
      videoRef={videoRef}
      videoUrl={videoUrl}
      metadata={metadata}
      videoFile={videoFile}
      clipTitle={selectedClipWithMeta?.name || (selectedClipWithMeta?.filename || '').replace(/\.[^/.]+$/, '')}
      clipGameName={selectedClipGameName}
      clipTags={selectedClipWithMeta?.tags}
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
      fullscreenContainerRef={fullscreenContainerRef}
      isFullscreen={isFullscreen}
      onToggleFullscreen={handleToggleFullscreen}
      onFileSelect={handleFileSelect}
      togglePlay={togglePlay}
      stepForward={stepForward}
      stepBackward={stepBackward}
      restart={restart}
      seek={seek}
      currentCropState={currentCropState}
      aspectRatio={aspectRatio}
      keyframes={keyframes}
      framerate={framerate}
      selectedCropKeyframeIndex={selectedCropKeyframeIndex}
      copiedCrop={copiedCrop}
      dragCrop={dragCrop}
      onCropChange={framingHandleCropChange}
      onCropComplete={framingHandleCropComplete}
      onKeyframeClick={framingHandleKeyframeClick}
      onKeyframeDelete={framingHandleKeyframeDelete}
      onCopyCrop={framingHandleCopyCrop}
      onPasteCrop={framingHandlePasteCrop}
      zoom={zoom}
      panOffset={panOffset}
      MIN_ZOOM={MIN_ZOOM}
      MAX_ZOOM={MAX_ZOOM}
      onZoomIn={zoomIn}
      onZoomOut={zoomOut}
      onResetZoom={resetZoom}
      onZoomByWheel={zoomByWheel}
      onPanChange={updatePan}
      timelineZoom={timelineZoom}
      timelineScrollPosition={timelineScrollPosition}
      onTimelineZoomByWheel={timelineZoomByWheel}
      onTimelineScrollPositionChange={updateTimelineScrollPosition}
      getTimelineScale={getTimelineScale}
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
      selectedLayer={selectedLayer}
      onLayerSelect={setSelectedLayer}
      hasClips={hasClips}
      clipsWithCurrentState={framingClipsWithCurrentState}
      globalAspectRatio={globalAspectRatio}
      globalTransition={globalTransition}
      exportButtonRef={exportButtonRef}
      getFilteredKeyframesForExport={getFilteredKeyframesForExport}
      getSegmentExportData={getSegmentExportData}
      includeAudio={includeAudio}
      onIncludeAudioChange={setIncludeAudio}
      onProceedToOverlay={handleProceedToOverlayInternal}
      onExportComplete={onExportComplete}
      saveCurrentClipState={framingSaveCurrentClipState}
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
