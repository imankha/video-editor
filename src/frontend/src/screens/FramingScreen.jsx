import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FramingModeView } from '../modes';
import { FramingContainer } from '../containers';
import { useCrop, useSegments } from '../modes/framing';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { useVideo } from '../hooks/useVideo';
import { useClipManager } from '../hooks/useClipManager';
import { useProjectClips } from '../hooks/useProjectClips';
import { useGames } from '../hooks/useGames';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ClipSelectorSidebar } from '../components/ClipSelectorSidebar';
import { FileUpload } from '../components/FileUpload';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import { API_BASE } from '../config';
import { useProjectDataStore, useFramingStore, useEditorStore, useOverlayStore } from '../stores';
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

  // Loaded project data from ProjectsScreen
  const loadedClips = useProjectDataStore(state => state.clips);
  const projectDataReset = useProjectDataStore(state => state.reset);
  const isProjectLoading = useProjectDataStore(state => state.isLoading);
  const loadingStage = useProjectDataStore(state => state.loadingStage);

  // Framing persistent state
  const {
    includeAudio,
    setIncludeAudio,
    videoFile: storedVideoFile,
    setVideoFile: setStoredVideoFile,
    framingChangedSinceExport,
    setFramingChangedSinceExport,
  } = useFramingStore();

  // Overlay store - for setting working video on export
  const {
    setWorkingVideo,
    setClipMetadata: setOverlayClipMetadata,
    reset: resetOverlayStore,
  } = useOverlayStore();

  // Local state
  const [dragCrop, setDragCrop] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const [videoFile, setVideoFile] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const clipHasUserEditsRef = useRef(false);
  const pendingFramingSaveRef = useRef(null);
  const localExportButtonRef = useRef(null);
  const initialLoadDoneRef = useRef(false);
  const previousClipIdRef = useRef(null);
  const isRestoringClipStateRef = useRef(false);
  const fullscreenContainerRef = useRef(null);

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
    getClipFileUrl
  } = useProjectClips(projectId);

  // Games hook (for game name display and library filters)
  const { games, fetchGames } = useGames();

  // Fetch games on mount
  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

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
    loadVideo,
    loadVideoFromUrl,
    loadVideoFromStreamingUrl,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,
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
    saveCurrentClipState: framingSaveCurrentClipState,
  } = framing;

  // Initialize from loaded project data (from ProjectsScreen)
  useEffect(() => {
    if (!initialLoadDoneRef.current && loadedClips.length > 0 && clips.length === 0) {
      console.log('[FramingScreen] Initializing from loaded clips:', loadedClips.length);
      initialLoadDoneRef.current = true;

      // Load clips into clip manager
      const loadClipsAsync = async () => {
        const getMetadataFromUrl = async (url) => await extractVideoMetadataFromUrl(url);
        const getClipUrl = (clipId) => getClipFileUrl(clipId, projectId);

        const createdClipIds = await loadProjectClips(
          loadedClips.map(c => ({
            id: c.id,
            filename: c.filename,
            name: c.name,  // Human-readable name from raw_clips
            notes: c.notes,  // Notes from raw_clips
            duration: c.duration,
            segments_data: c.segments_data,
            crop_data: c.crop_data,
            file_url: c.file_url,  // Presigned R2 URL (if available)
          })),
          getClipUrl,
          getMetadataFromUrl,
          projectAspectRatio || '9:16'
        );

        // Set previousClipIdRef immediately to prevent clip switching effect from double-loading
        // loadProjectClips returns created clip IDs, and the first one will be auto-selected
        if (createdClipIds.length > 0) {
          previousClipIdRef.current = createdClipIds[0];
        }

        // Load first clip video (prefer presigned R2 URL if available)
        const firstClip = loadedClips[0];
        console.log('[FramingScreen] First clip data:', { id: firstClip?.id, file_url: firstClip?.file_url, url: firstClip?.url, hasMetadata: !!firstClip?.metadata });
        const firstClipUrl = firstClip?.fileUrl || firstClip?.file_url || firstClip?.url;
        if (firstClipUrl) {
          console.log('[FramingScreen] Loading first clip video:', firstClipUrl);

          // Get metadata first (before loading video) so we can restore state before useEffect runs
          // IMPORTANT: Restore crop/segment state BEFORE setting video metadata to avoid
          // the useCrop useEffect re-initializing keyframes before we restore them
          const clipMetadata = firstClip.metadata || await extractVideoMetadataFromUrl(firstClipUrl);

          // Restore framing state BEFORE loading video (prevents useEffect race condition)
          if (firstClip.segments_data) {
            try {
              const savedSegments = JSON.parse(firstClip.segments_data);
              console.log('[FramingScreen] Restoring segments_data:', JSON.stringify(savedSegments), 'clipDuration:', clipMetadata?.duration);
              restoreSegmentState(savedSegments, clipMetadata?.duration || 0);
            } catch (e) {
              console.warn('[FramingScreen] Failed to parse segments_data:', e);
            }
          }

          if (firstClip.crop_data) {
            try {
              const savedCropKeyframes = JSON.parse(firstClip.crop_data);
              if (savedCropKeyframes.length > 0) {
                const endFrame = Math.round((clipMetadata?.duration || 0) * (clipMetadata?.framerate || 30));
                console.log('[FramingScreen] Restoring crop keyframes BEFORE video load:', savedCropKeyframes.length, 'keyframes');
                restoreCropState(savedCropKeyframes, endFrame);
              }
            } catch (e) {
              console.warn('[FramingScreen] Failed to parse crop_data:', e);
            }
          }

          // NOW load video (with metadata that was already extracted)
          // Use streaming for presigned R2 URLs (non-blob) to avoid CORS issues
          if (!firstClipUrl.startsWith('blob:')) {
            console.log('[FramingScreen] Using streaming mode for first clip');
            loadVideoFromStreamingUrl(firstClipUrl, clipMetadata);
          } else {
            const file = await loadVideoFromUrl(firstClipUrl, firstClip.filename || 'clip.mp4');
            if (file) {
              setVideoFile(file);
            }
          }
        }
      };

      loadClipsAsync();
    }
  }, [loadedClips, clips.length, projectId, projectAspectRatio, loadProjectClips, getClipFileUrl, loadVideoFromUrl, loadVideoFromStreamingUrl, restoreSegmentState, restoreCropState]);

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
  const handleProceedToOverlayInternal = useCallback(async (renderedVideoBlob, clipMetadata) => {
    console.log('[FramingScreen] Starting overlay transition...');

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
      // Clear any stale in-memory video so OverlayScreen fetches from server
      console.log('[FramingScreen] MVC flow: working video on server, clearing in-memory video');
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
  }, [framingSaveCurrentClipState, onProceedToOverlay, setWorkingVideo, setOverlayClipMetadata, setFramingChangedSinceExport, setEditorMode, clips, globalAspectRatio, refreshProject]);

  // Handle navigation to Annotate mode to edit clip source
  const handleEditInAnnotate = useCallback(() => {
    if (!selectedClip?.gameId) return;

    // Store navigation intent for AnnotateScreen to pick up
    sessionStorage.setItem('pendingGameId', selectedClip.gameId.toString());
    if (selectedClip.annotateStartTime != null) {
      sessionStorage.setItem('pendingClipSeekTime', selectedClip.annotateStartTime.toString());
    }

    // Switch to annotate mode
    setEditorMode('annotate');
  }, [selectedClip, setEditorMode]);

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
  const isLoadingProjectData = isProjectLoading || (loadedClips.length > 0 && !hasClips);

  // Only show FileUpload when truly empty (not loading and no project/clips)
  // If we have a projectId or loadedClips, show the UI skeleton with loading states instead
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
        <FramingModeView
      // Video state - now owned by this screen
      videoRef={videoRef}
      videoUrl={videoUrl}
      metadata={metadata}
      videoFile={videoFile}
      clipTitle={selectedClip?.annotateName || selectedClip?.fileNameDisplay}
      clipTags={selectedClip?.tags}
      canEditInAnnotate={selectedClip?.gameId != null}
      onEditInAnnotate={handleEditInAnnotate}
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
      isLoading={isLoading}
      isProjectLoading={isLoadingProjectData}
      loadingStage={loadingStage}
      error={error}
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
      onAddSegmentBoundary={(time) => { clipHasUserEditsRef.current = true; addSegmentBoundary(time); }}
      onRemoveSegmentBoundary={(time) => { clipHasUserEditsRef.current = true; removeSegmentBoundary(time); }}
      onSegmentSpeedChange={(idx, speed) => { clipHasUserEditsRef.current = true; setSegmentSpeed(idx, speed); }}
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
      </div>
    </div>
  );
}

export default FramingScreen;
