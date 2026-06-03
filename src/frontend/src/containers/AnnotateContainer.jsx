import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAnnotateState, useAnnotate, useClipSelection } from '../modes/annotate';
import { toast } from '../components/shared';
import { extractVideoMetadata } from '../utils/videoMetadata';
import { useExportStore, useAuthStore } from '../stores';
import { useEditorStore } from '../stores/editorStore';
import { useUploadStore } from '../stores/uploadStore';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useRawClipSave } from '../hooks/useRawClipSave';
import { useFullscreenWorthwhile } from '../hooks/useFullscreenWorthwhile';
import { useWakeLock } from '../hooks/useWakeLock';
import { useAnnotationPlayback } from '../modes/annotate/hooks/useAnnotationPlayback';
import { useMultiVideoScrub } from '../modes/annotate/hooks/useMultiVideoScrub';
import { buildFullVideoTimeline } from '../modes/annotate/hooks/useVirtualTimeline';
import { VideoMode, GameType } from '../constants/gameConstants';
import { PROFILING_ENABLED } from '../utils/profiling';
import { setWarmupPriority, WARMUP_PRIORITY, getWarmedPresignedUrl } from '../utils/cacheWarming';
import { hasUncommittedTeammateText } from '../components/shared/TeammateTagInput';

/**
 * AnnotateContainer - Encapsulates all Annotate mode logic and UI
 *
 * This container manages:
 * - Game video loading (new upload or load from server)
 * - Clip region creation and management
 * - Fullscreen mode and overlay handling
 * - Auto-saving annotations to server
 * - Export operations (Create Video / Import to Projects)
 *
 * @see APP_REFACTOR_PLAN.md Task 3.1 for refactoring context
 */
export function AnnotateContainer({
  // Video element ref and controls
  videoRef,
  currentTime,
  duration: videoDuration,
  isPlaying,
  togglePlay,
  stepForward,
  stepBackward,
  seekBackward,
  restart,
  seek,

  // Game management
  uploadGameVideo, // T80: Unified upload with deduplication
  getGame,
  loadGame,
  getGameVideoUrl,

  // Project management
  fetchProjects,

  // Navigation
  onBackToProjects,
  setEditorMode,

  // Downloads
  downloadsCount,
  onOpenDownloads,
}) {
  // Annotate mode state (consolidated via useAnnotateState hook)
  const {
    annotateVideoFile,
    annotateVideoUrl,
    annotateVideoMetadata,
    annotateGameId,
    setAnnotateVideoFile,
    setAnnotateVideoUrl,
    setAnnotateVideoMetadata,
    setAnnotateGameId,
    annotateGameName,
    setAnnotateGameName,
    isImportingToProjects,
    setIsImportingToProjects,
    // Note: isUploadingGameVideo and uploadProgress from local state are NOT used
    // We use uploadStore instead for persistence across page navigation
    annotatePlaybackSpeed,
    setAnnotatePlaybackSpeed,
    annotateFullscreen,
    setAnnotateFullscreen,
    annotateSelectedLayer,
    setAnnotateSelectedLayer,
    annotateContainerRef,
    annotateFileInputRef,
  } = useAnnotateState();

  useWakeLock();

  // T82: Multi-video state (null = single video, array = multi-video)
  const [gameVideos, setGameVideos] = useState(null);
  // [{ sequence, url, duration, width, height, serverUrl? }]
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);

  // T3050: Refresh multi-video presigned URLs when they expire.
  // Concurrent calls are safe — getGame() deduplicates in-flight requests.
  const refreshMultiVideoUrls = useCallback(async () => {
    const gameId = annotateGameIdRef.current;
    if (!gameId) return;
    try {
      const gameData = await getGame(gameId);
      if (gameData.videos && gameData.videos.length > 1) {
        setGameVideos(gameData.videos.map(v => ({
          sequence: v.sequence,
          url: v.video_url,
          serverUrl: v.video_url,
          duration: v.duration,
          width: v.video_width,
          height: v.video_height,
        })));
      }
    } catch (err) {
      console.warn('[AnnotateContainer] Failed to refresh multi-video URLs:', err.message);
    }
  }, [getGame]);

  const playbackUrlRefreshTimerRef = useRef(null);

  const schedulePlaybackUrlRefresh = useCallback((gameId, ttlSeconds) => {
    if (playbackUrlRefreshTimerRef.current) {
      clearTimeout(playbackUrlRefreshTimerRef.current);
    }
    const refreshMs = ttlSeconds * 0.75 * 1000;
    playbackUrlRefreshTimerRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/games/${gameId}/playback-url`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        setAnnotateVideoUrl(data.url);
        schedulePlaybackUrlRefresh(gameId, data.expires_in);
      } catch (err) {
        console.warn('[Annotate] Presigned URL refresh failed:', err.message);
      }
    }, refreshMs);
  }, [setAnnotateVideoUrl]);

  useEffect(() => {
    return () => {
      if (playbackUrlRefreshTimerRef.current) {
        clearTimeout(playbackUrlRefreshTimerRef.current);
      }
    };
  }, []);

  // T2750: Dual-video scrub for unified multi-video experience
  const multiVideo = useMultiVideoScrub({ gameVideos, playbackRate: annotatePlaybackSpeed, onRefreshUrls: refreshMultiVideoUrls });
  const fullTimeline = useMemo(
    () => gameVideos && gameVideos.length > 1 ? buildFullVideoTimeline(gameVideos) : null,
    [gameVideos],
  );

  // Unified videoController — multi-video uses proxy's controller, single-video wraps the raw ref
  const singleVideoController = useMemo(() => ({
    play: () => videoRef.current?.play().catch(() => {}),
    pause: () => { if (videoRef.current) videoRef.current.pause(); },
    seek: (t) => { if (videoRef.current) videoRef.current.currentTime = t; },
    setVolume: (v) => { if (videoRef.current) videoRef.current.volume = v; },
    setMuted: (m) => { if (videoRef.current) videoRef.current.muted = m; },
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    isPaused: () => videoRef.current?.paused ?? true,
    getActiveElement: () => videoRef.current,
    _renderRefs: { videoARef: videoRef },
  }), []);
  const videoController = multiVideo?.videoController ?? singleVideoController;

  // T2750: Effective values — virtual in multi-video, actual in single
  const effectiveCurrentTime = multiVideo?.virtualTime ?? currentTime;
  const effectiveSeek = multiVideo?.seek ?? seek;
  const effectiveTogglePlay = multiVideo?.togglePlay ?? togglePlay;
  const effectiveIsPlaying = multiVideo?.isPlaying ?? isPlaying;
  const effectiveStepForward = multiVideo?.stepForward ?? stepForward;
  const effectiveStepBackward = multiVideo?.stepBackward ?? stepBackward;
  const effectiveSeekBackward = multiVideo?.seekBackward ?? seekBackward;
  const effectiveRestart = multiVideo?.restart ?? restart;

  // Current video's sequence number (1-based, for clip tagging)
  const currentVideoSequence = multiVideo?.currentVideoSequence
    ?? (gameVideos ? gameVideos[activeVideoIndex]?.sequence : null);

  // Clip selection state machine — single source of truth for selection + overlay
  const {
    selectionState,
    selectClip,
    editClip,
    startCreating,
    closeOverlay,
    deselectClip,
    selectedRegionId: annotateSelectedRegionId,
    isOverlayOpen: showAnnotateOverlay,
    isEditMode,
    scrubLockedRef,
    lockScrub,
    unlockScrub,
  } = useClipSelection();

  // Annotate clip management hook — selection delegated to state machine
  const {
    clipRegions,
    regionsWithLayout: annotateRegionsWithLayout,
    hasClips: hasAnnotateClips,
    clipCount: annotateClipCount,
    isLoadingAnnotations,
    reset: resetAnnotate,
    addClipRegion,
    updateClipRegion,
    deleteClipRegion: deleteClipRegionLocal,
    selectRegion: selectAnnotateRegion,
    getRegionAtTime: getAnnotateRegionAtTime,
    getExportData: getAnnotateExportData,
    importAnnotations,
    setRawClipId,
    setAutoProjectId,
    MAX_NOTES_LENGTH: ANNOTATE_MAX_NOTES_LENGTH,
  } = useAnnotate(annotateVideoMetadata, {
    selectedRegionId: annotateSelectedRegionId,
    onSelect: useCallback((id) => id ? selectClip(id) : deselectClip(), [selectClip, deselectClip]),
  });

  // Real-time clip saving hook
  const {
    saveClip,
    updateClip: updateClipRemote,
    deleteClip: deleteClipRemote,
    isSaving: isClipSaving,
  } = useRawClipSave();

  // Export state from Zustand store (used for dismiss-on-change only)
  const { dismissExportCompleteToast } = useExportStore();

  const requireAuth = useAuthStore((s) => s.requireAuth);
  const setAnnotateHasSelectedClip = useEditorStore((s) => s.setAnnotateHasSelectedClip);

  // Sync clip selection state to editorStore for quest panel auto-collapse
  useEffect(() => {
    setAnnotateHasSelectedClip(!!annotateSelectedRegionId);
  }, [annotateSelectedRegionId, setAnnotateHasSelectedClip]);


  // T2810: Teammate tag suggestions (server baseline + locally-used tags).
  // Populated by handleLoadGame from the /load endpoint response.
  const [serverTeammateTags, setServerTeammateTags] = useState([]);
  const teammateSuggestions = useMemo(() => {
    const localTags = clipRegions.flatMap(r => r.tagged_teammates || []);
    const seen = new Set();
    const merged = [];
    for (const tag of [...serverTeammateTags, ...localTags]) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(tag);
      }
    }
    return merged;
  }, [serverTeammateTags, clipRegions]);

  // T2820: Shared tag data — map of tag_name → Set of shared clip IDs
  const [sharedTagData, setSharedTagData] = useState({});
  const [showTagWarning, setShowTagWarning] = useState(false);

  // Upload state from Zustand store (persists across page navigation)
  const uploadStore = useUploadStore();
  const activeUpload = uploadStore.activeUpload;

  // Derive isUploading from store
  const isUploadingFromStore = uploadStore.isUploading();

  // Track whether we initiated the upload from this component (vs navigating back)
  const uploadInitiatedHereRef = useRef(false);

  // T1540: Restore annotateGameId from upload store on remount during active upload.
  // When user navigates away and back, React state resets but the upload store persists.
  // Also fetch and import any clips saved in a previous session.
  useEffect(() => {
    if (!annotateGameId && uploadStore.uploadGameId && isUploadingFromStore) {
      const gameId = uploadStore.uploadGameId;
      console.log('[AnnotateContainer] Restoring game ID from upload store:', gameId);
      setAnnotateGameId(gameId);
      if (uploadStore.uploadGameName) {
        setAnnotateGameName(uploadStore.uploadGameName);
      }
      // Fetch existing clips for this game (may have been added before navigation)
      getGame(gameId).then(gameData => {
        if (gameData.annotations?.length > 0) {
          const duration = annotateVideoMetadata?.duration || gameData.video_duration;
          importAnnotations(gameData.annotations, duration);
        }
      }).catch(err => {
        console.warn('[AnnotateContainer] Could not load existing clips on restore:', err.message);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one-time restore on mount

  // Keep a ref to annotateGameId so async callbacks always read the latest value.
  // useCallback closures capture state at creation time, but the ref is always current.
  const annotateGameIdRef = useRef(annotateGameId);
  annotateGameIdRef.current = annotateGameId;

  // T251: High-water mark tracking — track max video position reached per video sequence
  // Map<sequenceKey, maxTime> where sequenceKey is 'single' for single-video or sequence number
  const viewedHighWaterRef = useRef(new Map());
  // Previously persisted viewed_duration from the backend (loaded on game open)
  const persistedViewedDurationRef = useRef(0);

  // T740: Pending clip selection from Framing → Annotate navigation
  const pendingSelectSeekTimeRef = useRef(null);

  // Restore video state from active upload if navigating back from Games screen
  // This allows users to click on the uploading game card and return to annotation
  // Skip if we just started the upload from this same mount (not a navigation back)
  useEffect(() => {
    if (activeUpload?.blobUrl && !annotateVideoUrl && !uploadInitiatedHereRef.current) {
      setAnnotateVideoUrl(activeUpload.blobUrl);
      // For multi-video, videoMetadata is an array - don't override with it
      if (activeUpload.videoMetadata && !Array.isArray(activeUpload.videoMetadata)) {
        setAnnotateVideoMetadata(activeUpload.videoMetadata);
      }
      setAnnotateGameName(activeUpload.gameName);
      setAnnotateGameId(null); // Will be set when upload completes
    }
  }, [activeUpload, annotateVideoUrl, setAnnotateVideoUrl, setAnnotateVideoMetadata, setAnnotateGameName, setAnnotateGameId]);

  // Ref to track previous isPlaying state for detecting pause transitions
  const wasPlayingRef = useRef(false);

  /**
   * Handle game video selection for Annotate mode
   * Supports both single-video and multi-video (per-half) games.
   *
   * @param {File} file - Video file (single-video mode) or first file of multi-video
   * @param {Object} gameDetails - Game details including videoMode and optional files array
   */
  const handleGameVideoSelect = async (file, gameDetails = null) => {
    const isMultiVideo = gameDetails?.videoMode === VideoMode.PER_HALF && gameDetails?.files;
    const files = isMultiVideo ? gameDetails.files : [file];

    if (!files[0]) return;

    try {
      // Extract metadata for all files
      const metadataList = [];
      for (const f of files) {
        const meta = await extractVideoMetadata(f);
        metadataList.push(meta);
      }

      // Create blob URLs for immediate playback
      const blobUrls = files.map(f => URL.createObjectURL(f));

      // Clean up existing blob URL
      if (annotateVideoUrl && annotateVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(annotateVideoUrl);
      }

      // Generate display name
      const rawGameName = files[0].name.replace(/\.[^/.]+$/, '');
      let displayName = rawGameName;
      if (gameDetails?.opponentName) {
        const prefix = gameDetails.gameType === GameType.AWAY ? 'at' : 'Vs';
        displayName = `${prefix} ${gameDetails.opponentName}`;
      }

      // Build metadata - use first video's dimensions and duration
      // For multi-video, each video has its own timeline (no combined duration)
      const combinedMetadata = {
        ...metadataList[0],
      };

      // Set annotate state - start with first video
      setAnnotateVideoFile(files[0]);
      setAnnotateVideoUrl(blobUrls[0]);
      setAnnotateVideoMetadata(combinedMetadata);
      setAnnotateGameId(null);
      setAnnotateGameName(displayName);

      // Store multi-video info for video switching (T82)
      if (isMultiVideo) {
        setGameVideos(metadataList.map((meta, i) => ({
          sequence: i + 1,
          url: blobUrls[i],
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
        })));
        setActiveVideoIndex(0);
      } else {
        setGameVideos(null);
        setActiveVideoIndex(0);
      }

      setEditorMode('annotate');

      // Mark that we initiated the upload here (prevents restore effect from firing)
      uploadInitiatedHereRef.current = true;

      // Early callback: set game ID as soon as the game record is created (before upload finishes).
      // This enables clip saves during the upload window — the game exists in the DB from step 1.
      const onGameCreated = async ({ game_id, name }) => {
        annotateGameIdRef.current = game_id;
        setAnnotateGameId(game_id);
        setAnnotateGameName(name);

        // T1540: If resuming a pending game that already has clips (e.g., page refresh
        // during upload), fetch and import them so they appear in the UI.
        try {
          const gameData = await getGame(game_id);
          if (gameData.annotations?.length > 0) {
            const duration = combinedMetadata?.duration || gameData.video_duration;
            importAnnotations(gameData.annotations, duration);
          }
        } catch (err) {
          console.warn('[AnnotateContainer] Could not load existing clips for game:', err.message);
        }
      };

      // Start upload
      if (isMultiVideo) {
        uploadStore.startUpload(
          files,
          gameDetails,
          metadataList,
          (result) => {
            // Update game_videos with presigned URLs from server
            if (result.videos) {
              setGameVideos(prev => prev?.map((v, i) => ({
                ...v,
                serverUrl: result.videos[i]?.video_url,
              })));
            }
          },
          { blobUrl: blobUrls[0], gameName: displayName },
          onGameCreated
        );
      } else {
        uploadStore.startUpload(
          files[0],
          gameDetails,
          metadataList[0],
          null,
          { blobUrl: blobUrls[0], gameName: displayName },
          onGameCreated
        );
      }

    } catch (err) {
      console.error('[AnnotateContainer] Failed to process game video:', err);
      throw err;
    }
  };

  /**
   * Apply game data to annotate state. Shared by both the single-request
   * load path and the legacy fallback.
   */
  const applyGameData = useCallback((gameData, playbackUrlData, teammateSharesData, pendingClipSeekTime) => {
    const isMultiVideo = gameData.videos && gameData.videos.length > 1;

    let videoMetadata = null;

    if (isMultiVideo) {
      videoMetadata = {
        duration: gameData.videos[0].duration,
        width: gameData.videos[0].video_width || gameData.video_width,
        height: gameData.videos[0].video_height || gameData.video_height,
        size: gameData.video_size,
        aspectRatio: (gameData.videos[0].video_width || gameData.video_width) /
                     (gameData.videos[0].video_height || gameData.video_height),
        fileName: gameData.name,
        format: 'mp4',
      };
    } else {
      if (gameData.video_duration && gameData.video_width && gameData.video_height) {
        videoMetadata = {
          duration: gameData.video_duration,
          width: gameData.video_width,
          height: gameData.video_height,
          size: gameData.video_size,
          aspectRatio: gameData.video_width / gameData.video_height,
          fileName: gameData.name,
          format: 'mp4',
        };
      }
    }

    if (annotateVideoUrl && annotateVideoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(annotateVideoUrl);
    }

    viewedHighWaterRef.current = new Map();
    persistedViewedDurationRef.current = gameData.viewed_duration || 0;

    resetAnnotate();
    setAnnotateVideoFile(null);

    let playbackUrl;
    if (playbackUrlData?.url) {
      playbackUrl = playbackUrlData.url;
      schedulePlaybackUrlRefresh(gameData.id, playbackUrlData.expires_in);
    } else {
      playbackUrl = `${API_BASE}/api/games/${gameData.id}/stream`;
    }
    if (pendingClipSeekTime != null) {
      playbackUrl = `${playbackUrl}#t=${pendingClipSeekTime}`;
    }
    setAnnotateVideoUrl(playbackUrl);
    setAnnotateVideoMetadata(videoMetadata);
    annotateGameIdRef.current = gameData.id;
    setAnnotateGameId(gameData.id);
    setAnnotateGameName(gameData.name);

    if (isMultiVideo) {
      setGameVideos(gameData.videos.map(v => {
        const url = getWarmedPresignedUrl(v.video_url) || v.video_url;
        return {
          sequence: v.sequence,
          url,
          serverUrl: v.video_url,
          duration: v.duration,
          width: v.video_width,
          height: v.video_height,
        };
      }));
      setActiveVideoIndex(0);
    } else {
      setGameVideos(null);
      setActiveVideoIndex(0);
    }

    if (teammateSharesData && teammateSharesData.length > 0) {
      const tagData = {};
      for (const s of teammateSharesData) {
        tagData[s.tag_name] = new Set(s.shared_clip_ids || []);
      }
      setSharedTagData(tagData);
    }

    return { isMultiVideo, videoMetadata };
  }, [annotateVideoUrl, resetAnnotate]);

  /**
   * Handle loading a saved game into annotate mode.
   * T3430: Uses single /load endpoint, falls back to individual fetches.
   */
  const handleLoadGame = useCallback(async (gameId, pendingClipSeekTime = null) => {
    if (PROFILING_ENABLED) performance.mark('gesture:load-game:start');
    setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_DIRECT);
    try {
      let gameData, playbackUrlData, teammateSharesData, teammateTagsData;

      try {
        const loadResult = await loadGame(gameId);
        gameData = loadResult.game;
        playbackUrlData = loadResult.playback_url;
        teammateSharesData = loadResult.teammate_shares;
        teammateTagsData = loadResult.teammate_tags;
      } catch (loadErr) {
        if (loadErr.message?.includes('not found')) throw loadErr;
        console.warn('[AnnotateContainer] /load failed, falling back to individual fetches:', loadErr.message);
        gameData = await getGame(gameId);
        try {
          const res = await apiFetch(`${API_BASE}/api/games/${gameId}/playback-url`);
          if (res.ok) playbackUrlData = await res.json();
        } catch { /* proxy fallback handled below */ }
        apiFetch(`${API_BASE}/api/clips/teammate-shares/${gameId}`)
          .then(res => res.ok ? res.json() : [])
          .then(data => {
            const tagData = {};
            for (const s of data) {
              tagData[s.tag_name] = new Set(s.shared_clip_ids || []);
            }
            setSharedTagData(tagData);
          })
          .catch(() => {});
        apiFetch(`${API_BASE}/api/clips/teammate-tags`)
          .then(res => res.ok ? res.json() : [])
          .then(data => setServerTeammateTags(data))
          .catch(() => {});
      }

      const { isMultiVideo, videoMetadata } = applyGameData(gameData, playbackUrlData, teammateSharesData, pendingClipSeekTime);

      if (teammateTagsData) {
        setServerTeammateTags(teammateTagsData);
      }

      // Import saved annotations if they exist
      if (gameData.annotations && gameData.annotations.length > 0) {
        const gameDuration = isMultiVideo
          ? Math.max(...gameData.videos.map(v => v.duration || 0))
          : (videoMetadata?.duration || gameData.video_duration);

        const annotationsWithoutRawClips = gameData.annotations.filter(a => !a.id);

        if (annotationsWithoutRawClips.length > 0) {
          for (const annotation of annotationsWithoutRawClips) {
            try {
              const result = await saveClip(gameId, {
                start_time: annotation.start_time,
                end_time: annotation.end_time,
                name: annotation.name || '',
                rating: annotation.rating || 3,
                tags: annotation.tags || [],
                notes: annotation.notes || '',
                video_sequence: annotation.video_sequence || null,
              });

              if (result) {
                annotation.id = result.raw_clip_id;
              }
            } catch (err) {
              console.error('[AnnotateContainer] Failed to create raw_clip for annotation:', err);
            }
          }
        }

        importAnnotations(gameData.annotations, gameDuration);

        if (pendingClipSeekTime != null) {
          pendingSelectSeekTimeRef.current = pendingClipSeekTime;
        }
      }

      setEditorMode('annotate');
    } catch (err) {
      console.warn('[AnnotateContainer] Failed to load game:', err.message);
      if (err.message?.includes('not found')) {
        toast.error('Game not found');
        setEditorMode('projects');
      }
    } finally {
      if (PROFILING_ENABLED) {
        performance.mark('gesture:load-game:end');
        try {
          const m = performance.measure('gesture:load-game', 'gesture:load-game:start', 'gesture:load-game:end');
          // eslint-disable-next-line no-console
          console.info(`[GESTURE] load-game duration=${Math.round(m.duration)}ms`);
        } catch { /* marks cleared */ }
        performance.clearMarks('gesture:load-game:start');
        performance.clearMarks('gesture:load-game:end');
      }
    }
  }, [loadGame, getGame, applyGameData, annotateVideoUrl, resetAnnotate, importAnnotations, setEditorMode, saveClip]);

  // T710: Annotation playback hook (dual-video ping-pong)
  const playback = useAnnotationPlayback({
    clips: clipRegions,
    gameVideos,
    videoUrl: annotateVideoUrl,
  });

  /**
   * Handle fullscreen toggle - uses CSS fixed positioning instead of browser API
   */
  const handleToggleFullscreen = useCallback(() => {
    const newFS = !annotateFullscreen;
    setAnnotateFullscreen(newFS);
    if (newFS && selectionState.type === 'SELECTED') {
      editClip(selectionState.clipId);
    } else if (!newFS && (selectionState.type === 'EDITING' || selectionState.type === 'CREATING')) {
      closeOverlay();
    }
  }, [annotateFullscreen, setAnnotateFullscreen, selectionState, editClip, closeOverlay]);

  // T740: After clipRegions update from importAnnotations, select the clip matching pendingSelectSeekTime
  // Used by both Framing→Annotate navigation and share link navigation.
  useEffect(() => {
    if (pendingSelectSeekTimeRef.current == null || clipRegions.length === 0) return;
    const seekTime = pendingSelectSeekTimeRef.current;
    const match = clipRegions.find(r => Math.abs(r.startTime - seekTime) < 0.5);
    if (match) {
      selectClip(match.id);
      let seekTarget = match.startTime;
      if (fullTimeline && match.videoSequence) {
        seekTarget += fullTimeline.getVideoOffset(match.videoSequence);
      }
      effectiveSeek(seekTarget);
      setAnnotateSelectedLayer('clips');
    }
    pendingSelectSeekTimeRef.current = null;
  }, [clipRegions, selectClip, effectiveSeek, fullTimeline]);

  // Hide fullscreen button when it wouldn't meaningfully increase video size
  const fullscreenWorthwhile = useFullscreenWorthwhile(videoRef, annotateFullscreen);

  /**
   * Handle Add Clip button click (non-fullscreen mode).
   * Creating a new clip requires auth (shows login modal if guest).
   * Editing an existing clip does not require auth.
   * Context (paused video, timestamp) is preserved through the auth modal.
   */
  const handleAddClipFromButton = useCallback(() => {
    if (multiVideo) {
      multiVideo.pause();
    } else if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    if (selectionState.type === 'SELECTED') {
      editClip(selectionState.clipId);
    } else {
      requireAuth(() => startCreating());
    }
  }, [videoRef, multiVideo, selectionState, editClip, startCreating, requireAuth]);

  /**
   * Handle creating a clip from fullscreen overlay
   * Now saves to backend in real-time (if video is uploaded and we have a gameId)
   */
  const handleFullscreenCreateClip = useCallback(async (clipData) => {
    // T2750: In multi-video mode, clipData.startTime is virtual — convert to actual for storage
    let startTime = clipData.startTime;
    let clipDuration = clipData.duration;
    let videoSeq = currentVideoSequence;
    let segmentDuration = null;

    if (fullTimeline) {
      const result = fullTimeline.virtualToActual(clipData.startTime);
      startTime = result.actualTime;
      videoSeq = fullTimeline.segments[result.videoIndex].videoSequence;
      segmentDuration = fullTimeline.segments[result.videoIndex].duration;
      const maxDur = segmentDuration - result.actualTime;
      clipDuration = Math.min(clipDuration, maxDur);
      console.log('[CreateClip] virtual:', clipData.startTime, '→ actual:', startTime, 'seq:', videoSeq, 'segDur:', segmentDuration, 'clipDur:', clipDuration);
    }

    const newRegion = addClipRegion(
      startTime,
      clipDuration,
      clipData.notes,
      clipData.rating,
      '',
      clipData.tags,
      clipData.name,
      videoSeq,
      { tagged_teammates: clipData.tagged_teammates, my_athlete: clipData.my_athlete, videoDuration: segmentDuration },
    );
    if (newRegion) {
      console.log('[CreateClip] Stored region:', newRegion.id, 'actual:', newRegion.startTime, '-', newRegion.endTime, 'seq:', newRegion.videoSequence);
      // clipData.startTime is virtual in multi-video, actual in single — matches effectiveSeek
      effectiveSeek(clipData.startTime);

      // Save to backend if we have a game ID (game record exists in DB even during upload)
      if (annotateGameId) {
        const result = await saveClip(annotateGameId, {
          start_time: newRegion.startTime,
          end_time: newRegion.endTime,
          name: newRegion.name,
          rating: newRegion.rating,
          tags: newRegion.tags,
          notes: newRegion.notes,
          video_sequence: videoSeq,
          tagged_teammates: newRegion.tagged_teammates,
          my_athlete: newRegion.my_athlete,
          ...(clipData.createProject != null && { create_project: clipData.createProject }),
        });

        if (result?.raw_clip_id) {
          setRawClipId(newRegion.id, result.raw_clip_id);

          if (result.project_created) {
            setAutoProjectId(newRegion.id, result.project_id);
            toast.success('Reel created!', { duration: 5000 });
          }
        }
      }
    }
    // Overlay closes automatically: addClipRegion calls onSelect → selectClip → CREATING→SELECTED
  }, [addClipRegion, effectiveSeek, annotateGameId, saveClip, setRawClipId, setAutoProjectId, currentVideoSequence, fullTimeline]);

  /**
   * Update a clip region - syncs to backend
   * This wraps the local updateClipRegion to also sync with the backend
   */
  const updateClipRegionWithSync = useCallback(async (regionId, updates) => {
    // Find the region BEFORE updating to get current values
    const region = clipRegions.find(r => r.id === regionId);
    if (!region) {
      console.warn('[AnnotateContainer] Region not found for update:', regionId);
      return;
    }

    // In multi-video mode, startTime/endTime from the sidebar are virtual — convert to actual
    let actualUpdates = updates;
    if (fullTimeline && (updates.startTime !== undefined || updates.endTime !== undefined)) {
      actualUpdates = { ...updates };
      if (updates.startTime !== undefined) {
        actualUpdates.startTime = fullTimeline.virtualToActual(updates.startTime).actualTime;
      }
      if (updates.endTime !== undefined) {
        actualUpdates.endTime = fullTimeline.virtualToActual(updates.endTime).actualTime;
      }
    }

    // Update locally first
    updateClipRegion(regionId, actualUpdates);

    // Skip backend sync if no game ID
    if (!annotateGameId) {
      return;
    }

    // If clip doesn't have rawClipId, save it to backend first
    if (!region.rawClipId) {

      // Merge current values with updates for the save
      const clipData = {
        start_time: actualUpdates.startTime ?? region.startTime,
        end_time: actualUpdates.endTime ?? region.endTime,
        name: actualUpdates.name ?? region.name,
        rating: actualUpdates.rating ?? region.rating,
        tags: actualUpdates.tags ?? region.tags,
        notes: actualUpdates.notes ?? region.notes,
        video_sequence: region.videoSequence ?? currentVideoSequence,
        tagged_teammates: actualUpdates.tagged_teammates ?? region.tagged_teammates ?? null,
        my_athlete: actualUpdates.my_athlete ?? region.my_athlete,
      };

      if (actualUpdates.createProject != null) {
        clipData.create_project = actualUpdates.createProject;
      }

      const result = await saveClip(annotateGameId, clipData);
      if (result?.raw_clip_id) {
        setRawClipId(region.id, result.raw_clip_id);

        if (result.project_created) {
          setAutoProjectId(region.id, result.project_id);
          const clipName = actualUpdates.name || region.name || 'Untitled';
          toast.success(`Reel created: ${clipName}`, { duration: 5000 });
        }
      }
    } else {
      // Clip already has rawClipId, just update
      const backendUpdates = {};
      if (actualUpdates.name !== undefined) backendUpdates.name = actualUpdates.name;
      if (actualUpdates.rating !== undefined) backendUpdates.rating = actualUpdates.rating;
      if (actualUpdates.tags !== undefined) backendUpdates.tags = actualUpdates.tags;
      if (actualUpdates.notes !== undefined) backendUpdates.notes = actualUpdates.notes;
      if (actualUpdates.startTime !== undefined) backendUpdates.start_time = actualUpdates.startTime;
      if (actualUpdates.endTime !== undefined) backendUpdates.end_time = actualUpdates.endTime;
      if (actualUpdates.createProject != null) backendUpdates.create_project = actualUpdates.createProject;
      if (actualUpdates.tagged_teammates !== undefined) backendUpdates.tagged_teammates = actualUpdates.tagged_teammates;
      if (actualUpdates.my_athlete !== undefined) backendUpdates.my_athlete = actualUpdates.my_athlete;

      // Handle duration changes - need to send computed start_time
      // Since duration changes keep endTime fixed and adjust startTime
      if (actualUpdates.duration !== undefined && actualUpdates.startTime === undefined) {
        const newStartTime = Math.max(0, region.endTime - actualUpdates.duration);
        backendUpdates.start_time = newStartTime;
      }

      if (Object.keys(backendUpdates).length > 0) {
        const result = await updateClipRemote(region.rawClipId, backendUpdates);
        if (result?.project_created) {
          setAutoProjectId(region.id, result.project_id);
          const clipName = region.name || 'Untitled';
          toast.success(`Reel created: ${clipName}`, { duration: 5000 });
        }
      }
    }
  }, [clipRegions, updateClipRegion, annotateGameId, saveClip, updateClipRemote, setRawClipId, setAutoProjectId, currentVideoSequence, fullTimeline]);

  /**
   * Handle updating an existing clip from fullscreen overlay
   * Uses updateClipRegionWithSync for backend sync
   */
  const handleFullscreenUpdateClip = useCallback(async (regionId, updates) => {
    await updateClipRegionWithSync(regionId, updates);
    closeOverlay();
  }, [updateClipRegionWithSync, closeOverlay]);

  /**
   * Delete a clip region - syncs to backend if the clip has been saved
   */
  const deleteClipRegion = useCallback(async (regionId) => {
    // Find the region to get its rawClipId before deleting locally
    const region = clipRegions.find(r => r.id === regionId);
    const rawClipId = region?.rawClipId;

    // Delete locally first
    deleteClipRegionLocal(regionId);

    // Sync to backend if the clip was saved
    if (rawClipId) {
      await deleteClipRemote(rawClipId);
    }
  }, [clipRegions, deleteClipRegionLocal, deleteClipRemote]);

  /**
   * Handle closing the fullscreen overlay without creating a clip
   */
  const handleOverlayClose = useCallback(() => {
    closeOverlay();
  }, [closeOverlay]);

  /**
   * Handle resuming playback from fullscreen overlay
   */
  const handleOverlayResume = useCallback(() => {
    closeOverlay();
    effectiveTogglePlay();
  }, [closeOverlay, effectiveTogglePlay]);

  // T2750: In unified multi-video mode, convert virtual time to actual and match
  // against the correct video's clips. Clips store actual per-video times.
  const getRegionAtTimeUnified = useCallback((time) => {
    if (!fullTimeline) return getAnnotateRegionAtTime(time);
    const { actualTime, videoIndex } = fullTimeline.virtualToActual(time);
    const videoSeq = fullTimeline.segments[videoIndex].videoSequence;
    const match = clipRegions.find(r =>
      (r.videoSequence ?? 1) === videoSeq &&
      actualTime >= r.startTime &&
      actualTime <= r.endTime
    ) ?? null;
    return match;
  }, [fullTimeline, getAnnotateRegionAtTime, clipRegions]);

  /**
   * Timeline seek — wraps seek() with overlay management.
   * When the user clicks the timeline (a gesture) while the overlay is open,
   * and the target time has no clip, close the overlay. This is distinct from
   * scrub handle drags (which use seek() directly and should NOT close the overlay).
   */
  const handleTimelineSeek = useCallback((time) => {
    if (hasUncommittedTeammateText()) {
      setShowTagWarning(true);
      return;
    }
    effectiveSeek(time);
    if (selectionState.type === 'EDITING' || selectionState.type === 'CREATING') {
      if (!getRegionAtTimeUnified(time)) {
        closeOverlay();
      }
    }
  }, [effectiveSeek, selectionState, getRegionAtTimeUnified, closeOverlay]);

  const handleSelectRegion = useCallback((regionId) => {
    if (hasUncommittedTeammateText()) {
      setShowTagWarning(true);
      return;
    }
    const region = clipRegions.find(r => r.id === regionId);
    if (region) {
      console.log('[SelectClip] Found region:', regionId, 'actual:', region.startTime, '-', region.endTime, 'seq:', region.videoSequence, 'state:', selectionState.type);
      // If overlay is open (EDITING), stay in EDITING with new clip; otherwise SELECTED
      if (selectionState.type === 'EDITING') {
        editClip(regionId);
      } else {
        selectClip(regionId);
      }
      // T2750: Convert actual startTime to virtual for seek in multi-video mode
      let seekTarget = region.startTime;
      if (fullTimeline && region.videoSequence) {
        seekTarget += fullTimeline.getVideoOffset(region.videoSequence);
      }
      console.log('[SelectClip] Seeking to virtual:', seekTarget, 'currentTime:', effectiveCurrentTime);
      effectiveSeek(seekTarget);
      setAnnotateSelectedLayer('clips');
    } else {
      console.warn('[AnnotateContainer] Region not found! Available IDs:', clipRegions.map(r => r.id));
    }
  }, [clipRegions, selectionState, selectClip, editClip, effectiveSeek, effectiveCurrentTime, fullTimeline]);

  // Effect: Auto-select/deselect based on playhead position
  // EDITING and CREATING are immune — scrub handles move playhead without deselecting
  // FRAME_TOLERANCE: the browser's seeked event snaps to frame boundaries, which can be
  // slightly before startTime (e.g., seek(30) → seeked fires with 29.967). Without
  // tolerance, this would immediately deselect the clip the user just clicked.
  useEffect(() => {
    if (!annotateVideoUrl) return;
    const { type, clipId } = selectionState;

    if (type === 'EDITING' || type === 'CREATING') return;
    if (scrubLockedRef.current) return; // Sidebar scrub in progress — don't deselect
    if (hasUncommittedTeammateText()) return;

    const FRAME_TOLERANCE = 0.15; // ~4 frames at 30fps — handles seek snapping
    const regionAtPlayhead = getRegionAtTimeUnified(effectiveCurrentTime);

    if (type === 'SELECTED') {
      const selectedClip = clipRegions.find(r => r.id === clipId);
      if (selectedClip) {
        // T2750: Convert actual clip times to virtual for comparison
        let clipStart = selectedClip.startTime;
        let clipEnd = selectedClip.endTime;
        if (fullTimeline && selectedClip.videoSequence) {
          const offset = fullTimeline.getVideoOffset(selectedClip.videoSequence);
          clipStart += offset;
          clipEnd += offset;
        }
        if (effectiveCurrentTime < clipStart - FRAME_TOLERANCE || effectiveCurrentTime > clipEnd + FRAME_TOLERANCE) {
          console.log('[AutoDeselect] Deselecting', clipId, 'playhead:', effectiveCurrentTime.toFixed(2), 'clipVirtual:', clipStart.toFixed(2), '-', clipEnd.toFixed(2), 'seq:', selectedClip.videoSequence, 'offset:', fullTimeline?.getVideoOffset(selectedClip.videoSequence) ?? 0, 'regionAtPlayhead:', regionAtPlayhead?.id ?? 'none');
          regionAtPlayhead ? selectClip(regionAtPlayhead.id) : deselectClip();
        }
      } else {
        console.warn('[AutoDeselect] Selected clip not found in clipRegions:', clipId);
      }
    } else {
      if (regionAtPlayhead) selectClip(regionAtPlayhead.id);
    }
  }, [annotateVideoUrl, effectiveCurrentTime, selectionState, getRegionAtTimeUnified, clipRegions, selectClip, deselectClip, fullTimeline]);

  // Effect: Sync playback speed with video element (single-video only; multiVideo handles its own)
  useEffect(() => {
    if (!multiVideo && videoRef.current) {
      videoRef.current.playbackRate = annotatePlaybackSpeed;
    }
  }, [annotatePlaybackSpeed, videoRef, multiVideo]);

  // Track if initial annotations have loaded (to avoid dismissing toast on initial load)
  const annotationsLoadedRef = useRef(false);
  useEffect(() => {
    if (!isLoadingAnnotations && annotateGameId) {
      annotationsLoadedRef.current = true;
    }
  }, [isLoadingAnnotations, annotateGameId]);

  // Effect: Dismiss "export complete" toast when user modifies clips
  // This lets users know they need to re-export after making changes
  useEffect(() => {
    if (annotationsLoadedRef.current) {
      dismissExportCompleteToast();
    }
  }, [clipRegions, dismissExportCompleteToast]);

  // Effect: Update metadata from video element when it loads
  // For multi-video games, skip this - combined metadata is set by handleGameVideoSelect
  useEffect(() => {
    if (!annotateVideoUrl || !videoRef.current) return;
    // Don't override metadata for multi-video games (duration is set per-video by tab switch)
    if (gameVideos) return;

    const video = videoRef.current;

    const handleLoadedMetadata = () => {
      const videoDur = video.duration;
      if (!isFinite(videoDur) || videoDur <= 0) return;

      const storedDur = annotateVideoMetadata?.duration;
      // Update if missing OR if video element reports a longer duration than what the DB stored
      // (DB duration can be truncated if ffprobe ran on an incomplete upload)
      if (!storedDur || videoDur > storedDur + 1) {
        setAnnotateVideoMetadata({
          duration: videoDur,
          width: video.videoWidth,
          height: video.videoHeight,
          aspectRatio: video.videoWidth / video.videoHeight,
          fileName: annotateVideoMetadata?.fileName || 'game.mp4',
          format: 'mp4',
          size: annotateVideoMetadata?.size,
          resolution: `${video.videoWidth}x${video.videoHeight}`,
        });
        // Correct the stored duration in the backend so the streaming proxy uses the right value
        const gameId = annotateGameIdRef.current;
        if (gameId && storedDur) {
          apiFetch(`${API_BASE}/api/games/${gameId}/duration`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration: videoDur }),
          }).catch(() => {});
        }
      }
    };

    if (video.readyState >= 1) {
      handleLoadedMetadata();
    } else {
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    }
  }, [annotateVideoUrl, annotateVideoMetadata, videoRef, gameVideos]);

  // Effect: Handle Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && annotateFullscreen) {
        setAnnotateFullscreen(false);
        if (selectionState.type === 'EDITING' || selectionState.type === 'CREATING') {
          closeOverlay();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [annotateFullscreen, setAnnotateFullscreen, selectionState, closeOverlay]);

  // Track playing state for other effects that may need it
  useEffect(() => {
    wasPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // T251: Update high-water mark as user plays/scrubs through video
  // In multi-video mode, effectiveCurrentTime is virtual (continuous progress)
  useEffect(() => {
    if (!annotateGameId || effectiveCurrentTime <= 0) return;
    const key = fullTimeline ? 'unified' : (currentVideoSequence || 'single');
    const prev = viewedHighWaterRef.current.get(key) || 0;
    if (effectiveCurrentTime > prev) {
      viewedHighWaterRef.current.set(key, effectiveCurrentTime);
    }
  }, [effectiveCurrentTime, annotateGameId, currentVideoSequence, fullTimeline]);

  // T251: Compute total viewed duration across all videos (for finish-annotation)
  const getViewedDuration = useCallback(() => {
    let total = 0;
    for (const val of viewedHighWaterRef.current.values()) {
      total += val;
    }
    // Include persisted duration — take the max since high-water mark only increases
    return Math.max(total, persistedViewedDurationRef.current);
  }, []);

  // Computed: Effective duration (virtual total in multi-video)
  const effectiveDuration = multiVideo?.totalDuration ?? annotateVideoMetadata?.duration ?? videoDuration ?? 0;

  /**
   * Wrapper for importAnnotations that also creates raw_clips for each annotation.
   * Used for TSV imports and any other annotation import that needs raw_clip extraction.
   *
   * IMPORTANT: We first import annotations to show clips in UI immediately,
   * then save raw_clips in the background. This ensures responsive UI while
   * FFmpeg extractions happen asynchronously.
   */
  const importAnnotationsWithRawClips = useCallback(async (annotations, overrideDuration = null) => {
    if (!annotations || annotations.length === 0) {
      return importAnnotations(annotations, overrideDuration);
    }

    // First, import annotations to show clips in UI immediately
    const count = importAnnotations(annotations, overrideDuration);

    // Read gameId from ref to get the latest value (not a stale closure).
    // The upload completion callback sets annotateGameId, but useCallback's closure
    // may still have the old null value if React hasn't re-rendered yet.
    const gameId = annotateGameIdRef.current;

    // Then save raw_clips in background (don't block UI)
    if (gameId) {

      // Fire off all saves in parallel (don't await each one sequentially)
      const savePromises = annotations
        .filter(annotation => !annotation.raw_clip_id && !annotation.rawClipId)
        .map(async (annotation) => {
          try {
            const result = await saveClip(gameId, {
              start_time: annotation.startTime ?? annotation.start_time ?? 0,
              end_time: annotation.endTime ?? annotation.end_time ?? 0,
              name: annotation.name || '',
              rating: annotation.rating || 3,
              tags: annotation.tags || [],
              notes: annotation.notes || '',
              video_sequence: annotation.videoSequence ?? annotation.video_sequence ?? null,
            });

            if (result) {
              // Store raw_clip_id for later reference (e.g., when updating clip)
              annotation.raw_clip_id = result.raw_clip_id;
            }
            return result;
          } catch (err) {
            console.error('[AnnotateContainer] Failed to create raw_clip for annotation:', err);
            return null;
          }
        });

      // Wait for all saves to complete (but UI already updated)
      Promise.all(savePromises).then(results => {
        const successCount = results.filter(r => r !== null).length;
      });
    } else {
      console.warn('[AnnotateContainer] No gameId available - clips will not be saved to library');
    }

    return count;
  }, [importAnnotations, saveClip]);

  // T2750: No more tab switching or filtered regions. All clips shown unified.

  return {
    // State
    annotateVideoUrl,
    annotateVideoMetadata,
    annotateGameName,
    annotateFullscreen,
    showAnnotateOverlay,
    annotateSelectedLayer,
    annotatePlaybackSpeed,
    annotateContainerRef,
    annotateFileInputRef,
    isUploadingGameVideo: isUploadingFromStore, // From global store (persists across navigation)
    isClipSaving, // Real-time clip save in progress
    hasAnnotateClips,

    // Clip region state
    clipRegions,
    annotateRegionsWithLayout,
    annotateSelectedRegionId,
    annotateClipCount,
    isLoadingAnnotations,
    ANNOTATE_MAX_NOTES_LENGTH,

    // Handlers
    handleGameVideoSelect,
    handleLoadGame,
    handleToggleFullscreen: fullscreenWorthwhile ? handleToggleFullscreen : undefined,
    handleAddClipFromButton,
    handleFullscreenCreateClip,
    handleFullscreenUpdateClip,
    handleOverlayClose,
    handleOverlayResume,
    handleSelectRegion,
    handleTimelineSeek, // Seek + close overlay if target outside clips (timeline gesture)
    setAnnotatePlaybackSpeed,
    setAnnotateSelectedLayer,

    // Clip region actions (wrapped with backend sync)
    updateClipRegion: updateClipRegionWithSync,
    deleteClipRegion,
    importAnnotations: importAnnotationsWithRawClips,
    getAnnotateRegionAtTime: getRegionAtTimeUnified,
    selectAnnotateRegion, // Raw select for keyboard shortcuts (doesn't seek)
    isEditMode, // Derived from state machine: true when SELECTED
    lockScrub, // Suppress auto-deselect during sidebar scrub
    unlockScrub,

    // T710: Annotation playback (dual-video ping-pong)
    playback,

    // Computed
    effectiveDuration,

    // T2750: Multi-video state (unified mode)
    gameVideos,
    currentVideoSequence,
    multiVideo,
    videoController,
    fullTimeline,
    effectiveCurrentTime,
    effectiveSeek,
    effectiveTogglePlay,
    effectiveIsPlaying,
    effectiveStepForward,
    effectiveStepBackward,
    effectiveSeekBackward,
    effectiveRestart,

    // Game ID (for finish-annotation call when leaving)
    annotateGameId,

    // T2810: Teammate tag suggestions
    teammateSuggestions,

    // T2820: Shared tag tracking
    sharedTagData,
    setSharedTagData,

    // Uncommitted teammate text warning
    showTagWarning,
    dismissTagWarning: useCallback(() => setShowTagWarning(false), []),

    // T251: View progress tracking
    getViewedDuration,

    // Cleanup
    clearAnnotateState: useCallback(() => {
      if (annotateVideoUrl && annotateVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(annotateVideoUrl);
      }
      setAnnotateVideoFile(null);
      setAnnotateVideoUrl(null);
      setAnnotateVideoMetadata(null);
      setAnnotateGameId(null);
      setGameVideos(null);
      setActiveVideoIndex(0);
      resetAnnotate();
      setAnnotateHasSelectedClip(false);
    }, [annotateVideoUrl, resetAnnotate, setAnnotateHasSelectedClip]),
  };
}

export default AnnotateContainer;
