import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { List, X } from 'lucide-react';
import { FocusModeView } from '../modes';
import { FocusContainer } from '../containers';
import { useCrop, useSegments } from '../modes/focus';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { useVideo } from '../hooks/useVideo';
import { useClipManager } from '../hooks/useClipManager';
import { useFullscreenWorthwhile } from '../hooks/useFullscreenWorthwhile';
import { useIsCockpit } from '../hooks/useIsMobile';
import { useReadyGames } from '../stores/gamesDataStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ClipSelectorSidebar } from '../components/ClipSelectorSidebar';
import { FileUpload } from '../components/FileUpload';
import { toast } from '../components/shared';
import { CollectionPlayer } from '../components/collections/CollectionPlayer';
import { FocusPublishActionBar } from '../components/FocusPublishActionBar';
import { usePublishIntentStore } from '../stores/publishIntentStore';
import { FOCUS_PUBLISH_LATER_TOAST, FOCUS_ADD_SPOTLIGHT_TOAST, FOCUS_PREVIEW } from '../config/displayNames';
import { resolveWorkingVideoPreviewUrl } from '../utils/resolveWorkingVideoPreviewUrl';
import { deriveFramingCtaState } from '../utils/framingCtaState';
import { recordFunnelEvent, FUNNEL_EVENTS } from '../utils/funnelEvents';
import { resultRetentionNote } from '../utils/resultRetentionNote';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import { forceRefreshUrl } from '../utils/storageUrls';
import { warmVideoCache, pushClipRanges } from '../utils/cacheWarming';
import { clipFileUrl as getClipFileUrlSelector, clipCropKeyframes, clipSegments, clipRotation } from '../utils/clipSelectors';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useProjectDataStore, useFocusStore, useEditorStore, EDITOR_MODES, useOverlayStore, useProjectsStore, useVideoStore, useRegisterActiveSaveHandler, useQuestStore } from '../stores';
import { useFocusCompletionStore } from '../stores/focusCompletionStore';
import { useProject } from '../contexts/ProjectContext';
import { shouldPersistFocusForOverlayTransition, shouldSkipFocusCompletionPreview } from './focusOverlayTransition';
import { offerFocusCompletionPreview } from './focusCompletionOffer';
import { isClipFromAnotherProject, shouldRetryClipVideoViaProxy } from './clipVideoResolution';
import { acknowledgeExportJob } from '../utils/acknowledgeExportJob';
import { setPendingGame } from '../utils/pendingNavigation';

// T8390: safety-net expiry for a staked publish intent (see handlePublish).
// ExportButtonContainer exposes no onError callback to this screen, so a
// render that fails after Publish stakes the flag has no precise clear point
// — this bounds the staleness window instead of leaving it staked forever
// (which would silently auto-publish a LATER, unrelated export of the same
// project). Generous relative to a spotlight-less single-clip render.
const PUBLISH_INTENT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * FocusScreen - Self-contained screen for Framing mode
 *
 * T250: Uses raw backend clip data from projectDataStore.
 * No sync effect needed — store is the single source of truth.
 * Backend integer IDs used everywhere. Derived values via selectors.
 */
export function FocusScreen({
  onExportComplete,
  onProceedToOverlay,
  exportButtonRef: externalExportButtonRef,
  onPublishWithoutSpotlight,
  // T10840: routes the cockpit's transport-rail Back chevron through App's
  // handleModeChange (with its framing-changed safety dialog) — the cockpit
  // shell covers the UnifiedHeader, so its Home button is unreachable there.
  onExitToHome,
}) {
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // T10840 (D1/D3): a phone held sideways enters the landscape cockpit — a pure
  // derivation, no state/effect. When true, the 224px clip sidebar and its mobile
  // toggle are gated off here (clips live in the cockpit's Clips sheet instead);
  // FocusModeView early-returns the cockpit shell on the same derivation.
  const cockpit = useIsCockpit();

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
  const changeAspectRatioAction = useProjectDataStore(state => state.changeAspectRatio);

  // Framing persistent state
  const {
    includeAudio,
    setIncludeAudio,
    videoFile: storedVideoFile,
    setVideoFile: setStoredVideoFile,
    framingChangedSinceExport,
    setFramingChangedSinceExport,
  } = useFocusStore();

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
  // T10650: spinner while resolveWorkingVideoPreviewUrl resolves the "Back to
  // Preview" URL. Ephemeral gesture state, never persisted.
  const [backToPreviewLoading, setBackToPreviewLoading] = useState(false);
  // T8390: post-export preview + publish-exit action bar (overlay is an offer,
  // not a stage; the preview mounts BEFORE any choice, replacing T8520's
  // choose-then-preview card with preview-first per the approved design).
  // T9285: moved from local useState into focusCompletionStore (a store, not
  // props) — the writer is App-level (FocusCompletionRecovery, the recovery
  // path) and the reader is this screen, with no ref/prop relationship
  // between them (same rationale as publishIntentStore/reelPreviewStore).
  // `previewOpen` is derived, never stored twice: the store's `preview` slice
  // can carry payload for a project other than the one this screen has open.
  const completionPreview = useFocusCompletionStore((s) => s.preview);
  const openPreview = useFocusCompletionStore((s) => s.openPreview);
  const closePreview = useFocusCompletionStore((s) => s.closePreview);
  const previewOpen = completionPreview?.projectId === projectId;
  // T10660: "Publish without spotlight" now renders headlessly (the user stays in
  // Focus with the preview open), so the Publish card's loading state is derived
  // straight from the publish-intent stake for THIS project — no local flag to
  // reset. The stake is set in handlePublish and cleared by
  // handleOverlayExportCompletion on completion (its idempotency token) or by
  // App's error path, so this tracks the render's whole lifetime.
  const publishIntentProjectId = usePublishIntentStore((s) => s.projectId);
  const publishLoading = publishIntentProjectId === projectId;
  // T9100: FocusScreen no longer READS the shared workingVideo record (the
  // post-export preview now uses the completion store); it still WRITES it via
  // setWorkingVideo. So the reactive selector is gone, but the store action stays.
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

  // Reel-level aspect-ratio change (T3910): a single gesture that re-fits every clip's crop
  // to the new ratio server-side, then refreshes clips + project so the UI reflects the
  // authoritative re-fit. Surgical (sends only the ratio); no reactive write-back.
  const handleAspectRatioChange = useCallback(async (newRatio) => {
    if (!projectId || newRatio === projectAspectRatio) return;
    const result = await changeAspectRatioAction(projectId, newRatio);
    if (result?.success) {
      // Re-fetch the project so projectAspectRatio updates → the useCrop ratio-sync effect
      // sets the active clip's reticule shape; re-fit boxes arrive via the refreshed clips.
      await refreshProject();
    } else if (result?.error) {
      console.error('[Framing] Aspect ratio change failed:', result.error);
    }
  }, [projectId, projectAspectRatio, changeAspectRatioAction, refreshProject]);

  // Games — Zustand store (ready-only: pending uploads excluded).
  // Hydrated by /api/bootstrap (App.jsx setFromBootstrap); Framing reads the cached
  // list and never refetches on mount — see the invariant in keyframes-framing.md.
  const games = useReadyGames();

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

  // Seed the horizon-straighten angle from the selected clip (like crop_data).
  const selectedClipRotation = useMemo(
    () => (selectedClip ? clipRotation(selectedClip) : 0),
    [selectedClip]
  );

  // Crop hook
  const {
    aspectRatio,
    keyframes,
    isEndKeyframeExplicit,
    copiedCrop,
    framerate,
    rotation,
    updateAspectRatio,
    setRotation,
    clampCropForCurrentRotation,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    setEndFrame: setCropEndFrame,
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
    getCropDataAtTime,
    getKeyframesForExport,
    reset: resetCrop,
    restoreState: restoreCropState,
  } = useCrop(metadata, trimRange, selectedClipCropKeyframes, selectedClipRotation);

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
    zoomIn: timelineZoomIn,
    zoomOut: timelineZoomOut,
    resetZoom: resetTimelineZoom,
  } = useTimelineZoom();
  // T10930: the visible `-  N%  +` chip (TimelineBase) — wheel zoom's affordance.
  const timelineZoomControls = useMemo(
    () => ({ zoomIn: timelineZoomIn, zoomOut: timelineZoomOut, resetZoom: resetTimelineZoom }),
    [timelineZoomIn, timelineZoomOut, resetTimelineZoom],
  );

  // Wrap saveFramingEdits to bind projectId
  const boundSaveFramingEdits = useCallback((clipId, data) => {
    if (projectId) return saveFramingEdits(projectId, clipId, data);
    return Promise.resolve({ success: false });
  }, [projectId, saveFramingEdits]);

  // FocusContainer
  const framing = FocusContainer({
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
    setCropEndFrame,
    restoreCropState,
    updateAspectRatio,
    rotation,
    setRotation,
    clampCropForCurrentRotation,
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
    saveFramingEdits: boundSaveFramingEdits,
    onCropChange: setDragCrop,
    onUserEdit: () => { clipHasUserEditsRef.current = true; },
    setFramingChangedSinceExport,
    clipMetadataCache,
  });

  const {
    clipsWithCurrentState: framingClipsWithCurrentState,
    selectedClipEffectiveDuration,
    projectEffectiveDuration,
    canUndoFraming,
    handleCropChange: framingHandleCropChange,
    handleCropComplete: framingHandleCropComplete,
    handleTrimSegment: framingHandleTrimSegment,
    handleDetrimStart: framingHandleDetrimStart,
    handleDetrimEnd: framingHandleDetrimEnd,
    handleKeyframeClick: framingHandleKeyframeClick,
    handleKeyframeDelete: framingHandleKeyframeDelete,
    handleKeyframeTimeMove: framingHandleKeyframeTimeMove,
    handleCopyCrop: framingHandleCopyCrop,
    handlePasteCrop: framingHandlePasteCrop,
    handleAddSplit: framingHandleAddSplit,
    handleRemoveSplit: framingHandleRemoveSplit,
    handleSegmentSpeedChange: framingHandleSegmentSpeedChange,
    handleSetRotation: framingHandleSetRotation,
    handleUndoFraming: framingHandleUndoFraming,
    clearFramingHistory,
    saveCurrentClipState: framingSaveCurrentClipState,
  } = framing;

  // T5070: expose this mounted screen's saveCurrentClipState to the update-gate's
  // step-3 flush (updateFlush.js), which runs outside the framing component tree.
  // Registration only -- no persistence happens here; the flush calls the
  // function itself, gesture-triggered by the "Update now" click.
  // T6190: registered via a STABLE ref-wrapper (not keyed on the handler identity) --
  // a reactive registration fed an unbounded setState loop here. See focusStore.js.
  useRegisterActiveSaveHandler(framingSaveCurrentClipState);

  // Track the last loaded URL to detect when clip changes
  const lastLoadedUrlRef = useRef(null);
  const stateRestoredForUrlRef = useRef(null); // Guard against infinite restore loops

  // Dedupe playback-url fetches: the mount effects (useLayoutEffect + the
  // clips/metadata-keyed effect) each call getClipVideoConfig before the
  // lastLoadedUrlRef guard can run, firing several identical requests per
  // clip. Cache the in-flight promise per clip id with a short TTL (presigned
  // URLs are valid 4h; 60s just absorbs the mount burst).
  const clipVideoConfigCacheRef = useRef(new Map()); // clipId -> { promise, ts }
  const CLIP_CONFIG_CACHE_TTL_MS = 60000;

  // T8310: when the selected clip's source game was reclaimed (playback-url 410
  // source_expired), render a deliberate expired panel instead of a broken
  // player. Set at every clip load from the resolved config (cache-safe), so an
  // expired->healthy clip switch clears it. { canExtend } | null.
  const [sourceExpired, setSourceExpired] = useState(null);
  const applySourceExpiry = useCallback((cfg) => {
    setSourceExpired(cfg?.sourceExpired ? { canExtend: !!cfg.canExtend } : null);
  }, []);

  /**
   * Get the video URL and clip range for a clip.
   * Game clips use the game video URL with a clip offset; uploaded/extracted clips use file_url directly.
   */
  const getClipVideoConfig = useCallback(async (clip) => {
    // T10740: refuse a clip left over from a DIFFERENT project (see
    // clipVideoResolution.js). Checked BEFORE the cache so the stale pair never
    // occupies a cache slot the fresh list would then hit.
    if (isClipFromAnotherProject(clip, projectId)) {
      console.warn(
        `[Framing] Ignoring stale clip ${clip.id} from project ${clip.project_id} `
        + `while this screen is project ${projectId} - waiting for the fresh clips list`
      );
      return { url: null, gameUrl: null, clipRange: null };
    }
    if (clip.game_video_url && clip.start_time != null && clip.end_time != null) {
      const cached = clipVideoConfigCacheRef.current.get(clip.id);
      if (cached && performance.now() - cached.ts < CLIP_CONFIG_CACHE_TTL_MS) {
        return cached.promise;
      }
      const promise = (async () => {
        try {
          const res = await apiFetch(
            `${API_BASE}/api/clips/projects/${projectId}/clips/${clip.id}/playback-url`
          );
          // T8310: the source game video was reclaimed post-expiry. Do NOT fall
          // back to the /stream proxy (it 410s the same way) — surface a
          // deliberate expired state so no <video> mounts against a dead URL.
          if (res.status === 410) {
            let canExtend = false;
            try {
              const body = await res.json();
              canExtend = !!(body?.detail?.code === 'source_expired' && body?.detail?.can_extend);
            } catch { /* body optional */ }
            return { url: null, gameUrl: null, clipRange: null, sourceExpired: true, canExtend };
          }
          // T10740: a 4xx is OUR endpoint rejecting the pair we sent; the proxy
          // resolves the SAME pair and fails identically (see clipVideoResolution.js).
          if (!res.ok && !shouldRetryClipVideoViaProxy(res.status)) {
            console.error(
              `[Framing] playback-url ${res.status} for project=${projectId} clip=${clip.id} `
              + '- not falling back to the proxy (it resolves the same pair)'
            );
            return { url: null, gameUrl: null, clipRange: null };
          }
          if (!res.ok) throw new Error(`${res.status}`);
          const data = await res.json();
          return {
            url: data.url,
            gameUrl: null,
            clipRange: {
              clipOffset: data.start_time,
              clipDuration: data.end_time - data.start_time,
            },
          };
        } catch (err) {
          console.warn('[Framing] Presigned URL fetch failed, falling back to proxy:', err.message);
          const proxyUrl = `${API_BASE}/api/clips/projects/${projectId}/clips/${clip.id}/stream`;
          return {
            url: proxyUrl,
            gameUrl: null,
            clipRange: {
              clipOffset: clip.start_time,
              clipDuration: clip.end_time - clip.start_time,
            },
          };
        }
      })();
      clipVideoConfigCacheRef.current.set(clip.id, { promise, ts: performance.now() });
      return promise;
    }
    // Uploaded/extracted clip: use file_url directly (no offset)
    const url = getClipFileUrlSelector(clip, projectId);
    return { url, gameUrl: null, clipRange: null };
  }, [projectId]);

  // Derive clip range for the currently selected clip (used by VideoPlayer for preload hints)
  const currentClipRange = useMemo(() => {
    if (!selectedClip) return null;
    if (selectedClip.game_video_url && selectedClip.start_time != null && selectedClip.end_time != null) {
      return {
        clipOffset: selectedClip.start_time,
        clipDuration: selectedClip.end_time - selectedClip.start_time,
      };
    }
    return null;
  }, [selectedClip]);

  // T6190: No mount refetch here. useProjectLoader.loadProject is the single owner of the
  // project-open clips fetch; annotate edits reach Framing via invalidateClips on the
  // leave-annotate mode-change gesture (App.jsx handleModeChange). See the invariant in
  // keyframes-framing.md — do NOT re-add a "just to be safe" mount fetchClips.

  // T1460: gesture-driven warm. The /storage/warmup tier-1 queue is built at
  // app init and excludes exported projects, so opening framing on any project
  // that was in tier-1=0 state would always land on the cold proxy path. Fire
  // pushClipRanges when framing mounts with clips — this is the user gesture
  // "opened framing", and it prepends the right ranges at the front of tier-1.
  // Key on clip ids so store re-emits with same identity don't re-queue.
  const warmableClipIdsKey = useMemo(
    () => clips
      .filter(c => c.game_video_url && c.start_time != null && c.end_time != null && c.video_duration && c.video_size)
      .map(c => c.id)
      .join(','),
    [clips]
  );
  useEffect(() => {
    if (!warmableClipIdsKey) return;
    const ranges = clips
      .filter(c => c.game_video_url && c.start_time != null && c.end_time != null && c.video_duration && c.video_size)
      .map(c => ({
        clipId: c.id,
        url: c.game_video_url,
        startTime: c.start_time,
        endTime: c.end_time,
        videoDuration: c.video_duration,
        videoSize: c.video_size,
      }));
    if (ranges.length) pushClipRanges(ranges);
  }, [warmableClipIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- warmableClipIdsKey captures the identity we care about

  // T580: On mount, immediately load the first clip's video before first paint.
  // When switching from overlay → framing, the shared videoStore may still hold
  // the working video (cropped/exported). Loading the correct clip URL here
  // (in useLayoutEffect) updates the store before the browser paints, so the
  // user never sees stale video or a "no video loaded" flash.
  useLayoutEffect(() => {
    if (clips.length === 0) return;
    const controller = new AbortController();
    const targetClip = (selectedClipId && clips.find(c => c.id === selectedClipId)) || clips[0];

    (async () => {
      const cfg = await getClipVideoConfig(targetClip);
      const { url: clipUrl, gameUrl, clipRange } = cfg;
      applySourceExpiry(cfg);
      if (!clipUrl || clipUrl.startsWith('blob:')) return;
      if (controller.signal.aborted) return;
      const meta = clipMetadataCache[targetClip.id];
      warmVideoCache(clipUrl);
      if (controller.signal.aborted) return;
      loadVideoFromStreamingUrl(clipUrl, meta?.metadata || null, clipRange, { gameUrl });
      lastLoadedUrlRef.current = clipUrl.split('?')[0];
    })();

    return () => controller.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only, mirrors initial load effect

  // Initialize video playback when entering framing mode
  // T250: Clips are raw backend data. Get metadata from cache.
  useEffect(() => {
    if (clips.length === 0) return;

    const firstClip = clips[0];
    const controller = new AbortController();

    (async () => {
      const cfg = await getClipVideoConfig(firstClip);
      const { url: clipUrl, gameUrl: firstGameUrl, clipRange } = cfg;
      applySourceExpiry(cfg);
      if (!clipUrl) return;
      if (controller.signal.aborted) return;

      const firstClipWithMeta = getClipWithMeta(firstClip);

      // Restore framing state (crop keyframes, segments) from clip data if not already done.
      // The useLayoutEffect above may have already loaded the video (for overlay→framing
      // transitions), but state restoration still needs to happen. Guard with ref to
      // prevent infinite loops (restore updates state → re-render → effect re-fires).
      // Guard on URL path (without query) because R2 signatures regenerate per render.
      const clipUrlKey = clipUrl.split('?')[0];
      const clipDuration = firstClipWithMeta?.duration;
      if (stateRestoredForUrlRef.current !== clipUrlKey && clipDuration) {
        stateRestoredForUrlRef.current = clipUrlKey;
        const parsedSegments = clipSegments(firstClip, clipDuration);
        const parsedCropKfs = clipCropKeyframes(firstClip);

        if (parsedSegments) {
          restoreSegmentState(parsedSegments, clipDuration);
        }

        if (parsedCropKfs && parsedCropKfs.length > 0) {
          const endFrame = Math.round(clipDuration * (firstClipWithMeta?.framerate || 30));
          if (endFrame > 0) {
            restoreCropState(parsedCropKfs, endFrame);
          }
        }

        if (firstClip.id) {
          previousClipIdRef.current = firstClip.id;
        }
      }

      // Skip video loading if already loaded (e.g., by useLayoutEffect on mount)
      // Compare path-without-query since signed R2 URLs regenerate per render.
      if (lastLoadedUrlRef.current === clipUrlKey) return;
      if (controller.signal.aborted) return;

      lastLoadedUrlRef.current = clipUrlKey;
      initialLoadDoneRef.current = true;

      if (!clipUrl.startsWith('blob:')) {
        warmVideoCache(clipUrl);
        if (controller.signal.aborted) return;
        loadVideoFromStreamingUrl(clipUrl, firstClipWithMeta?.metadata || null, clipRange, { gameUrl: firstGameUrl });
      } else {
        const file = await loadVideoFromUrl(clipUrl, firstClip.filename || 'clip.mp4');
        if (controller.signal.aborted) return;
        if (file) {
          setVideoFile(file);
        }
      }
    })();

    return () => controller.abort();
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
      console.warn('[FocusScreen] Selected clip not found:', selectedClipId);
      return;
    }
    // T10740: this effect restores crop/segment state into the hooks BEFORE it
    // resolves a video URL, so the guard inside getClipVideoConfig is too late
    // here — a leftover clip from the previous project would push ITS keyframes
    // into this project's editor. Bail before touching any hook state; the fresh
    // clips list re-fires this effect moments later with the right clip.
    if (isClipFromAnotherProject(newClip, projectId)) return;

    // Set restoring flag synchronously BEFORE async work.
    // This prevents the sync effects (declared after this effect) from writing
    // stale hook state to the new clip's store slot during this render cycle.
    isRestoringClipStateRef.current = true;
    previousClipIdRef.current = selectedClipId;

    const newClipWithMeta = getClipWithMeta(newClip);
    const newClipDuration = newClipWithMeta?.duration;
    const newParsedSegments = newClipDuration ? clipSegments(newClip, newClipDuration) : null;
    const newParsedCropKfs = clipCropKeyframes(newClip);

    const switchClip = async () => {
      try {
        // 1. Restore new clip's segments state
        if (newParsedSegments && newClipDuration) {
          restoreSegmentState(newParsedSegments, newClipDuration);
        } else {
          resetSegments();
          if (newClipDuration) {
            initializeSegments(newClipDuration);
          }
        }

        // 2. Restore new clip's crop keyframes BEFORE loading video
        if (newParsedCropKfs && newParsedCropKfs.length > 0 && newClipDuration) {
          const endFrame = Math.round(newClipDuration * (newClipWithMeta?.framerate || 30));
          if (endFrame > 0) {
            restoreCropState(newParsedCropKfs, endFrame);
          }
        } else {
          resetCrop();
        }

        // 3. Load new clip's video (or just seek if same video URL)
        const newCfg = await getClipVideoConfig(newClip);
        const { url: newClipUrl, gameUrl: newGameUrl, clipRange: newClipRange } = newCfg;
        applySourceExpiry(newCfg);
        if (newClipUrl) {
          if (!newClipUrl.startsWith('blob:')) {
            warmVideoCache(newClipUrl);
            loadVideoFromStreamingUrl(newClipUrl, newClipWithMeta?.metadata || null, newClipRange, { gameUrl: newGameUrl });
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
  // Persistence is now gesture-based: each user action in FocusContainer fires
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

  // Current crop state. With no keyframes, interpolateCrop falls back to the
  // default centered crop so the reticule still renders (and matches what the GPU
  // export applies for an empty crop).
  //
  // 2026-09-18 data-loss fix: the safe-area clamp for the straighten angle
  // used to be baked into the STORED keyframes (destructive, irreversible —
  // see useCrop.setRotation). Keyframes now hold the user's true framing
  // verbatim; the clamp applies here, at display time, so preview always
  // matches what the export pipeline renders without ever touching the saved
  // data. `dragCrop` (an active drag in progress) stays unclamped so the user
  // sees exactly where they're dragging — handleCropComplete clamps it on
  // release, the same way it always has.
  const currentCropState = useMemo(() => {
    const rawCrop = dragCrop || interpolateCrop(currentTime);
    if (!rawCrop) return null;
    const crop = dragCrop ? rawCrop : clampCropForCurrentRotation(rawCrop);
    return {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height
    };
  }, [dragCrop, currentTime, interpolateCrop, clampCropForCurrentRotation]);

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

    console.log('[FocusScreen] Retrying video load for clip:', selectedClipWithMeta.id);
    clearError();

    const filename = selectedClipWithMeta.filename || `${selectedClipWithMeta.id}.mp4`;
    const localFallbackUrl = `${API_BASE}/api/clips/${selectedClipWithMeta.id}/file`;

    try {
      const freshUrl = await forceRefreshUrl('raw_clips', filename, localFallbackUrl);
      console.log('[FocusScreen] Got fresh URL:', freshUrl?.substring(0, 60));

      if (freshUrl && !freshUrl.startsWith('blob:')) {
        warmVideoCache(freshUrl);
        loadVideoFromStreamingUrl(freshUrl, selectedClipWithMeta.metadata || null);
      } else {
        await loadVideoFromUrl(freshUrl || localFallbackUrl, filename);
      }
    } catch (err) {
      console.error('[FocusScreen] Failed to retry video load:', err);
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

  // T9285 review fix: the openMode staleness-scoping guard used to live here,
  // but this effect can only run while FocusScreen is mounted, which requires
  // editorMode === FRAMING — and `openMode` is always FRAMING too for this
  // payload, so `completionPreview.openMode !== editorMode` could never be
  // true during this component's lifetime (dead code). The guard now lives in
  // the always-mounted `FocusCompletionRecovery` (same App-level double-mount
  // as DraftReelPreview), which can actually observe the user navigating away
  // (e.g. the mobile back button) and clear the payload before it resurrects.

  // Handle file selection (local upload - not from library)
  const handleFileSelect = async (file) => {
    try {
      const videoMetadata = await extractVideoMetadata(file);
      // Upload to backend
      if (projectId) {
        await uploadClipWithMetadataAction(projectId, { file, name: file.name });
      }
    } catch (err) {
      console.error('[FocusScreen] Failed to add clip:', err);
    }
  };

  // Handle proceed to overlay
  // T9790: `exportJobId` (the completed framing job's id, === the client-
  // generated export_id ExportButtonContainer sent as this render's job key) is
  // threaded through so it can be stamped onto the preview payload and
  // acknowledged on whichever of the four decision gestures the user picks.
  const handleProceedToOverlayInternal = useCallback(async (renderedVideoBlob, clipMetadata, exportedProjectId, exportJobId) => {
    const currentlyViewingProjectId = useProjectsStore.getState().selectedProjectId;

    console.log('[FocusScreen] Starting overlay transition...', {
      exportedProjectId,
      currentProjectId: currentlyViewingProjectId,
      closureProjectId: projectId
    });

    // T9280: skip the completion preview ONLY when the user has deliberately
    // moved to a DIFFERENT project. A null/absent currentlyViewingProjectId is a
    // transient no-selection blip, NOT a deliberate navigation — treating it as
    // one silently dropped the T8390 preview-first completion screen (reported on
    // mobile). shouldSkipFocusCompletionPreview requires BOTH ids truthy + differ.
    if (shouldSkipFocusCompletionPreview(exportedProjectId, currentlyViewingProjectId)) {
      console.log('[FocusScreen] Export completed for different project, ignoring navigation', {
        exportedProjectId,
        currentProjectId: currentlyViewingProjectId
      });
      if (onExportComplete) {
        onExportComplete();
      }
      return;
    }

    // T4020: The export -> overlay transition is NOT a user gesture. By now the
    // rendered working video's metadata has superseded the source clip's, so
    // useCrop/useSegments have re-initialized to defaults (empty crop + default
    // segments). A full-state save here would write that empty/default state as
    // a new MAX(version), shadowing the real exported version. The user's edits
    // were already persisted by the pre-render full-state save in
    // ExportButtonContainer (and surgically per gesture). The gate is centralized
    // and unit-tested to stay closed; see focusOverlayTransition.js.
    if (shouldPersistFocusForOverlayTransition()) {
      try {
        await framingSaveCurrentClipState();
      } catch (err) {
        console.warn('[FocusScreen] Failed to save clip state (continuing):', err);
      }
    }

    let workingVideoSet = false;

    if (renderedVideoBlob) {
      const url = URL.createObjectURL(renderedVideoBlob);

      try {
        console.log('[FocusScreen] Creating blob URL and extracting metadata...');
        const meta = await extractVideoMetadata(renderedVideoBlob);
        console.log('[FocusScreen] Video metadata extracted:', { duration: meta?.duration, width: meta?.width, height: meta?.height });

        setWorkingVideo({ file: renderedVideoBlob, url, metadata: meta });
        workingVideoSet = true;
      } catch (err) {
        console.warn('[FocusScreen] Metadata extraction failed, using fallback:', err.message);

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

        console.log('[FocusScreen] Using fallback metadata:', fallbackMeta);
        setWorkingVideo({ file: renderedVideoBlob, url, metadata: fallbackMeta });
        workingVideoSet = true;
      }
    } else {
      setIsLoadingWorkingVideo(true);
      console.log('[FocusScreen] MVC flow: working video on server, signaling OverlayScreen to wait');
      setWorkingVideo(null);

      console.log('[FocusScreen] Refreshing project to get new working_video_id');
      await refreshProject();

      // T8390: the post-export preview mounts IMMEDIATELY on this same
      // completion callback (below) and needs a playable URL now, not just
      // the refreshed working_video_id pointer — resolve it (degrades
      // gracefully to no preview on failure; see resolveWorkingVideoPreviewUrl).
      // T9285: setWorkingVideo(null) above stays as-is so OverlayScreen's real
      // loader (OverlayScreen.jsx:487) runs on entry and populates metadata +
      // clears the loading spinner. The preview itself opens via
      // focusCompletionStore, the same store the recovery path writes.
      const previewUrl = await resolveWorkingVideoPreviewUrl(projectId);
      offerFocusCompletionPreview({
        projectId,
        previewUrl,
        openMode: EDITOR_MODES.FRAMING,
        jobId: exportJobId,
        openPreview,
        recordAchievement: (id) => useQuestStore.getState().recordAchievement(id),
      });

      workingVideoSet = true;
    }

    if (clipMetadata) {
      setOverlayClipMetadata(clipMetadata);
      console.log('[FocusScreen] Clip metadata set:', clipMetadata?.source_clips?.length, 'clips');
    }

    setFramingChangedSinceExport(false);

    // T10650: the render just stamped working_clips.exported_at server-side, but
    // our in-memory clips still carry the pre-render version (an in-session edit
    // to an exported clip mints a new version with exported_at NULL, fetched at
    // edit time). Without this refetch the durable staleness signal stays NULL in
    // memory, so deriveFramingCtaState would read "stale" and show "Generate
    // Framing" instead of "Back to Preview" until a reload. Part of the
    // completion gesture flow (a read, not reactive persistence).
    try {
      await fetchProjectClips();
    } catch (err) {
      console.warn('[FocusScreen] Failed to refresh clips after export (continuing):', err);
    }

    if (onProceedToOverlay) {
      try {
        await onProceedToOverlay(renderedVideoBlob, clipMetadata);
      } catch (err) {
        console.warn('[FocusScreen] Parent onProceedToOverlay failed (continuing):', err);
      }
    }

    // T9285: the preview-opening + achievement call moved into the renderedVideoBlob-
    // less branch above (where previewUrl is actually resolved); this is now
    // only the "neither branch produced a working video" failure log.
    if (!workingVideoSet) {
      console.error('[FocusScreen] Cannot offer overlay — working video not set');
    }
  }, [framingSaveCurrentClipState, onProceedToOverlay, setWorkingVideo, setOverlayClipMetadata, setFramingChangedSinceExport, setEditorMode, clips, clipMetadataCache, globalAspectRatio, refreshProject, projectId, onExportComplete, setIsLoadingWorkingVideo, openPreview, fetchProjectClips]);

  // T9790: acknowledge the completed framing job on the decision gesture. The
  // live completion path (offerFocusCompletionPreview) deliberately does NOT
  // acknowledge at raw completion time — useExportRecovery also skips framing
  // jobs — so a tab discard BEFORE the user picks any of the four actions still
  // re-prompts the completion (the §6a property). The write fires here, tied to
  // an actual choice, marking only `acknowledged_at` server-side. Reads the
  // job id straight from the preview payload (getState, so it works regardless
  // of render timing and needs no dependency); a null id (e.g. a preview
  // opened before T9790 threaded the id) is a no-op, never a bad request.
  const acknowledgeCompletionJob = useCallback(() => {
    const jobId = useFocusCompletionStore.getState().preview?.jobId;
    if (jobId) acknowledgeExportJob(jobId);
  }, []);

  // T8390: the four post-preview gesture handlers. Each emits its own
  // FLOW_EVENT from the click handler (never a reactive watcher).
  const handleAddSpotlight = useCallback(() => {
    acknowledgeCompletionJob();
    // Identical to today's behavior — everything is already staged. No new event:
    // App.jsx's effect emits the overlay-entry achievement when editorMode becomes
    // OVERLAY.
    closePreview();
    // T8390: defense-in-depth — abandon a stale publish intent for THIS
    // project (e.g. Publish was tapped on an earlier failed render, this is
    // a fresh preview for the same project). See PUBLISH_INTENT_TIMEOUT_MS.
    if (usePublishIntentStore.getState().projectId === projectId) usePublishIntentStore.getState().clear();
    // 2026-09-08: confirm what happened before leaving the screen (product
    // owner: every action-bar choice should say what happened + what's next).
    toast.success(FOCUS_ADD_SPOTLIGHT_TOAST.title, { message: FOCUS_ADD_SPOTLIGHT_TOAST.message });
    setEditorMode('overlay');
  }, [setEditorMode, projectId, closePreview, acknowledgeCompletionJob]);

  const handleAddSpotlightLater = useCallback(() => {
    acknowledgeCompletionJob();
    closePreview();
    if (usePublishIntentStore.getState().projectId === projectId) usePublishIntentStore.getState().clear();
    useQuestStore.getState().recordAchievement('overlay_deferred');
    // T10010 activation funnel: "Save draft"/defer is a real user gesture. IDs only.
    recordFunnelEvent(FUNNEL_EVENTS.DRAFT_SAVED, { project_id: projectId });
    // T8390: explainer toast — routed by is_auto_created (T8360's already-approved
    // split), since that's also where the draft actually landed (single-clip auto
    // drafts -> Clips tab; multi-clip drafts -> Highlights). Copy is verbatim from
    // the approved design; centralized in displayNames.js, not inlined here.
    const copy = project?.is_auto_created
      ? FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP
      : FOCUS_PUBLISH_LATER_TOAST.MULTI_CLIP;
    toast.success(copy.title, { message: copy.message, duration: 10000 });
    // Navigation only — lands on the drafts surface. Persists NOTHING; the draft
    // stays at its current stage and the Overlay tab remains enabled.
    useEditorStore.getState().goToProjectManager();
  }, [project?.is_auto_created, projectId, closePreview, acknowledgeCompletionJob]);

  // T8390: Publish — renamed from "Finish Now" now that the user has actually
  // watched the preview before deciding. ONE tap, TRUE publish: this fires the
  // spotlight-less overlay render and stakes the publish INTENT via
  // publishIntentStore before triggering it. App.jsx's shared export-completion
  // handler (handleOverlayExportCompletion) reads that stake when THIS project's
  // render completes and auto-runs the publish gesture — see publishIntentStore.js
  // for why a store (not a plain ref) is the right shape for that cross-component
  // signal.
  //
  // T10660: the render now fires HEADLESSLY (App's onPublishWithoutSpotlight ->
  // startOverlayPublishRender), so this NO LONGER switches editorMode or closes
  // the preview. The user keeps watching their video in the open completion
  // preview while it publishes; the Publish card shows `publishLoading` (derived
  // from the stake). This supersedes T9740's whole reason for existing: that fix
  // fought a mechanism that fired OVERLAY's export button by mounting the Overlay
  // screen and polling for the button — a premise that was wrong, since
  // /api/export/render-overlay is backend-authoritative and needs no mounted
  // screen. (One-line pointer so nobody reinvents the poll: it existed only to
  // reach a mounted overlay export button; the headless render removes that need.)
  // Called UNGUARDED: a missing onPublishWithoutSpotlight prop must crash loudly
  // (no-silent-fallbacks), never no-op the one-tap promise away.
  const handlePublish = useCallback(() => {
    // Re-entrancy guard: two Publish taps in the same tick must not stake/fire
    // twice. The store is the mutex: if this project's intent is already staked,
    // a render is already in flight for it.
    if (usePublishIntentStore.getState().projectId === projectId) return;
    acknowledgeCompletionJob();
    // T10660: preview stays OPEN (no closePreview / no setEditorMode). The user
    // keeps watching while the reel publishes; the Publish card shows its loading
    // state, derived above from this staked intent.
    useQuestStore.getState().recordAchievement('overlay_declined');
    usePublishIntentStore.getState().set(projectId);
    // Safety-net backstop ONLY (T10660): the headless render now surfaces a
    // precise failure point (App's onError clears the stake + toasts), so this is
    // no longer the primary error path — it just bounds the staleness window if a
    // render somehow neither completes nor errors (see PUBLISH_INTENT_TIMEOUT_MS).
    setTimeout(() => {
      if (usePublishIntentStore.getState().projectId === projectId) usePublishIntentStore.getState().clear();
    }, PUBLISH_INTENT_TIMEOUT_MS);
    onPublishWithoutSpotlight(projectId);
  }, [onPublishWithoutSpotlight, projectId, acknowledgeCompletionJob]);

  // T8390: Refocus — go back and reframe. The preview is an overlay ON TOP of
  // the still-mounted Focus editor, so closing it IS "back to editing"; no new
  // navigation mechanism needed. Also the X-button/Escape handler (CollectionPlayer
  // requires `onClose`): an incidental dismiss should never fire Add Spotlight
  // Later's side effects (achievement + toast + navigation) — closing a preview
  // is "nevermind", not an explicit choice.
  const handleRefocus = useCallback(() => {
    // T9790: Refocus is still a deliberate decision on the completion (the user
    // saw the preview and chose to reframe), and it doubles as CollectionPlayer's
    // X/Escape close — acknowledging here matches the other three actions so the
    // completion does not re-prompt on reload after the user has acted on it.
    acknowledgeCompletionJob();
    closePreview();
    // T8390: defense-in-depth clear (see handleAddSpotlight comment above).
    if (usePublishIntentStore.getState().projectId === projectId) usePublishIntentStore.getState().clear();
  }, [projectId, closePreview, acknowledgeCompletionJob]);

  // T10650: the action-band CTA state. Derived at render time from the durable
  // render pointer (project.working_video_id), the latest clips' exported_at
  // stamps, and the in-session framingChangedSinceExport flag — persist NOTHING
  // (the whole feature is derived, no redundant state). See deriveFramingCtaState
  // for why exported_at is the durable staleness signal that survives a reload.
  const framingCtaState = useMemo(
    () => deriveFramingCtaState({
      workingVideoId: project?.working_video_id,
      clips,
      framingChangedSinceExport,
    }),
    [project?.working_video_id, clips, framingChangedSinceExport]
  );

  // T10650: reopen the already-rendered working video (the "Back to Preview" CTA
  // and its ghost twin). Resolve the URL in one HTTP call and reopen the SAME
  // completion preview + four-choice action bar; NEVER a silent re-render. A null
  // URL is loud (toast) and starts nothing. jobId is null so reopening an
  // already-acknowledged completion acknowledges nothing.
  const handleBackToPreview = useCallback(async () => {
    if (backToPreviewLoading) return;
    setBackToPreviewLoading(true);
    try {
      const url = await resolveWorkingVideoPreviewUrl(projectId);
      if (!url) {
        toast.error(FOCUS_PREVIEW.LOAD_FAILED);
        return;
      }
      openPreview({ projectId, previewUrl: url, openMode: EDITOR_MODES.FRAMING, jobId: null });
    } finally {
      setBackToPreviewLoading(false);
    }
  }, [backToPreviewLoading, projectId, openPreview]);

  // Derive game name for selected clip
  const selectedClipGameName = useMemo(() => {
    if (!selectedClipWithMeta?.game_id || !games?.length) return null;
    const game = games.find(g => g.id === selectedClipWithMeta.game_id);
    return game?.name || null;
  }, [selectedClipWithMeta?.game_id, games]);

  // Handle clip selection from sidebar
  // T9950 Slice 2: clear the framing Undo stack HERE, at the clip-selection
  // gesture itself (never a useEffect keyed on selectedClipId) — an inverse
  // thunk closes over a specific clip's keyframes and must not survive a switch.
  const handleSelectClip = useCallback((clipId) => {
    if (clipId !== selectedClipId) {
      clearFramingHistory();
      selectClip(clipId);
    }
  }, [selectedClipId, selectClip, clearFramingHistory]);

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
      console.error('[FocusScreen] Failed to upload clip with metadata:', err);
    }
  }, [projectId, uploadClipWithMetadataAction]);

  // Handle adding clip from library
  const handleAddFromLibrary = useCallback(async (rawClipId) => {
    try {
      if (projectId) {
        await addClipFromLibraryAction(projectId, rawClipId);
      }
    } catch (err) {
      console.error('[FocusScreen] Failed to add clip from library:', err);
    }
  }, [projectId, addClipFromLibraryAction]);

  const isLoadingProjectData = isProjectLoading;

  // T10190 §3.2 Shaper 3: game context for the completion-preview header, same
  // derivation pattern OverlayScreen already uses (projectListItem off
  // useProjectsStore). gameStartTime is fed RAW -- CollectionPlayer formats it
  // internally via formatGameClock. gameId is gated to exactly one source game
  // (the backlink's unambiguous target requirement); 0 or >1 games -> null, so
  // no gameName/onBackToGame is fed and the header falls back to `title`.
  // Declared before the FileUpload early return below (rules-of-hooks: every
  // hook must run on every render).
  const focusCompletionProjectListItem = useProjectsStore((state) => state.projects.find((p) => p.id === projectId));
  const focusCompletionGameName = focusCompletionProjectListItem?.game_names?.[0] || null;
  const focusCompletionGameStartTime = focusCompletionProjectListItem?.clip_game_start_time ?? null;
  const focusCompletionGameId = focusCompletionProjectListItem?.game_ids?.length === 1
    ? focusCompletionProjectListItem.game_ids[0]
    : null;
  // Gesture-driven backlink handler (design §2.4), mirroring App.jsx's
  // handleEditInAnnotate: setPendingGame + setEditorMode(ANNOTATE). Source clip
  // context comes from the currently selected clip, same field precedence
  // App.jsx uses (raw_clip_id, falling back to source_clip_id).
  const handleBackToGame = useCallback(() => {
    if (focusCompletionGameId == null) return;
    const sourceClipId = selectedClip?.raw_clip_id ?? selectedClip?.source_clip_id;
    setPendingGame(focusCompletionGameId, focusCompletionGameStartTime, sourceClipId);
    useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
  }, [focusCompletionGameId, focusCompletionGameStartTime, selectedClip]);

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
  };

  return (
    <div className="flex h-full">
      {/* Sidebar - hidden on mobile, visible on sm+. T10840 (D3): gated off in the
          landscape cockpit, where clips live in the Clips sheet instead — otherwise
          the 224px rail would eat the cockpit's width exactly as it does today. */}
      {!cockpit && ((hasClips && clips.length > 0) ? (
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
      ))}

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
        {/* Mobile clips toggle. T10840 (D3): gated off in the cockpit — the Clips
            rail button opens the Clips sheet instead. */}
        {!cockpit && hasClips && clips.length > 0 && (
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
        <FocusModeView
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
      isSourceExpired={!!sourceExpired}
      canExtendSource={!!sourceExpired?.canExtend}
      isUrlExpiredError={isUrlExpiredError}
      onRetryVideo={handleRetryVideo}
      clipRange={currentClipRange}
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
      rotation={rotation}
      onSetRotation={framingHandleSetRotation}
      keyframes={keyframes}
      framerate={framerate}
      selectedCropKeyframeIndex={selectedCropKeyframeIndex}
      copiedCrop={copiedCrop}
      onCropChange={framingHandleCropChange}
      onCropComplete={framingHandleCropComplete}
      onKeyframeClick={handleKeyframeClickWithIndex}
      onKeyframeDelete={framingHandleKeyframeDelete}
      onKeyframeTimeMove={framingHandleKeyframeTimeMove}
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
      timelineZoomControls={timelineZoomControls}
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
      selectedClipEffectiveDuration={selectedClipEffectiveDuration}
      projectEffectiveDuration={projectEffectiveDuration}
      canUndoFraming={canUndoFraming}
      onUndoFraming={framingHandleUndoFraming}
      globalAspectRatio={globalAspectRatio}
      onAspectRatioChange={handleAspectRatioChange}
      globalTransition={globalTransition}
      exportButtonRef={exportButtonRef}
      getFilteredKeyframesForExport={getFilteredKeyframesForExport}
      getSegmentExportData={getSegmentExportData}
      includeAudio={includeAudio}
      onIncludeAudioChange={setIncludeAudio}
      onProceedToOverlay={handleProceedToOverlayInternal}
      onExportComplete={onExportComplete}
      saveCurrentClipState={framingSaveCurrentClipState}
      framingCtaMode={framingCtaState.mode}
      showBackToPreview={framingCtaState.showBackToPreview}
      onBackToPreview={handleBackToPreview}
      renderedAt={framingCtaState.renderedAt}
      backToPreviewLoading={backToPreviewLoading}
      cropContextValue={cropContextValue}
      cockpit={cockpit}
      clipSidebarProps={sidebarProps}
      onExitToHome={onExitToHome}
    />
      </div>

      {/* T740: Outdated clips dialog removed — boundaries auto-refreshed silently */}

      {/* T8390: post-export preview + publish exit — overlay is an offer, not a
          stage. Preview mounts FIRST (replacing T8520's choose-then-preview
          card), decision comes after. Same CollectionPlayer DraftReelPreview
          uses, mounted directly (not via reelPreviewStore) since there is no
          final_videos row yet at this point — only the working video. */}
      {previewOpen && (
        <CollectionPlayer
          reels={[{
            id: projectId,
            name: project?.name,
            streamUrl: completionPreview.previewUrl,
            aspect_ratio: projectAspectRatio,
            duration: null,
            // T10190 §3.2 Shaper 3: game context, same derivation pattern
            // OverlayScreen already uses (projectListItem off useProjectsStore).
            // RAW gameStartTime -- CollectionPlayer formats internally via
            // formatGameClock. Absent (multi/no-game project) -> header falls
            // back to `title` below (unchanged existing rule).
            gameName: focusCompletionGameName,
            gameStartTime: focusCompletionGameStartTime,
          }]}
          title={project?.name}
          onClose={handleRefocus}
          onBackToGame={focusCompletionGameId != null ? handleBackToGame : undefined}
          actionBar={(
            <FocusPublishActionBar
              onPublish={handlePublish}
              publishLoading={publishLoading}
              onAddSpotlight={handleAddSpotlight}
              onRefocus={handleRefocus}
              onSaveDraft={handleAddSpotlightLater}
              retentionNote={resultRetentionNote(project)}
            />
          )}
        />
      )}
    </div>
  );
}

export default FocusScreen;
