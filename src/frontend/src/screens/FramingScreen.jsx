import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { List, X } from 'lucide-react';
import { FramingModeView } from '../modes';
import { FramingContainer } from '../containers';
import { useCrop, useSegments } from '../modes/framing';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { useVideo } from '../hooks/useVideo';
import { useClipManager } from '../hooks/useClipManager';
import { useFullscreenWorthwhile } from '../hooks/useFullscreenWorthwhile';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ClipSelectorSidebar } from '../components/ClipSelectorSidebar';
import { FileUpload } from '../components/FileUpload';
import { ConfirmationDialog } from '../components/shared';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import { forceRefreshUrl } from '../utils/storageUrls';
import { warmVideoCache } from '../utils/cacheWarming';
import { clipFileUrl as getClipFileUrlSelector, clipCropKeyframes, clipSegments } from '../utils/clipSelectors';
import { API_BASE } from '../config';
import { useProjectDataStore, useFramingStore, useEditorStore, useOverlayStore, useProjectsStore, useVideoStore } from '../stores';
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
  const addClipFromLibraryAction = useProjectDataStore(state => state.addClipFromLibrary);
  const uploadClipWithMetadataAction = useProjectDataStore(state => state.uploadClipWithMetadata);
  const saveFramingEdits = useProjectDataStore(state => state.saveFramingEdits);
  const updateClipMetadata = useProjectDataStore(state => state.updateClipMetadata);
  const removeClipFromServer = useProjectDataStore(state => state.removeClip);

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
  // T740: outdated clips dialog and state removed — framing always uses latest boundaries
  // Mobile sidebar toggle
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const clipHasUserEditsRef = useRef(false);
  const localExportButtonRef = useRef(null);
  const initialLoadDoneRef = useRef(false);
  const previousClipIdRef = useRef(null);
  const isRestoringClipStateRef = useRef(false);
  const fullscreenContainerRef = useRef(null);
  // T740: outdatedClipsCheckedRef removed — no outdated check in framing

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

  // Helper: get clip file URL
  const getClipFileUrl = useCallback((clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip) return getClipFileUrlSelector(clip, projectId);
    return `${API_BASE}/api/clips/projects/${projectId}/clips/${clipId}/file`;
  }, [clips, projectId]);

  // Fetch games on mount
  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  // T740: No outdated clips check needed in framing mode.
  // Framing reads start_time/end_time fresh from raw_clips every load.
  // Crop keyframes are 0-based (relative to clip start) and work with any boundaries.
  // The only thing that becomes "outdated" is an exported working video — that check
  // belongs in overlay mode, not framing.

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
    clipMetadataCache,
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

  // Track the last loaded URL to detect when clip changes
  const lastLoadedUrlRef = useRef(null);
  const stateRestoredForUrlRef = useRef(null); // Guard against infinite restore loops

  /**
   * Get the video URL and clip range for a clip.
   * Game clips use the game video URL with a clip offset; uploaded/extracted clips use file_url directly.
   */
  const getClipVideoConfig = useCallback((clip) => {
    if (clip.game_video_url && clip.start_time != null && clip.end_time != null) {
      // Game clip: use game video with clip offset
      return {
        url: clip.game_video_url,
        clipRange: {
          clipOffset: clip.start_time,
          clipDuration: clip.end_time - clip.start_time,
        },
      };
    }
    // Uploaded/extracted clip: use file_url directly (no offset)
    const url = getClipFileUrlSelector(clip, projectId);
    return { url, clipRange: null };
  }, [projectId]);

  // Re-fetch clips on mount — picks up any changes made in annotate mode
  // (e.g., updated start_time/end_time, new clips, deleted clips)
  useEffect(() => {
    if (projectId) fetchClips(projectId);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only refresh

  // T580: On mount, immediately load the first clip's video before first paint.
  // When switching from overlay → framing, the shared videoStore may still hold
  // the working video (cropped/exported). Loading the correct clip URL here
  // (in useLayoutEffect) updates the store before the browser paints, so the
  // user never sees stale video or a "no video loaded" flash.
  useLayoutEffect(() => {
    if (clips.length === 0) return;
    const targetClip = (selectedClipId && clips.find(c => c.id === selectedClipId)) || clips[0];
    const { url: clipUrl, clipRange } = getClipVideoConfig(targetClip);
    if (!clipUrl || clipUrl.startsWith('blob:')) return;
    const meta = clipMetadataCache[targetClip.id];
    warmVideoCache(clipUrl);
    loadVideoFromStreamingUrl(clipUrl, meta?.metadata || null, clipRange);
    lastLoadedUrlRef.current = clipUrl;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only, mirrors initial load effect

  // Initialize video playback when entering framing mode
  // T250: Clips are raw backend data. Get metadata from cache.
  useEffect(() => {
    if (clips.length === 0) return;

    const firstClip = clips[0];
    const { url: clipUrl, clipRange } = getClipVideoConfig(firstClip);
    if (!clipUrl) return;

    const firstClipWithMeta = getClipWithMeta(firstClip);

    // Restore framing state (crop keyframes, segments) from clip data if not already done.
    // The useLayoutEffect above may have already loaded the video (for overlay→framing
    // transitions), but state restoration still needs to happen. Guard with ref to
    // prevent infinite loops (restore updates state → re-render → effect re-fires).
    if (stateRestoredForUrlRef.current !== clipUrl) {
      stateRestoredForUrlRef.current = clipUrl;
      const parsedSegments = clipSegments(firstClip, firstClipWithMeta?.duration || 0);
      const parsedCropKfs = clipCropKeyframes(firstClip);

      if (parsedSegments) {
        restoreSegmentState(parsedSegments, firstClipWithMeta?.duration || 0);
      }

      if (parsedCropKfs && parsedCropKfs.length > 0) {
        const endFrame = Math.round((firstClipWithMeta?.duration || 0) * (firstClipWithMeta?.framerate || 30));
        if (endFrame > 0) {
          restoreCropState(parsedCropKfs, endFrame);
        }
      }

      if (firstClip.id) {
        previousClipIdRef.current = firstClip.id;
      }
    }

    // Skip video loading if already loaded (e.g., by useLayoutEffect on mount)
    if (lastLoadedUrlRef.current === clipUrl) return;

    console.log('[FramingScreen] Initializing video for first clip:', firstClip.id);
    lastLoadedUrlRef.current = clipUrl;
    initialLoadDoneRef.current = true;

    const loadFirstClipVideo = async () => {
      if (!clipUrl.startsWith('blob:')) {
        warmVideoCache(clipUrl);
        loadVideoFromStreamingUrl(clipUrl, firstClipWithMeta?.metadata || null, clipRange);
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



  // Handle clip switching - restore new clip's state from store
  // T280: Previous clip's state is already in the store (sync effects keep it current).
  // We only need to restore the NEW clip's state into hooks.
  useEffect(() => {
    if (!selectedClipId) return;
    if (selectedClipId === previousClipIdRef.current) return;

    const newClip = clips.find(c => c.id === selectedClipId);
    if (!newClip) {
      console.warn('[FramingScreen] Selected clip not found:', selectedClipId);
      return;
    }

    // Set restoring flag synchronously BEFORE async work.
    // This prevents the sync effects (declared after this effect) from writing
    // stale hook state to the new clip's store slot during this render cycle.
    isRestoringClipStateRef.current = true;
    previousClipIdRef.current = selectedClipId;

    const newClipWithMeta = getClipWithMeta(newClip);
    const newParsedSegments = clipSegments(newClip, newClipWithMeta?.duration || 0);
    const newParsedCropKfs = clipCropKeyframes(newClip);

    const switchClip = async () => {
      try {
        // 1. Restore new clip's segments state
        if (newParsedSegments) {
          restoreSegmentState(newParsedSegments, newClipWithMeta?.duration || 0);
        } else {
          resetSegments();
          if (newClipWithMeta?.duration) {
            initializeSegments(newClipWithMeta.duration);
          }
        }

        // 2. Restore new clip's crop keyframes BEFORE loading video
        if (newParsedCropKfs && newParsedCropKfs.length > 0) {
          const endFrame = Math.round((newClipWithMeta?.duration || 0) * (newClipWithMeta?.framerate || 30));
          if (endFrame > 0) {
            restoreCropState(newParsedCropKfs, endFrame);
          }
        } else {
          resetCrop();
        }

        // 3. Load new clip's video (or just seek if same video URL)
        const { url: newClipUrl, clipRange: newClipRange } = getClipVideoConfig(newClip);
        if (newClipUrl) {
          if (!newClipUrl.startsWith('blob:')) {
            warmVideoCache(newClipUrl);
            loadVideoFromStreamingUrl(newClipUrl, newClipWithMeta?.metadata || null, newClipRange);
          } else {
            const file = await loadVideoFromUrl(newClipUrl, newClip.filename || 'clip.mp4');
            if (file) {
              setVideoFile(file);
            }
          }
        }

        clipHasUserEditsRef.current = false;
      } finally {
        isRestoringClipStateRef.current = false;
      }
    };

    switchClip();
  }, [selectedClipId, clips, projectId, clipMetadataCache, loadVideoFromUrl, loadVideoFromStreamingUrl, loadVideo, restoreSegmentState, resetSegments, initializeSegments, restoreCropState, resetCrop, getClipWithMeta]);

  // T350: Reactive sync effect REMOVED. See docs/plans/tasks/T350-design.md.
  // Persistence is now gesture-based: each user action in FramingContainer fires
  // a surgical POST /actions call. No reactive useEffect writes to store/backend.

  // Track keyframe index from direct clicks (needed when seek is clamped by trim range).
  // Stores { index, settledTime } — settledTime is set once currentTime settles after click.
  const clickedKeyframeRef = useRef(null);

  // Wrap keyframe click to track the clicked index
  const handleKeyframeClickWithIndex = useCallback((time, index) => {
    clickedKeyframeRef.current = { index, settledTime: null };
    framingHandleKeyframeClick(time, index);
  }, [framingHandleKeyframeClick]);

  // Derived selection state
  const selectedCropKeyframeIndex = useMemo(() => {
    if (!videoUrl) return null;
    const currentFrame = Math.round(currentTime * framerate);
    const index = findKeyframeIndexNearFrame(keyframes, currentFrame, FRAME_TOLERANCE);
    if (index !== -1) {
      clickedKeyframeRef.current = null;
      return index;
    }
    // Fallback: if a keyframe was clicked but seek was clamped (e.g., by trim range),
    // use the clicked index — but only while currentTime stays at the clamped position
    const clicked = clickedKeyframeRef.current;
    if (clicked !== null && clicked.index >= 0 && clicked.index < keyframes.length) {
      if (clicked.settledTime === null) {
        // First render after click — record where currentTime settled (the clamped position)
        clicked.settledTime = currentTime;
        return clicked.index;
      }
      // Subsequent renders — only keep selection if currentTime hasn't moved
      const frameDuration = 1 / framerate;
      if (Math.abs(currentTime - clicked.settledTime) < frameDuration) {
        return clicked.index;
      }
      // User seeked elsewhere — clear
      clickedKeyframeRef.current = null;
    }

    // Fallback 2: playhead is at a trim boundary — select the boundary permanent keyframe.
    // Permanent keyframes live at full video boundaries (frame 0 / endFrame) but the playhead
    // can only reach the trim boundaries, so findKeyframeIndexNearFrame misses them.
    if (trimRange && keyframes.length >= 2) {
      const trimStartFrame = Math.round(trimRange.start * framerate);
      const trimEndFrame = Math.round(trimRange.end * framerate);
      if (Math.abs(currentFrame - trimStartFrame) <= FRAME_TOLERANCE) {
        if (keyframes[0].origin === 'permanent') return 0;
      }
      if (Math.abs(currentFrame - trimEndFrame) <= FRAME_TOLERANCE) {
        const lastIdx = keyframes.length - 1;
        if (keyframes[lastIdx].origin === 'permanent') return lastIdx;
      }
    }

    return null;
  }, [videoUrl, currentTime, framerate, keyframes, trimRange]);

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

  // Hide fullscreen button when it wouldn't meaningfully increase video size
  const fullscreenWorthwhile = useFullscreenWorthwhile(videoRef, isFullscreen);

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
        warmVideoCache(freshUrl);
        loadVideoFromStreamingUrl(freshUrl, selectedClipWithMeta.metadata || null);
      } else {
        await loadVideoFromUrl(freshUrl || localFallbackUrl, filename);
      }
    } catch (err) {
      console.error('[FramingScreen] Failed to retry video load:', err);
    }
  }, [selectedClipWithMeta, clearError, loadVideoFromStreamingUrl, loadVideoFromUrl]);

  // Outdated clips dialog handlers
  // T740: handleContinueWithOriginal and handleUseLatestClips removed — auto-refresh is silent

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
    const currentlyViewingProjectId = useProjectsStore.getState().selectedProjectId;

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

  // Handle clip deletion from sidebar — persists to backend
  const handleDeleteClip = useCallback((clipId) => {
    if (projectId) {
      removeClipFromServer(projectId, clipId);
    }
  }, [projectId, removeClipFromServer]);

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

  const sidebarProps = {
    clips,
    selectedClipId,
    onSelectClip: handleSelectClip,
    onAddClip: handleAddClipFromSidebar,
    onDeleteClip: handleDeleteClip,
    onReorderClips: reorderClips,
    globalTransition,
    onTransitionChange: setGlobalTransition,
    onUploadWithMetadata: handleUploadWithMetadata,
    onAddFromLibrary: handleAddFromLibrary,
    existingRawClipIds: clips.map(c => c.raw_clip_id).filter(Boolean),
    games,
    clipMetadataCache,
  };

  return (
    <div className="flex h-full">
      {/* Sidebar - hidden on mobile, visible on sm+ */}
      {(hasClips && clips.length > 0) ? (
        <div className="hidden sm:flex">
          <ClipSelectorSidebar {...sidebarProps} />
        </div>
      ) : isLoadingProjectData && (
        <div className="hidden sm:block w-64 border-r border-gray-700 bg-gray-800/50 p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-700 rounded w-20"></div>
            <div className="space-y-2">
              <div className="h-16 bg-gray-700 rounded"></div>
              <div className="h-16 bg-gray-700 rounded"></div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile sidebar overlay */}
      {showMobileSidebar && hasClips && clips.length > 0 && (
        <div className="fixed inset-0 z-50 flex sm:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowMobileSidebar(false)} />
          <div className="relative w-[85vw] max-w-[352px] h-full">
            <ClipSelectorSidebar
              {...sidebarProps}
              onSelectClip={(id) => { handleSelectClip(id); setShowMobileSidebar(false); }}
            />
            <button
              onClick={() => setShowMobileSidebar(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile clips toggle */}
        {hasClips && clips.length > 0 && (
          <div className="flex sm:hidden px-3 pt-2">
            <button
              onClick={() => setShowMobileSidebar(true)}
              className="flex items-center gap-1.5 px-2.5 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300"
              title="Show clips"
            >
              <List size={16} />
              <span className="text-xs font-medium">{clips.length} clips</span>
            </button>
          </div>
        )}
        <FramingModeView
      videoRef={videoRef}
      videoUrl={videoUrl}
      metadata={metadata}
      videoFile={videoFile}
      clipTitle={selectedClipWithMeta?.name || (selectedClipWithMeta?.filename || '').replace(/\.[^/.]+$/, '')}
      clipGameName={selectedClipGameName}
      clipTags={selectedClipWithMeta?.tags}
      clipDuration={selectedClipWithMeta?.duration || 0}
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
      onToggleFullscreen={fullscreenWorthwhile ? handleToggleFullscreen : undefined}
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
      onKeyframeClick={handleKeyframeClickWithIndex}
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
      </div>

      {/* T740: Outdated clips dialog removed — boundaries auto-refreshed silently */}
    </div>
  );
}

export default FramingScreen;
