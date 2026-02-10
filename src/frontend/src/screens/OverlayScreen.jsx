import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { OverlayModeView } from '../modes';
import { OverlayContainer } from '../containers';
import { useHighlightRegions, useOverlayState } from '../modes/overlay';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import { frameToTime } from '../utils/videoUtils';
import { forceRefreshUrl } from '../utils/storageUrls';
import { API_BASE } from '../config';
import { useProject } from '../contexts/ProjectContext';
import { useNavigationStore } from '../stores/navigationStore';
import { useOverlayStore } from '../stores/overlayStore';
import { useProjectDataStore } from '../stores/projectDataStore';
import { useFramingStore } from '../stores/framingStore';
import { useExportStore } from '../stores/exportStore';
import * as overlayActions from '../api/overlayActions';

/**
 * OverlayScreen - Self-contained screen for Overlay mode
 *
 * This component owns all overlay-specific hooks and state:
 * - useOverlayState - consolidated overlay interaction state
 * - useHighlight - highlight keyframe management
 * - useHighlightRegions - highlight region management
 * - useVideo - video playback (without segment awareness)
 * - useZoom - video zoom/pan
 * - useTimelineZoom - timeline zoom
 * - OverlayContainer - overlay logic and handlers
 *
 * Data Sources:
 * - Project context (projectId, project)
 * - overlayStore (working video set by FramingScreen export)
 * - projectDataStore (clips for pass-through mode)
 * - framingStore (for detecting uncommitted framing changes)
 *
 * @see AppJSX_REDUCTION/TASK-04-self-contained-overlay-screen.md
 */
export function OverlayScreen({
  // Export callback (legacy - will be moved to store in Task 07)
  onExportComplete,
  // Optional ref for triggering export from parent (used for save dialog)
  exportButtonRef: externalExportButtonRef,
}) {
  // Navigation
  const navigate = useNavigationStore(state => state.navigate);

  // Project context
  const { projectId, project, refresh: refreshProject } = useProject();

  // Working video from project data store (canonical owner)
  const workingVideo = useProjectDataStore(state => state.workingVideo);
  const setWorkingVideo = useProjectDataStore(state => state.setWorkingVideo);

  // Overlay store - for overlay-specific state (loading, effects, changes)
  const {
    clipMetadata: overlayClipMetadata,
    effectType: highlightEffectType,
    isLoadingWorkingVideo,
    overlayChangedSinceExport,
    setClipMetadata: setOverlayClipMetadata,
    setEffectType: setHighlightEffectType,
    setIsLoadingWorkingVideo,
    setOverlayChangedSinceExport,
  } = useOverlayStore();

  // Project data store - for framing clips (pass-through mode)
  const clips = useProjectDataStore(state => state.clips);
  const hasClips = clips && clips.length > 0;

  // Get unique tags from all clips for display
  const clipTags = useMemo(() => {
    if (!clips || clips.length === 0) return [];
    const allTags = clips.flatMap(c => c.tags || []);
    return [...new Set(allTags)]; // Unique tags
  }, [clips]);

  // Framing store - for detecting uncommitted changes
  const hasChangedSinceExport = useFramingStore(state => state.hasChangedSinceExport);

  // Export store - for dismissing "export complete" toast on changes
  const dismissExportCompleteToast = useExportStore(state => state.dismissExportCompleteToast);

  // Local overlay state (drag, selection, etc.)
  const overlayState = useOverlayState();
  const {
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,
    pendingOverlaySaveRef,
    // Sync state machine (replaces refs for reactive behavior)
    overlaySyncState,
    setOverlaySyncState,
    overlayLoadedProjectId,
    setOverlayLoadedProjectId,
  } = overlayState;

  // Local state
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const internalExportButtonRef = useRef(null);
  const exportButtonRef = externalExportButtonRef || internalExportButtonRef;
  const fullscreenContainerRef = useRef(null);
  const videoLoadedFromUrlRef = useRef(null); // Track which URL we've loaded to prevent infinite loops

  // =========================================
  // DETERMINE EFFECTIVE VIDEO SOURCE
  // =========================================

  // Get framing video data from clips (for pass-through mode - only used when no working video)
  const framingVideoUrl = clips[0]?.fileUrl || clips[0]?.url;
  const framingMetadata = clips[0]?.metadata;
  const framingVideoFile = clips[0]?.file;

  // Determine if we should wait for working video (don't use original clip as fallback)
  // If project has a working_video_url but workingVideo is null, we're loading it
  const shouldWaitForWorkingVideo = !workingVideo && (project?.working_video_url || isLoadingWorkingVideo);

  // Effective video: working video from store, or fallback to framing video only if no working video exists
  const effectiveOverlayVideoUrl = workingVideo?.url || (shouldWaitForWorkingVideo ? null : framingVideoUrl);
  const effectiveOverlayMetadata = workingVideo?.metadata || (shouldWaitForWorkingVideo ? null : framingMetadata);
  const effectiveOverlayFile = workingVideo?.file || (shouldWaitForWorkingVideo ? null : framingVideoFile);

  // =========================================
  // VIDEO HOOK - Without segment awareness for overlay mode
  // =========================================

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
    loadVideo,
    loadVideoFromUrl,
    loadVideoFromStreamingUrl,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,
    clearError,
    isUrlExpiredError,
    handlers,
  } = useVideo(null, null); // No segment functions in overlay mode

  // =========================================
  // HIGHLIGHT REGIONS HOOK - OWNED BY THIS SCREEN
  // =========================================

  // Highlight regions hook - boundary-based system for multiple highlight regions
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
  } = useHighlightRegions(effectiveOverlayMetadata);

  // =========================================
  // ZOOM HOOKS
  // =========================================

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

  // =========================================
  // DERIVED STATE - Selected keyframe based on playhead position
  // =========================================

  // Calculate which highlight keyframe is "selected" based on playhead proximity
  // This makes the keyframe visually enlarge when the playhead is near it
  const selectedHighlightKeyframeIndex = useMemo(() => {
    if (!videoUrl || !highlightRegionKeyframes || highlightRegionKeyframes.length === 0) {
      return null;
    }
    const currentFrame = Math.round(currentTime * highlightRegionsFramerate);
    const index = findKeyframeIndexNearFrame(highlightRegionKeyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, highlightRegionsFramerate, highlightRegionKeyframes]);

  // =========================================
  // INITIALIZATION - Load working video if needed
  // =========================================

  useEffect(() => {
    // If no working video in store but project has presigned URL, use it directly (streaming)
    if (!workingVideo && project?.working_video_url && !isLoadingWorkingVideo) {
      setIsLoadingWorkingVideo(true);

      (async () => {
        try {
          console.log('[OverlayScreen] Using presigned URL for working video (streaming)');
          // Use presigned URL directly - no blob download needed!
          // Extract metadata using the streaming URL (fast - only reads headers + moov atom)
          const meta = await extractVideoMetadataFromUrl(project.working_video_url, 'working_video.mp4');
          console.log('[OverlayScreen] Extracted metadata from streaming URL:', meta);
          // Store URL directly (no file/blob needed for streaming)
          setWorkingVideo({ file: null, url: project.working_video_url, metadata: meta });
        } catch (err) {
          console.error('[OverlayScreen] Failed to extract working video metadata:', err);
        } finally {
          setIsLoadingWorkingVideo(false);
        }
      })();
    }
  }, [workingVideo, project?.working_video_url, isLoadingWorkingVideo, setIsLoadingWorkingVideo, setWorkingVideo]);

  // Load video into useVideo hook when effectiveOverlayVideoUrl is available
  // Uses a ref to track the source URL to prevent infinite loops (blob URLs are always unique)
  useEffect(() => {
    if (effectiveOverlayVideoUrl && effectiveOverlayVideoUrl !== videoLoadedFromUrlRef.current) {
      console.log('[OverlayScreen] Loading video from URL:', effectiveOverlayVideoUrl.substring(0, 50));
      videoLoadedFromUrlRef.current = effectiveOverlayVideoUrl;

      // Use streaming mode for presigned URLs (not blob URLs)
      // This avoids downloading the entire video before playback
      if (!effectiveOverlayVideoUrl.startsWith('blob:') && effectiveOverlayMetadata) {
        console.log('[OverlayScreen] Using streaming mode (instant first frame)');
        loadVideoFromStreamingUrl(effectiveOverlayVideoUrl, effectiveOverlayMetadata);
      } else {
        // For blob URLs (local exports), use the fetch approach
        loadVideoFromUrl(effectiveOverlayVideoUrl, 'overlay_video.mp4');
      }
    }
  }, [effectiveOverlayVideoUrl, effectiveOverlayMetadata, loadVideoFromUrl, loadVideoFromStreamingUrl]);

  // Initialize highlight regions when duration available
  useEffect(() => {
    const highlightDuration = effectiveOverlayMetadata?.duration || duration;
    if (highlightDuration && highlightDuration > 0) {
      initializeHighlightRegions(highlightDuration);
    }
  }, [effectiveOverlayMetadata?.duration, duration, initializeHighlightRegions]);

  // Handle fresh export transition - load highlight regions from backend
  // The backend now creates regions with player detection data during export
  // We must fetch from backend to get that detection data (not create from clip metadata)
  useEffect(() => {
    if (overlayClipMetadata && effectiveOverlayMetadata && projectId && overlaySyncState !== 'loading') {
      console.log('[OverlayScreen] Fresh export detected, fetching overlay data from backend');

      // Clear clip metadata to prevent re-triggering
      setOverlayClipMetadata(null);

      // Transition to loading state
      setOverlaySyncState('loading');

      // Fetch overlay data from backend (includes detection data from export)
      (async () => {
        try {
          const response = await fetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`);
          const data = await response.json();

          if (data.has_data && data.highlights_data?.length > 0) {
            // Reset existing regions first
            resetHighlightRegions();

            restoreHighlightRegions(data.highlights_data, effectiveOverlayMetadata.duration);
            console.log('[OverlayScreen] Restored', data.highlights_data.length, 'highlight regions with detection data');

            // Check if detection data was loaded
            const hasDetections = data.highlights_data.some(r => r.detections?.some(d => d.boxes?.length > 0));
            if (hasDetections) {
              console.log('[OverlayScreen] Detection data loaded - green bar should appear');
            }
          } else {
            // Fallback: create default region if backend has no data
            console.log('[OverlayScreen] No saved highlight regions - creating default');
            addHighlightRegion(0);
          }

          if (data.effect_type) {
            setHighlightEffectType(data.effect_type);
          }

          // Transition to ready state - actions will now sync to backend
          setOverlayLoadedProjectId(projectId);
          setOverlaySyncState('ready');
          setOverlayChangedSinceExport(false);
        } catch (err) {
          console.error('[OverlayScreen] Failed to load overlay data after export:', err);
          // On error, create default region but still mark as ready
          addHighlightRegion(0);
          setOverlayLoadedProjectId(projectId);
          setOverlaySyncState('ready');
        }
      })();
    }
  }, [overlayClipMetadata, effectiveOverlayMetadata, projectId, overlaySyncState, setOverlayClipMetadata, resetHighlightRegions, restoreHighlightRegions, addHighlightRegion, setHighlightEffectType, setOverlayChangedSinceExport, setOverlaySyncState, setOverlayLoadedProjectId]);

  // =========================================
  // OVERLAY DATA PERSISTENCE
  // =========================================

  // Reset sync state when project changes
  useEffect(() => {
    if (projectId !== overlayLoadedProjectId && overlaySyncState !== 'idle') {
      setOverlaySyncState('idle');
    }
  }, [projectId, overlayLoadedProjectId, overlaySyncState, setOverlaySyncState]);

  // Load overlay data from backend
  // Skip if we have fresh clip metadata (from framing export) - that takes priority
  // Uses state machine to track loading state
  useEffect(() => {
    const effectiveDuration = effectiveOverlayMetadata?.duration;
    // Only load if: we have a projectId, we're idle, we have duration, and no clip metadata
    const shouldLoad = projectId && overlaySyncState === 'idle' && effectiveDuration && !overlayClipMetadata;

    if (shouldLoad) {
      // Transition to loading state
      setOverlaySyncState('loading');

      (async () => {
        try {
          console.log('[OverlayScreen] Loading overlay data for project:', projectId);
          const response = await fetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`);
          const data = await response.json();

          if (data.has_data && data.highlights_data?.length > 0) {
            restoreHighlightRegions(data.highlights_data, effectiveDuration);
            console.log('[OverlayScreen] Restored', data.highlights_data.length, 'highlight regions');
          } else {
            // No saved regions - create default for first 2 seconds
            console.log('[OverlayScreen] No saved highlight regions - creating default');
            addHighlightRegion(0);
          }
          if (data.effect_type) {
            setHighlightEffectType(data.effect_type);
          }

          // Transition to ready state - actions will now sync to backend
          setOverlayLoadedProjectId(projectId);
          setOverlaySyncState('ready');
          setOverlayChangedSinceExport(false);
        } catch (err) {
          console.error('[OverlayScreen] Failed to load overlay data:', err);
          // On error, still create default region so user isn't stuck
          addHighlightRegion(0);
          setOverlayLoadedProjectId(projectId);
          setOverlaySyncState('ready');
        }
      })();
    }
  }, [projectId, effectiveOverlayMetadata?.duration, overlaySyncState, restoreHighlightRegions, setHighlightEffectType, overlayClipMetadata, addHighlightRegion, setOverlaySyncState, setOverlayLoadedProjectId, setOverlayChangedSinceExport]);

  // =========================================
  // ACTION-BASED SYNC (replaces full-blob saves)
  // =========================================
  // Each user gesture dispatches an atomic action to the backend.
  // Local state updates immediately (optimistic), backend sync is fire-and-forget.

  // Check if we should sync actions - now uses reactive state machine!
  // Actions only sync when we're in 'ready' state (data loaded, not loading)
  const canSyncActions = overlaySyncState === 'ready' && overlayLoadedProjectId === projectId;

  // Wrapped handler: Add highlight region
  const wrappedAddHighlightRegion = useCallback((clickTime) => {
    const regionId = addHighlightRegion(clickTime);
    if (regionId && canSyncActions) {
      // Get the created region to extract times
      const region = highlightRegions.find(r => r.id === regionId);
      if (region) {
        overlayActions.createRegion(projectId, region.startTime, region.endTime, regionId)
          .catch(err => console.error('[OverlayScreen] Failed to sync createRegion:', err));
      }
    }
    setOverlayChangedSinceExport(true);
    return regionId;
  }, [addHighlightRegion, projectId, canSyncActions, highlightRegions, setOverlayChangedSinceExport]);

  // Wrapped handler: Delete highlight region
  const wrappedDeleteHighlightRegion = useCallback((regionIndex) => {
    const region = highlightRegions[regionIndex];
    deleteHighlightRegion(regionIndex);
    if (region && canSyncActions) {
      overlayActions.deleteRegion(projectId, region.id)
        .catch(err => console.error('[OverlayScreen] Failed to sync deleteRegion:', err));
    }
    setOverlayChangedSinceExport(true);
  }, [deleteHighlightRegion, projectId, canSyncActions, highlightRegions, setOverlayChangedSinceExport]);

  // Wrapped handler: Move region start
  const wrappedMoveHighlightRegionStart = useCallback((regionId, newStartTime) => {
    moveHighlightRegionStart(regionId, newStartTime);
    if (canSyncActions) {
      overlayActions.updateRegion(projectId, regionId, newStartTime, null)
        .catch(err => console.error('[OverlayScreen] Failed to sync updateRegion start:', err));
    }
    setOverlayChangedSinceExport(true);
  }, [moveHighlightRegionStart, projectId, canSyncActions, setOverlayChangedSinceExport]);

  // Wrapped handler: Move region end
  const wrappedMoveHighlightRegionEnd = useCallback((regionId, newEndTime) => {
    moveHighlightRegionEnd(regionId, newEndTime);
    if (canSyncActions) {
      overlayActions.updateRegion(projectId, regionId, null, newEndTime)
        .catch(err => console.error('[OverlayScreen] Failed to sync updateRegion end:', err));
    }
    setOverlayChangedSinceExport(true);
  }, [moveHighlightRegionEnd, projectId, canSyncActions, setOverlayChangedSinceExport]);

  // Wrapped handler: Toggle region enabled
  const wrappedToggleHighlightRegion = useCallback((regionIndex, enabled) => {
    const region = highlightRegions[regionIndex];
    toggleHighlightRegion(regionIndex, enabled);
    if (region && canSyncActions) {
      overlayActions.toggleRegion(projectId, region.id, enabled)
        .catch(err => console.error('[OverlayScreen] Failed to sync toggleRegion:', err));
    }
    setOverlayChangedSinceExport(true);
  }, [toggleHighlightRegion, projectId, canSyncActions, highlightRegions, setOverlayChangedSinceExport]);

  // Wrapped handler: Add/update keyframe
  const wrappedAddHighlightRegionKeyframe = useCallback((time, data) => {
    const success = addHighlightRegionKeyframe(time, data);
    if (success && canSyncActions) {
      const region = getRegionAtTime(time);
      if (region) {
        overlayActions.addKeyframe(projectId, region.id, { time, ...data })
          .catch(err => console.error('[OverlayScreen] Failed to sync addKeyframe:', err));
      }
    }
    setOverlayChangedSinceExport(true);
    return success;
  }, [addHighlightRegionKeyframe, projectId, canSyncActions, getRegionAtTime, setOverlayChangedSinceExport]);

  // Wrapped handler: Remove keyframe
  const wrappedRemoveHighlightRegionKeyframe = useCallback((time) => {
    const region = getRegionAtTime(time);
    removeHighlightRegionKeyframe(time);
    if (region && canSyncActions) {
      overlayActions.deleteKeyframe(projectId, region.id, time)
        .catch(err => console.error('[OverlayScreen] Failed to sync deleteKeyframe:', err));
    }
    setOverlayChangedSinceExport(true);
  }, [removeHighlightRegionKeyframe, projectId, canSyncActions, getRegionAtTime, setOverlayChangedSinceExport]);

  // Wrapped handler: Set effect type
  const wrappedSetHighlightEffectType = useCallback((effectType) => {
    setHighlightEffectType(effectType);
    if (canSyncActions) {
      overlayActions.setEffectType(projectId, effectType)
        .catch(err => console.error('[OverlayScreen] Failed to sync setEffectType:', err));
    }
    setOverlayChangedSinceExport(true);
  }, [setHighlightEffectType, projectId, canSyncActions, setOverlayChangedSinceExport]);

  // Dismiss "export complete" toast when user makes changes
  // This lets users know they need to re-export after modifying highlights
  useEffect(() => {
    if (overlayLoadedProjectId === projectId && overlaySyncState === 'ready') {
      dismissExportCompleteToast();
    }
  }, [highlightRegions, highlightEffectType, dismissExportCompleteToast, projectId, overlayLoadedProjectId, overlaySyncState]);

  // NOTE: Safety blob saves removed - gesture-based actions sync immediately to backend.
  // Full blob saves were overwriting good data when local state was corrupted.

  // =========================================
  // OVERLAY CONTAINER - Encapsulates overlay logic
  // =========================================

  // Determine if we have framing edits (clips modified or multiple clips)
  const hasFramingEdits = useMemo(() => {
    if (!hasClips) return false;
    // Multiple clips means there were edits to combine them
    if (clips.length > 1) return true;
    // Check if single clip has segments or crop modifications
    const firstClip = clips[0];
    if (firstClip?.segments) {
      const { boundaries, segmentSpeeds, trimRange } = firstClip.segments;
      if (boundaries?.length > 2 || Object.keys(segmentSpeeds || {}).length > 0 || trimRange) {
        return true;
      }
    }
    if (firstClip?.cropKeyframes?.length > 0) return true;
    return false;
  }, [hasClips, clips]);

  const hasMultipleClips = clips.length > 1;

  const overlay = OverlayContainer({
    videoRef,
    currentTime,
    duration,
    isPlaying,
    seek,
    framingVideoUrl,
    framingMetadata,
    framingVideoFile,
    keyframes: [], // No framing keyframes in overlay mode
    segments: null,
    segmentSpeeds: {},
    segmentBoundaries: [],
    trimRange: null,
    selectedProjectId: projectId,
    selectedProject: project,
    clips,
    hasClips,
    editorMode: 'overlay',
    setEditorMode: () => {},
    setSelectedLayer,
    overlayVideoFile: workingVideo?.file,
    overlayVideoUrl: workingVideo?.url,
    overlayVideoMetadata: workingVideo?.metadata,
    overlayClipMetadata,
    isLoadingWorkingVideo,
    setOverlayVideoFile: (file) => setWorkingVideo(workingVideo ? { ...workingVideo, file } : { file, url: null, metadata: null }),
    setOverlayVideoUrl: (url) => setWorkingVideo(workingVideo ? { ...workingVideo, url } : { file: null, url, metadata: null }),
    setOverlayVideoMetadata: (meta) => setWorkingVideo(workingVideo ? { ...workingVideo, metadata: meta } : { file: null, url: null, metadata: meta }),
    setOverlayClipMetadata,
    setIsLoadingWorkingVideo,
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,
    highlightEffectType,
    setHighlightEffectType: wrappedSetHighlightEffectType,  // Use wrapped version
    pendingOverlaySaveRef,
    // Sync state machine (replaces overlayDataLoadedForProjectRef)
    overlaySyncState,
    overlayLoadedProjectId,
    highlightRegions,
    highlightBoundaries,
    highlightRegionKeyframes,
    highlightRegionsFramerate,
    initializeHighlightRegions,
    resetHighlightRegions,
    addHighlightRegion: wrappedAddHighlightRegion,  // Use wrapped version
    deleteHighlightRegion: wrappedDeleteHighlightRegion,  // Use wrapped version
    moveHighlightRegionStart: wrappedMoveHighlightRegionStart,  // Use wrapped version
    moveHighlightRegionEnd: wrappedMoveHighlightRegionEnd,  // Use wrapped version
    toggleHighlightRegion: wrappedToggleHighlightRegion,  // Use wrapped version
    addHighlightRegionKeyframe: wrappedAddHighlightRegionKeyframe,  // Use wrapped version
    removeHighlightRegionKeyframe: wrappedRemoveHighlightRegionKeyframe,  // Use wrapped version
    getRegionAtTime,
    isTimeInEnabledRegion,
    getRegionHighlightAtTime,
    getRegionsForExport,
    restoreHighlightRegions,
    initializeHighlightRegionsFromClips,
    onOverlayDataSaved: () => {},
  });

  const {
    currentHighlightState,
    playerDetectionEnabled,
    playerDetections,
    isDetectionLoading,
    regionHasDetections,
    showPlayerBoxes,
    togglePlayerBoxes,
    enablePlayerBoxes,
    handlePlayerSelect,
    handleHighlightChange,
    handleHighlightComplete,
  } = overlay;

  // =========================================
  // KEYBOARD SHORTCUTS
  // =========================================

  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle if typing in an input or textarea
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      // Space bar: Toggle play/pause
      if (event.code === 'Space' && effectiveOverlayVideoUrl) {
        event.preventDefault();
        togglePlay();
        return;
      }

      // Arrow keys: Step forward/backward
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        if (!effectiveOverlayVideoUrl) return;
        // Don't handle if modifier keys are pressed
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        event.preventDefault();
        if (event.code === 'ArrowLeft') {
          stepBackward();
        } else {
          stepForward();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [effectiveOverlayVideoUrl, togglePlay, stepForward, stepBackward]);

  // =========================================
  // FULLSCREEN HANDLER
  // =========================================

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // =========================================
  // HANDLERS
  // =========================================

  // Retry video loading when URL expires
  const handleRetryVideo = useCallback(async () => {
    if (!projectId) return;

    console.log('[OverlayScreen] Retrying video load for project:', projectId);
    clearError();

    // Get a fresh presigned URL for the working video
    const localFallbackUrl = `${API_BASE}/api/projects/${projectId}/working-video`;

    try {
      // Working videos are stored as working_videos/{projectId}.mp4
      const freshUrl = await forceRefreshUrl('working_videos', `${projectId}.mp4`, localFallbackUrl);
      console.log('[OverlayScreen] Got fresh URL:', freshUrl?.substring(0, 60));

      if (freshUrl && !freshUrl.startsWith('blob:')) {
        loadVideoFromStreamingUrl(freshUrl, effectiveOverlayMetadata);
      } else {
        // Fallback to blob download
        await loadVideoFromUrl(freshUrl || localFallbackUrl, `${projectId}.mp4`);
      }
    } catch (err) {
      console.error('[OverlayScreen] Failed to retry video load:', err);
    }
  }, [projectId, clearError, loadVideoFromStreamingUrl, loadVideoFromUrl, effectiveOverlayMetadata]);

  const handleSwitchToFraming = useCallback(() => {
    // NOTE: Safety blob save removed - gesture-based actions sync immediately to backend.
    navigate('framing');
  }, [navigate]);

  const handleBackToProjects = useCallback(() => {
    navigate('project-manager');
  }, [navigate]);

  const handleExportComplete = useCallback(() => {
    refreshProject();
    // Reset the "changed since export" flag since we just exported
    setOverlayChangedSinceExport(false);
    if (onExportComplete) {
      onExportComplete();
    }
  }, [refreshProject, setOverlayChangedSinceExport, onExportComplete]);

  // =========================================
  // RENDER
  // =========================================

  return (
    <OverlayModeView
      // Fullscreen
      fullscreenContainerRef={fullscreenContainerRef}
      isFullscreen={isFullscreen}
      onToggleFullscreen={handleToggleFullscreen}
      // Video state
      videoRef={videoRef}
      effectiveOverlayVideoUrl={effectiveOverlayVideoUrl}
      effectiveOverlayMetadata={effectiveOverlayMetadata}
      effectiveOverlayFile={effectiveOverlayFile}
      videoTitle={project?.name}
      videoTags={clipTags}
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
      handlers={handlers}
      // Loading state
      isLoading={isLoading || isLoadingWorkingVideo || shouldWaitForWorkingVideo}
      isVideoElementLoading={isVideoElementLoading}
      loadingProgress={loadingProgress}
      error={error}
      isUrlExpiredError={isUrlExpiredError}
      onRetryVideo={handleRetryVideo}
      loadingMessage={isLoadingWorkingVideo || shouldWaitForWorkingVideo ? 'Loading working video...' : 'Loading video...'}
      // Playback controls
      togglePlay={togglePlay}
      stepForward={stepForward}
      stepBackward={stepBackward}
      restart={restart}
      seek={seek}
      // Highlight state
      currentHighlightState={currentHighlightState}
      highlightRegions={highlightRegions}
      highlightBoundaries={highlightBoundaries}
      highlightRegionKeyframes={highlightRegionKeyframes}
      highlightRegionsFramerate={highlightRegionsFramerate}
      highlightEffectType={highlightEffectType}
      isTimeInEnabledRegion={isTimeInEnabledRegion}
      selectedHighlightKeyframeIndex={selectedHighlightKeyframeIndex}
      // Highlight handlers (wrapped for action-based sync)
      onHighlightChange={handleHighlightChange}
      onHighlightComplete={handleHighlightComplete}
      onAddHighlightRegion={wrappedAddHighlightRegion}
      onDeleteHighlightRegion={wrappedDeleteHighlightRegion}
      onMoveHighlightRegionStart={wrappedMoveHighlightRegionStart}
      onMoveHighlightRegionEnd={wrappedMoveHighlightRegionEnd}
      onRemoveHighlightKeyframe={wrappedRemoveHighlightRegionKeyframe}
      onToggleHighlightRegion={wrappedToggleHighlightRegion}
      onSelectedKeyframeChange={setSelectedHighlightKeyframeTime}
      onHighlightEffectTypeChange={wrappedSetHighlightEffectType}
      // Player detection
      playerDetectionEnabled={playerDetectionEnabled}
      playerDetections={playerDetections}
      isDetectionLoading={isDetectionLoading}
      onPlayerSelect={handlePlayerSelect}
      showPlayerBoxes={showPlayerBoxes}
      onTogglePlayerBoxes={togglePlayerBoxes}
      onEnablePlayerBoxes={enablePlayerBoxes}
      // Zoom
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
      // Layers
      selectedLayer={selectedLayer}
      onLayerSelect={setSelectedLayer}
      // Export
      exportButtonRef={exportButtonRef}
      getRegionsForExport={getRegionsForExport}
      includeAudio={true} // Default to true for overlay mode
      onIncludeAudioChange={() => {}} // Overlay mode doesn't support audio toggle
      onExportComplete={handleExportComplete}
      // Mode switching
      onSwitchToFraming={handleSwitchToFraming}
      hasFramingEdits={hasFramingEdits}
      hasMultipleClips={hasMultipleClips}
      framingVideoUrl={framingVideoUrl}
    />
  );
}

export default OverlayScreen;
