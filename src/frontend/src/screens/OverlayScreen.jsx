import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { OverlayModeView } from '../modes';
import { OverlayContainer } from '../containers';
import { useHighlightRegions, useOverlayState } from '../modes/overlay';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { useFullscreenWorthwhile } from '../hooks/useFullscreenWorthwhile';
import { extractVideoMetadata, extractVideoMetadataFromUrl, VideoAssetMissingError } from '../utils/videoMetadata';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import { persistKeyframeEdit } from '../utils/persistKeyframeEdit';
import { frameToTime, timeToFrame } from '../utils/videoUtils';
import { forceRefreshUrl } from '../utils/storageUrls';
import { API_BASE, resolveApiUrl } from '../config';
import apiFetch from '../utils/apiFetch';
import { useProject } from '../contexts/ProjectContext';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { useOverlayStore } from '../stores/overlayStore';
import { useProjectDataStore } from '../stores/projectDataStore';
import { useFramingStore } from '../stores/framingStore';
import { useExportStore } from '../stores/exportStore';
import { useQuestStore } from '../stores/questStore';
import * as overlayActions from '../api/overlayActions';
import { dispatchOverlayAction, useOverlayActionStore } from '../stores/overlayActionStore';
import { track } from '../utils/analytics';

/**
 * OverlayScreen - Self-contained screen for Overlay mode
 *
 * This component owns all overlay-specific hooks and state:
 * - useOverlayState - consolidated overlay interaction state
 * - useHighlightRegions - highlight region management (keyframes per region)
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
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // Project context
  const { projectId, project, refresh: refreshProject } = useProject();

  // Project data store - canonical owner for working video and clip metadata
  const workingVideo = useProjectDataStore(state => state.workingVideo);
  const setWorkingVideo = useProjectDataStore(state => state.setWorkingVideo);
  const overlayClipMetadata = useProjectDataStore(state => state.clipMetadata);
  const setOverlayClipMetadata = useProjectDataStore(state => state.setClipMetadata);
  const clips = useProjectDataStore(state => state.clips);
  const clipMetadataCache = useProjectDataStore(state => state.clipMetadataCache);
  const getClipFileUrl = useProjectDataStore(state => state.getClipFileUrl);

  // Overlay store - for overlay-specific state (loading, effects, changes)
  const {
    effectType: highlightEffectType,
    highlightColor,
    isLoadingWorkingVideo,
    overlayChangedSinceExport,
    setEffectType: setHighlightEffectType,
    setHighlightColor,
    setIsLoadingWorkingVideo,
    setOverlayChangedSinceExport,
    highlightShape,
    strokeWidth,
    fillEnabled,
    fillOpacity,
    dimStrength,
    setHighlightShape,
    setStrokeWidth,
    setFillEnabled,
    setFillOpacity,
    setDimStrength,
  } = useOverlayStore();
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
    // Sync state machine (replaces refs for reactive behavior)
    overlaySyncState,
    setOverlaySyncState,
    overlayLoadedProjectId,
    setOverlayLoadedProjectId,
  } = overlayState;

  // T740: Check if framing is outdated (boundaries changed since last export)
  const [framingOutdated, setFramingOutdated] = useState(false);
  useEffect(() => {
    if (!projectId || !workingVideo?.url) return;
    const checkOutdated = async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/projects/${projectId}/outdated-clips`);
        if (!response.ok) return;
        const data = await response.json();
        setFramingOutdated(data.has_outdated_clips);
      } catch {
        // Silently ignore — non-critical check
      }
    };
    checkOutdated();
  }, [projectId, workingVideo?.url]);

  // Local state
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const internalExportButtonRef = useRef(null);
  const exportButtonRef = externalExportButtonRef || internalExportButtonRef;
  const fullscreenContainerRef = useRef(null);
  const videoLoadedFromUrlRef = useRef(null); // Track which URL we've loaded to prevent infinite loops
  const workingVideoFetchIdRef = useRef(null); // Track which working_video_id we've started fetching
  const workingVideoRecoveryAttemptedRef = useRef(false); // Guard against infinite refresh loops
  const workingVideoAttemptsRef = useRef(0); // Count metadata-load attempts for the current URL
  const MAX_WORKING_VIDEO_ATTEMPTS = 2;
  const [workingVideoLoadError, setWorkingVideoLoadError] = useState(null);
  // T5440: distinguishes a hard 404 (asset genuinely gone — re-export, no retry)
  // from a transient load error (retry offered). Drives the "video unavailable"
  // state and suppresses the misleading "Retry Loading Video" button.
  const [workingVideoMissing, setWorkingVideoMissing] = useState(false);

  // =========================================
  // DETERMINE EFFECTIVE VIDEO SOURCE
  // =========================================

  // Get framing video data from the first clip (pass-through mode, used only when no
  // working video exists). T4270: read the CANONICAL clip shape via the store's
  // accessors. Since T250 clips hold the raw backend shape (`file_url`, and metadata
  // in clipMetadataCache) -- the old `clips[0].fileUrl/url/metadata/file` reads were
  // always undefined, so this pass-through never actually supplied a source.
  const firstClipId = clips[0]?.id;
  const framingVideoUrl = firstClipId != null ? getClipFileUrl(firstClipId, projectId) : undefined;
  const framingMetadata = firstClipId != null ? clipMetadataCache[firstClipId] : undefined;

  // Determine if we should wait for working video (don't use original clip as fallback)
  // If project has a working_video_url but workingVideo is null, we're loading it
  const shouldWaitForWorkingVideo = !workingVideo && (project?.working_video_url || isLoadingWorkingVideo);

  // Effective video: working video from store, or fallback to framing video only if no working video exists
  const effectiveOverlayVideoUrl = workingVideo?.url || (shouldWaitForWorkingVideo ? null : framingVideoUrl);
  const effectiveOverlayMetadata = workingVideo?.metadata || (shouldWaitForWorkingVideo ? null : framingMetadata);
  const effectiveOverlayFile = workingVideo?.file || null;

  // Diagnostic: log video source state on every render where something interesting happens
  useEffect(() => {
    // Gate on project: before project data loads, having no video source is
    // the normal mount state, not an anomaly worth warning about.
    if (project && !effectiveOverlayVideoUrl && !isLoadingWorkingVideo && !shouldWaitForWorkingVideo) {
      console.warn('[OverlayScreen] No video source available', {
        workingVideo: !!workingVideo,
        workingVideoUrl: workingVideo?.url?.substring(0, 50),
        projectWorkingVideoUrl: project?.working_video_url?.substring(0, 50),
        projectWorkingVideoId: project?.working_video_id,
        isLoadingWorkingVideo,
        shouldWaitForWorkingVideo,
        framingVideoUrl: framingVideoUrl?.substring(0, 50),
        clipsCount: clips?.length,
      });
    }
  }, [effectiveOverlayVideoUrl, workingVideo, project, isLoadingWorkingVideo, shouldWaitForWorkingVideo, framingVideoUrl, clips?.length]);

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
    isSeeking,
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
    setVideoDetections: setHighlightVideoDetections,
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
    setZoom: setTimelineZoom,
  } = useTimelineZoom();

  // =========================================
  // AUTO-ZOOM: Ensure detection markers have 48px minimum spacing
  // =========================================
  const hasAutoZoomedRef = useRef(false);
  useEffect(() => {
    if (hasAutoZoomedRef.current) return;
    if (!highlightRegions?.length || !effectiveOverlayMetadata?.duration) return;

    // Collect all detection timestamps
    const timestamps = [];
    highlightRegions.forEach(region => {
      region.detections?.forEach(d => {
        if (d.boxes?.length > 0) timestamps.push(d.timestamp);
      });
    });
    if (timestamps.length < 2) return;

    timestamps.sort((a, b) => a - b);

    // Find the minimum gap between consecutive markers (as fraction of duration)
    const dur = effectiveOverlayMetadata.duration;
    let minGapFraction = Infinity;
    for (let i = 1; i < timestamps.length; i++) {
      const gap = (timestamps[i] - timestamps[i - 1]) / dur;
      if (gap > 0 && gap < minGapFraction) minGapFraction = gap;
    }

    if (minGapFraction === Infinity) return;

    // At 100% zoom, timeline width ≈ viewport - label column (128px) - padding (40px)
    // We estimate ~200px usable width at 100% zoom on mobile
    const estimatedBaseWidth = 200;
    const minSpacingPx = 48; // 44px touch target + 4px gap
    const neededWidth = minSpacingPx / minGapFraction;
    const neededZoom = Math.ceil((neededWidth / estimatedBaseWidth) * 100);

    if (neededZoom > 100) {
      setTimelineZoom(Math.min(neededZoom, 500));
    }
    hasAutoZoomedRef.current = true;
  }, [highlightRegions, effectiveOverlayMetadata?.duration, setTimelineZoom]);

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
    // If no working video in store but project has a working video, use the proxy URL (streaming).
    // T1670: Guard on working_video_id (not URL) because the proxy URL is stable across exports
    // (/api/projects/{id}/working_video/stream never changes). The ID changes per export,
    // so a new export triggers a fresh load even though the URL is the same.
    if (!workingVideo && project?.working_video_url && workingVideoFetchIdRef.current !== project.working_video_id) {
      workingVideoFetchIdRef.current = project.working_video_id;
      workingVideoRecoveryAttemptedRef.current = false; // Reset recovery guard
      workingVideoAttemptsRef.current = 0;
      setWorkingVideoLoadError(null);
      setWorkingVideoMissing(false);
      setIsLoadingWorkingVideo(true);

      const attemptLoad = async () => {
        workingVideoAttemptsRef.current += 1;
        const attempt = workingVideoAttemptsRef.current;
        const workingVideoUrl = resolveApiUrl(project.working_video_url);
        try {
          console.log(`[OverlayScreen] Loading working video (attempt ${attempt}/${MAX_WORKING_VIDEO_ATTEMPTS}):`, workingVideoUrl.substring(0, 80));
          const meta = await extractVideoMetadataFromUrl(workingVideoUrl, 'working_video.mp4');
          console.log('[OverlayScreen] Extracted metadata from streaming URL:', meta);
          setWorkingVideo({ file: null, url: workingVideoUrl, metadata: meta });
          setIsLoadingWorkingVideo(false);
        } catch (err) {
          // T5440: a hard 404 means the working video's R2 object is gone (dangling
          // DB ref / prune) — retrying cannot recover it. Show a single "re-export"
          // state, do NOT run the transient retry (no attempt-2, no probe storm).
          if (err instanceof VideoAssetMissingError) {
            console.warn(`[OverlayScreen] Working video no longer available (HTTP ${err.status}) — re-export to rebuild.`, {
              projectId,
              workingVideoId: project?.working_video_id,
            });
            setWorkingVideoMissing(true);
            setWorkingVideoLoadError('This reel’s video is no longer available. Re-export to rebuild it.');
            setIsLoadingWorkingVideo(false);
            return;
          }
          console.error(`[OverlayScreen] Working video load failed (attempt ${attempt}/${MAX_WORKING_VIDEO_ATTEMPTS}):`, err.message, {
            url: workingVideoUrl?.substring(0, 80),
            projectId,
            workingVideoId: project?.working_video_id,
          });
          if (attempt < MAX_WORKING_VIDEO_ATTEMPTS) {
            attemptLoad();
          } else {
            // Exhausted attempts — surface failure to the user.
            // Leave workingVideoFetchIdRef set so this effect does not re-fire
            // for the same working_video_id; user must click retry to clear + re-attempt.
            setWorkingVideoLoadError(err.message || 'Failed to load working video');
            setIsLoadingWorkingVideo(false);
          }
        }
      };
      attemptLoad();
    } else if (!workingVideo && !project?.working_video_url && isLoadingWorkingVideo) {
      // Stuck state: isLoadingWorkingVideo was set externally (by FramingScreen) but
      // project data doesn't include working_video_url. This happens when React renders
      // OverlayScreen before the refreshed project data has propagated.
      // Recovery: refresh project once to get the URL. If still missing, clear the flag.
      // We handle both outcomes inline because when the project has no working video,
      // the effect deps (project?.working_video_url, working_video_id) stay null
      // and the effect would never re-run to reach the else branch.
      if (!workingVideoRecoveryAttemptedRef.current) {
        workingVideoRecoveryAttemptedRef.current = true;
        console.log('[OverlayScreen] isLoadingWorkingVideo=true but no URL — refreshing project to get presigned URL');
        refreshProject().then((freshProject) => {
          if (!freshProject?.working_video_url) {
            console.warn('[OverlayScreen] Working video URL still missing after refresh — clearing loading state');
            setIsLoadingWorkingVideo(false);
          }
        });
      } else {
        console.warn('[OverlayScreen] Working video URL still missing after refresh — clearing loading state');
        setIsLoadingWorkingVideo(false);
      }
    } else if (project && !workingVideo && !project.working_video_url && !isLoadingWorkingVideo) {
      // Project loaded but has no working video URL at all — log why.
      // (Before project data loads, this state is normal — stay quiet.)
      console.warn('[OverlayScreen] No working video URL in project data', {
        projectId,
        workingVideoId: project.working_video_id,
      });
    }
  }, [workingVideo, project, projectId, isLoadingWorkingVideo, setIsLoadingWorkingVideo, setWorkingVideo, refreshProject]);

  // Load video into useVideo hook when effectiveOverlayVideoUrl is available
  // Uses a ref to track the source URL to prevent infinite loops (blob URLs are always unique)
  useEffect(() => {
    if (effectiveOverlayVideoUrl && effectiveOverlayVideoUrl !== videoLoadedFromUrlRef.current) {
      console.log('[OverlayScreen] Loading video into player:', effectiveOverlayVideoUrl.substring(0, 80));
      videoLoadedFromUrlRef.current = effectiveOverlayVideoUrl;

      // Use streaming mode for presigned URLs (not blob URLs)
      // This avoids downloading the entire video before playback
      if (!effectiveOverlayVideoUrl.startsWith('blob:') && effectiveOverlayMetadata) {
        console.log('[OverlayScreen] Using streaming mode (instant first frame)', {
          duration: effectiveOverlayMetadata?.duration,
          resolution: `${effectiveOverlayMetadata?.width}x${effectiveOverlayMetadata?.height}`,
        });
        loadVideoFromStreamingUrl(effectiveOverlayVideoUrl, effectiveOverlayMetadata);
      } else {
        console.log('[OverlayScreen] Using blob download mode');
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
  //
  // IMPORTANT: This effect does NOT depend on effectiveOverlayMetadata. The working
  // video loads asynchronously from a presigned URL, and waiting for it creates a race
  // condition where overlay data (including player tracking) never loads if the video
  // is slow to load. Instead, we use video_duration from the backend response.
  useEffect(() => {
    if (overlayClipMetadata && projectId && overlaySyncState !== 'loading') {
      console.log('[OverlayScreen] Fresh export detected, fetching overlay data from backend');

      // Clear clip metadata to prevent re-triggering
      setOverlayClipMetadata(null);

      // Transition to loading state
      setOverlaySyncState('loading');

      // Fetch overlay data from backend (includes detection data from export)
      (async () => {
        try {
          const response = await apiFetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`);
          const data = await response.json();

          // Hold the flat video-level detection payload (T5600) so addRegion can
          // slice instant tracking squares for newly created regions.
          setHighlightVideoDetections(data.detections_data || null);

          // Use video_duration from backend, fall back to video metadata or region end times
          const videoDuration = data.video_duration
            || effectiveOverlayMetadata?.duration
            || Math.max(...(data.highlights_data || []).map(r => r.end_time || 0), 0)
            || 0;

          if (data.has_data && data.highlights_data?.length > 0) {
            // Reset existing regions first
            resetHighlightRegions();

            restoreHighlightRegions(data.highlights_data, videoDuration);
            console.log('[OverlayScreen] Restored', data.highlights_data.length, 'highlight regions with detection data, duration:', videoDuration);

            // Check if detection data was loaded
            const hasDetections = data.highlights_data.some(r => r.detections?.some(d => d.boxes?.length > 0));
            if (hasDetections) {
              console.log('[OverlayScreen] Detection data loaded - green bar should appear');
            } else {
              console.log('[OverlayScreen] No detection boxes in highlight regions (detection may have found no players)');
            }
          } else {
            // Fallback: create default region if backend has no data
            console.log('[OverlayScreen] No saved highlight regions - creating default');
            addHighlightRegion(0);
          }

          if (data.effect_type) {
            setHighlightEffectType(data.effect_type);
          }
          if (data.highlight_color) {
            setHighlightColor(data.highlight_color);
          }
          if (data.highlight_shape) setHighlightShape(data.highlight_shape);
          if (data.stroke_width != null) setStrokeWidth(data.stroke_width);
          if (data.fill_enabled != null) setFillEnabled(data.fill_enabled);
          if (data.fill_opacity != null) setFillOpacity(data.fill_opacity);
          if (data.dim_strength != null) setDimStrength(data.dim_strength);

          setOverlayLoadedProjectId(projectId);
          setOverlaySyncState('ready');
          setOverlayChangedSinceExport(false);
        } catch (err) {
          console.error('[OverlayScreen] Failed to load overlay data after export:', err);
          addHighlightRegion(0);
          setOverlayLoadedProjectId(projectId);
          setOverlaySyncState('ready');
        }
      })();
    }
  }, [overlayClipMetadata, projectId, overlaySyncState, effectiveOverlayMetadata?.duration, setOverlayClipMetadata, resetHighlightRegions, restoreHighlightRegions, addHighlightRegion, setHighlightEffectType, setHighlightColor, setOverlayChangedSinceExport, setOverlaySyncState, setOverlayLoadedProjectId, setHighlightShape, setStrokeWidth, setFillEnabled, setFillOpacity, setDimStrength, setHighlightVideoDetections]);

  // =========================================
  // OVERLAY DATA PERSISTENCE
  // =========================================

  // Reset sync state when project changes
  // NOTE: Do NOT include overlaySyncState in dependencies - we only want this
  // to run when projectId changes, not when sync state changes (causes infinite loop)
  useEffect(() => {
    if (projectId !== overlayLoadedProjectId && overlaySyncState !== 'idle') {
      setOverlaySyncState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, overlayLoadedProjectId, setOverlaySyncState]);

  // Clear any unsaved-failure state when switching projects so a prior project's
  // failed overlay actions never block/warn on this one (T4900). Keyed on
  // projectId only — this is a lifecycle reset, not reactive persistence.
  useEffect(() => {
    return () => useOverlayActionStore.getState().reset();
  }, [projectId]);

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
          const response = await apiFetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`);
          const data = await response.json();

          // Hold the flat video-level detection payload (T5600) so addRegion can
          // slice instant tracking squares for newly created regions.
          setHighlightVideoDetections(data.detections_data || null);

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
          if (data.highlight_color) {
            setHighlightColor(data.highlight_color);
          }
          if (data.highlight_shape) setHighlightShape(data.highlight_shape);
          if (data.stroke_width != null) setStrokeWidth(data.stroke_width);
          if (data.fill_enabled != null) setFillEnabled(data.fill_enabled);
          if (data.fill_opacity != null) setFillOpacity(data.fill_opacity);
          if (data.dim_strength != null) setDimStrength(data.dim_strength);

          setOverlayLoadedProjectId(projectId);
          setOverlaySyncState('ready');
          setOverlayChangedSinceExport(false);
        } catch (err) {
          console.error('[OverlayScreen] Failed to load overlay data:', err);
          addHighlightRegion(0);
          setOverlayLoadedProjectId(projectId);
          setOverlaySyncState('ready');
        }
      })();
    }
  }, [projectId, effectiveOverlayMetadata?.duration, overlaySyncState, restoreHighlightRegions, setHighlightEffectType, setHighlightColor, setHighlightShape, overlayClipMetadata, addHighlightRegion, setOverlaySyncState, setOverlayLoadedProjectId, setOverlayChangedSinceExport, setHighlightVideoDetections]);

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
        dispatchOverlayAction('createRegion', () =>
          overlayActions.createRegion(projectId, region.startTime, region.endTime, regionId));
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
      dispatchOverlayAction('deleteRegion', () => overlayActions.deleteRegion(projectId, region.id));
    }
    setOverlayChangedSinceExport(true);
  }, [deleteHighlightRegion, projectId, canSyncActions, highlightRegions, setOverlayChangedSinceExport]);

  // Wrapped handler: Move region start
  const wrappedMoveHighlightRegionStart = useCallback((regionId, newStartTime) => {
    moveHighlightRegionStart(regionId, newStartTime);
    if (canSyncActions) {
      dispatchOverlayAction('updateRegionStart', () =>
        overlayActions.updateRegion(projectId, regionId, newStartTime, null));
    }
    setOverlayChangedSinceExport(true);
  }, [moveHighlightRegionStart, projectId, canSyncActions, setOverlayChangedSinceExport]);

  // Wrapped handler: Move region end
  const wrappedMoveHighlightRegionEnd = useCallback((regionId, newEndTime) => {
    moveHighlightRegionEnd(regionId, newEndTime);
    if (canSyncActions) {
      // Extend/shrink segment end. On failure this queues for Retry — the extended
      // bound is what lets manual keyframes past the original range survive (T4900).
      dispatchOverlayAction('updateRegionEnd', () =>
        overlayActions.updateRegion(projectId, regionId, null, newEndTime));
    }
    setOverlayChangedSinceExport(true);
  }, [moveHighlightRegionEnd, projectId, canSyncActions, setOverlayChangedSinceExport]);

  // Wrapped handler: Toggle region enabled
  const wrappedToggleHighlightRegion = useCallback((regionIndex, enabled) => {
    const region = highlightRegions[regionIndex];
    toggleHighlightRegion(regionIndex, enabled);
    if (region && canSyncActions) {
      dispatchOverlayAction('toggleRegion', () => overlayActions.toggleRegion(projectId, region.id, enabled));
    }
    setOverlayChangedSinceExport(true);
  }, [toggleHighlightRegion, projectId, canSyncActions, highlightRegions, setOverlayChangedSinceExport]);

  // Wrapped handler: Add/update keyframe
  const wrappedAddHighlightRegionKeyframe = useCallback((time, data) => {
    const region = getRegionAtTime(time);
    const result = addHighlightRegionKeyframe(time, data);
    if (result && canSyncActions && region) {
      // Persist via the shared keyframe-edit path (T3800). The helper mirrors a
      // snap-move as delete(old) + add(new): if the hook moved a nearby keyframe
      // onto this frame, the stale keyframe is deleted first — otherwise the add
      // appends a near-duplicate and the moved-from keyframe persists as an orphan
      // (the overlapping-keyframe / lost-boundary bug). Fire-and-forget, as before.
      //
      // Overlay keys the backend by time. The `add` keeps the original `time`
      // value (no frame round-trip); only `del` converts the moved-from frame.
      persistKeyframeEdit({
        resolution: {
          targetKey: timeToFrame(time, highlightRegionsFramerate),
          movedFromKey: result.movedFromFrame ?? null,
        },
        data,
        actions: {
          add: (frame, d) => dispatchOverlayAction('addKeyframe', () =>
            overlayActions.addKeyframe(projectId, region.id, { time, ...d })),
          del: (frame) => dispatchOverlayAction('deleteKeyframe', () =>
            overlayActions.deleteKeyframe(projectId, region.id, frameToTime(frame, highlightRegionsFramerate))),
        },
        awaited: false,
        onError: (err) => console.error('[OverlayScreen] Failed to sync keyframe:', err),
      });
    }
    setOverlayChangedSinceExport(true);
    return !!result;
  }, [addHighlightRegionKeyframe, projectId, canSyncActions, getRegionAtTime, highlightRegionsFramerate, setOverlayChangedSinceExport]);

  // Wrapped handler: Remove keyframe
  const wrappedRemoveHighlightRegionKeyframe = useCallback((time) => {
    const region = getRegionAtTime(time);
    removeHighlightRegionKeyframe(time);
    if (region && canSyncActions) {
      dispatchOverlayAction('deleteKeyframe', () => overlayActions.deleteKeyframe(projectId, region.id, time));
    }
    setOverlayChangedSinceExport(true);
  }, [removeHighlightRegionKeyframe, projectId, canSyncActions, getRegionAtTime, setOverlayChangedSinceExport]);

  // Wrapped handler: Set effect type
  const wrappedSetHighlightEffectType = useCallback((effectType) => {
    track('overlay_effect_change', { to: effectType }, { debugOnly: true });
    setHighlightEffectType(effectType);
    if (canSyncActions) {
      dispatchOverlayAction('setEffectType', () => overlayActions.setEffectType(projectId, effectType));
    }
    setOverlayChangedSinceExport(true);
  }, [setHighlightEffectType, projectId, canSyncActions, setOverlayChangedSinceExport]);

  const wrappedSetHighlightColor = useCallback((color) => {
    track('overlay_settings_change', { field: 'highlightColor', value: color }, { debugOnly: true });
    setHighlightColor(color);
    // T3700: quest_3 "Pick your highlight color"
    useQuestStore.getState().recordAchievement('overlay_color_set');
    if (canSyncActions) {
      dispatchOverlayAction('setHighlightColor', () => overlayActions.setHighlightColor(projectId, color));
    }
    setOverlayChangedSinceExport(true);
  }, [setHighlightColor, projectId, canSyncActions, setOverlayChangedSinceExport]);

  const wrappedSetStrokeWidth = useCallback((val) => {
    track('overlay_settings_change', { field: 'strokeWidth', value: val }, { debugOnly: true });
    setStrokeWidth(val);
    if (canSyncActions) {
      dispatchOverlayAction('setStrokeWidth', () => overlayActions.setStrokeWidth(projectId, val));
    }
    setOverlayChangedSinceExport(true);
  }, [setStrokeWidth, projectId, canSyncActions, setOverlayChangedSinceExport]);

  const wrappedSetFillEnabled = useCallback((val) => {
    track('overlay_settings_change', { field: 'fillEnabled', value: val }, { debugOnly: true });
    setFillEnabled(val);
    if (canSyncActions) {
      dispatchOverlayAction('setFillEnabled', () => overlayActions.setFillEnabled(projectId, val));
    }
    setOverlayChangedSinceExport(true);
  }, [setFillEnabled, projectId, canSyncActions, setOverlayChangedSinceExport]);

  const wrappedSetFillOpacity = useCallback((val) => {
    setFillOpacity(val);
    if (canSyncActions) {
      dispatchOverlayAction('setFillOpacity', () => overlayActions.setFillOpacity(projectId, val));
    }
    setOverlayChangedSinceExport(true);
  }, [setFillOpacity, projectId, canSyncActions, setOverlayChangedSinceExport]);

  const wrappedSetDimStrength = useCallback((val) => {
    track('overlay_settings_change', { field: 'dimStrength', value: val }, { debugOnly: true });
    setDimStrength(val);
    if (canSyncActions) {
      dispatchOverlayAction('setDimStrength', () => overlayActions.setDimStrength(projectId, val));
    }
    setOverlayChangedSinceExport(true);
  }, [setDimStrength, projectId, canSyncActions, setOverlayChangedSinceExport]);

  const wrappedSetHighlightShape = useCallback((val) => {
    track('overlay_settings_change', { field: 'highlightShape', value: val }, { debugOnly: true });
    setHighlightShape(val);
    // T3700: quest_3 "Choose the spotlight shape" (Body/Ground)
    useQuestStore.getState().recordAchievement('overlay_shape_set');
    if (canSyncActions) {
      dispatchOverlayAction('setHighlightShape', () => overlayActions.setHighlightShape(projectId, val));
    }
    setOverlayChangedSinceExport(true);
  }, [setHighlightShape, projectId, canSyncActions, setOverlayChangedSinceExport]);

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
    // Check if single clip has segments or crop modifications. T4270: read the
    // canonical raw-clip fields (`segments_data`, `crop_data`) -- the old
    // `firstClip.segments`/`.cropKeyframes` reads referenced a shape that no longer
    // exists, so this always returned false.
    const firstClip = clips[0];
    if (firstClip?.segments_data) {
      const { boundaries, segmentSpeeds, trimRange } = firstClip.segments_data;
      if (boundaries?.length > 2 || Object.keys(segmentSpeeds || {}).length > 0 || trimRange) {
        return true;
      }
    }
    if (firstClip?.crop_data?.length > 0) return true;
    return false;
  }, [hasClips, clips]);

  const hasMultipleClips = clips.length > 1;

  const overlay = OverlayContainer({
    videoRef,
    currentTime,
    duration,
    isPlaying,
    isSeeking,
    seek,
    togglePlay,
    framingVideoUrl,
    framingMetadata,
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
    highlightColor,  // Global color from store (used in preview)
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
  });

  const {
    currentHighlightState,
    playerDetectionEnabled,
    playerDetections,
    detectionVideoWidth,
    detectionVideoHeight,
    isDetectionLoading,
    regionHasDetections,
    showPlayerBoxes,
    togglePlayerBoxes,
    enablePlayerBoxes,
    handlePlayerSelect,
    handleHighlightChange,
    handleHighlightComplete,
    handleDetectionMarkerClick,
    // Spotlight loop playback (T5370)
    spotlightSpan,
    spotlightPlayMode,
    isPastSpotlight,
    handlePlaySpotlight,
    handlePlayFull,
    handleReturnToSpotlight,
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

  // Hide fullscreen button when it wouldn't meaningfully increase video size
  const fullscreenWorthwhile = useFullscreenWorthwhile(videoRef, isFullscreen);

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
      // Extract actual filename from current working video URL (format: working_64_abc123.mp4)
      // The URL might be a presigned R2 URL or a local API URL
      let filename = null;
      const currentUrl = workingVideo?.url || project?.working_video_url;
      if (currentUrl) {
        // Try to extract filename from URL path (before query params)
        const urlPath = currentUrl.split('?')[0];
        const pathParts = urlPath.split('/');
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart.endsWith('.mp4')) {
          filename = lastPart;
        }
      }

      // Fallback to projectId-based filename if extraction fails
      if (!filename) {
        filename = `${projectId}.mp4`;
        console.warn('[OverlayScreen] Could not extract filename from URL, using fallback:', filename);
      }

      const freshUrl = await forceRefreshUrl('working_videos', filename, localFallbackUrl);
      console.log('[OverlayScreen] Got fresh URL:', freshUrl?.substring(0, 60));

      if (freshUrl && !freshUrl.startsWith('blob:')) {
        loadVideoFromStreamingUrl(freshUrl, effectiveOverlayMetadata);
      } else {
        // Fallback to blob download
        await loadVideoFromUrl(freshUrl || localFallbackUrl, filename);
      }
    } catch (err) {
      console.error('[OverlayScreen] Failed to retry video load:', err);
    }
  }, [projectId, workingVideo, project, clearError, loadVideoFromStreamingUrl, loadVideoFromUrl, effectiveOverlayMetadata]);

  // Manual retry after working-video load has exhausted automatic attempts.
  // Refresh the project to get a fresh presigned URL (in case the failure was
  // due to URL expiry), then clear guards so the load effect re-runs.
  const handleRetryWorkingVideo = useCallback(async () => {
    console.log('[OverlayScreen] Manual retry of working video load');
    setWorkingVideoLoadError(null);
    setWorkingVideoMissing(false);
    workingVideoFetchIdRef.current = null;
    workingVideoAttemptsRef.current = 0;
    await refreshProject();
  }, [refreshProject]);

  const handleSwitchToFraming = useCallback(() => {
    // NOTE: Safety blob save removed - gesture-based actions sync immediately to backend.
    setEditorMode(EDITOR_MODES.FRAMING);
  }, [setEditorMode]);

  const handleBackToProjects = useCallback(() => {
    setEditorMode(EDITOR_MODES.PROJECT_MANAGER);
  }, [setEditorMode]);

  const handleExportComplete = useCallback((completed) => {
    refreshProject();
    // Reset the "changed since export" flag since we just exported
    setOverlayChangedSinceExport(false);
    if (onExportComplete) {
      onExportComplete(completed);
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
      onToggleFullscreen={fullscreenWorthwhile ? handleToggleFullscreen : undefined}
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
      isLoading={!workingVideoLoadError && (isLoading || isLoadingWorkingVideo || shouldWaitForWorkingVideo)}
      isVideoElementLoading={isVideoElementLoading}
      loadingProgress={loadingProgress}
      loadingElapsedSeconds={loadingElapsedSeconds}
      error={workingVideoLoadError || error}
      // T5440: a missing asset (hard 404) is NOT retryable — suppress the "Retry
      // Loading Video" button so the state reads as "re-export", not "try again".
      // A transient working-video load error still offers retry, as before.
      isUrlExpiredError={workingVideoMissing ? () => false : (workingVideoLoadError ? () => true : isUrlExpiredError)}
      onRetryVideo={workingVideoLoadError ? handleRetryWorkingVideo : handleRetryVideo}
      loadingMessage={isLoadingWorkingVideo || shouldWaitForWorkingVideo ? 'Loading working video...' : 'Loading video...'}
      // Playback controls
      togglePlay={togglePlay}
      stepForward={stepForward}
      stepBackward={stepBackward}
      restart={restart}
      seek={seek}
      // Spotlight loop playback (T5370)
      spotlightSpan={spotlightSpan}
      spotlightPlayMode={spotlightPlayMode}
      isPastSpotlight={isPastSpotlight}
      onPlaySpotlight={handlePlaySpotlight}
      onPlayFull={handlePlayFull}
      onReturnToSpotlight={handleReturnToSpotlight}
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
      highlightColor={highlightColor}
      onHighlightColorChange={wrappedSetHighlightColor}
      // Overlay tuning settings
      highlightShape={highlightShape}
      strokeWidth={strokeWidth}
      fillEnabled={fillEnabled}
      fillOpacity={fillOpacity}
      dimStrength={dimStrength}
      onHighlightShapeChange={wrappedSetHighlightShape}
      onStrokeWidthChange={wrappedSetStrokeWidth}
      onFillEnabledChange={wrappedSetFillEnabled}
      onFillOpacityChange={wrappedSetFillOpacity}
      onDimStrengthChange={wrappedSetDimStrength}
      // Player detection
      playerDetectionEnabled={playerDetectionEnabled}
      playerDetections={playerDetections}
      detectionVideoWidth={detectionVideoWidth}
      detectionVideoHeight={detectionVideoHeight}
      isDetectionLoading={isDetectionLoading}
      onPlayerSelect={handlePlayerSelect}
      showPlayerBoxes={showPlayerBoxes}
      onTogglePlayerBoxes={togglePlayerBoxes}
      onEnablePlayerBoxes={enablePlayerBoxes}
      onDetectionMarkerClick={handleDetectionMarkerClick}
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
      // T740: Outdated framing warning
      framingOutdated={framingOutdated}
    />
  );
}

export default OverlayScreen;
