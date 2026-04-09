import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAnnotateState, useAnnotate, useClipSelection } from '../modes/annotate';
import { toast } from '../components/shared';
import { extractVideoMetadata } from '../utils/videoMetadata';
import { useExportStore, useAuthStore } from '../stores';
import { useEditorStore } from '../stores/editorStore';
import { useUploadStore } from '../stores/uploadStore';
import { useRawClipSave } from '../hooks/useRawClipSave';
import { useFullscreenWorthwhile } from '../hooks/useFullscreenWorthwhile';
import { useAnnotationPlayback } from '../modes/annotate/hooks/useAnnotationPlayback';
import { VideoMode, GameType } from '../constants/gameConstants';
import { createVideoURL } from '../utils/videoUtils';

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
  restart,
  seek,

  // Game management
  uploadGameVideo, // T80: Unified upload with deduplication
  getGame,
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

  // T82: Multi-video state (null = single video, array = multi-video)
  const [gameVideos, setGameVideos] = useState(null);
  // [{ sequence, url, duration, width, height, serverUrl? }]
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);

  // Current video's sequence number (1-based, for clip tagging)
  const currentVideoSequence = gameVideos ? gameVideos[activeVideoIndex]?.sequence : null;

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


  // Upload state from Zustand store (persists across page navigation)
  const uploadStore = useUploadStore();
  const activeUpload = uploadStore.activeUpload;

  // Derive upload progress from store for UI display
  const storeUploadProgress = activeUpload ? {
    percent: activeUpload.progress,
    message: activeUpload.message,
  } : null;

  // Derive isUploading from store
  const isUploadingFromStore = uploadStore.isUploading();

  // Track whether we initiated the upload from this component (vs navigating back)
  const uploadInitiatedHereRef = useRef(false);

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
      const onGameCreated = ({ game_id, name }) => {
        annotateGameIdRef.current = game_id;
        setAnnotateGameId(game_id);
        setAnnotateGameName(name);
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
   * Handle loading a saved game into annotate mode
   * Supports both single-video and multi-video games.
   */
  const handleLoadGame = useCallback(async (gameId, pendingClipSeekTime = null) => {

    try {
      const gameData = await getGame(gameId);

      // T82: Check if multi-video game
      const isMultiVideo = gameData.videos && gameData.videos.length > 1;

      let videoUrl;
      let videoMetadata = null;

      if (isMultiVideo) {
        // Multi-video game: load first video, each video has its own timeline
        videoUrl = gameData.videos[0].video_url;

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
        // Single-video game (legacy or single game_videos row)
        videoUrl = gameData.videos?.[0]?.video_url || getGameVideoUrl(gameId, gameData);
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

      // Clean up any existing annotate video URL
      if (annotateVideoUrl && annotateVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(annotateVideoUrl);
      }

      // T251: Initialize high-water mark from persisted data
      viewedHighWaterRef.current = new Map();
      persistedViewedDurationRef.current = gameData.viewed_duration || 0;

      // Reset annotate state before loading new game
      resetAnnotate();

      // Download full video as blob for instant seeks in Annotate mode.
      // Streaming URLs cause stalls on every seek; blob URLs allow instant scrubbing.
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.status}`);
      }
      const blob = await response.blob();
      const file = new File([blob], gameData.name || 'game.mp4', { type: blob.type || 'video/mp4' });
      const blobUrl = createVideoURL(file);

      // Set annotate state with the blob video
      setAnnotateVideoFile(file);
      setAnnotateVideoUrl(blobUrl);
      setAnnotateVideoMetadata(videoMetadata);
      annotateGameIdRef.current = gameId;
      setAnnotateGameId(gameId);
      setAnnotateGameName(gameData.name);

      // Set multi-video state
      if (isMultiVideo) {
        setGameVideos(gameData.videos.map(v => ({
          sequence: v.sequence,
          url: v.video_url,
          serverUrl: v.video_url,
          duration: v.duration,
          width: v.video_width,
          height: v.video_height,
        })));
        setActiveVideoIndex(0);
      } else {
        setGameVideos(null);
        setActiveVideoIndex(0);
      }

      // Import saved annotations if they exist
      if (gameData.annotations && gameData.annotations.length > 0) {
        // For multi-video, use the max video duration for clamping (each video's clips are relative to their own video)
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

        // T740: If navigating from Framing, select the clip the user was editing
        // (importAnnotations auto-selects the first clip; override with the intended one)
        if (pendingClipSeekTime != null) {
          console.log('[AnnotateContainer] Navigated from Framing, will select clip at start_time:', pendingClipSeekTime);
          // importAnnotations generates new region IDs — clipRegions won't update until next render
          pendingSelectSeekTimeRef.current = pendingClipSeekTime;
        }
      }

      setEditorMode('annotate');
    } catch (err) {
      console.warn('[AnnotateContainer] Failed to load game:', err.message);
      if (err.message?.includes('not found')) {
        toast.error('Game not found — it may have been deleted');
        setEditorMode('projects');
      }
    }
  }, [getGame, getGameVideoUrl, annotateVideoUrl, resetAnnotate, importAnnotations, setEditorMode, saveClip]);

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
  useEffect(() => {
    if (pendingSelectSeekTimeRef.current == null || clipRegions.length === 0) return;
    const seekTime = pendingSelectSeekTimeRef.current;
    const match = clipRegions.find(r => Math.abs(r.startTime - seekTime) < 0.5);
    if (match) {
      console.log('[AnnotateContainer] Selecting clip from Framing navigation:', match.id, 'at', match.startTime);
      selectClip(match.id);
    } else {
      console.log('[AnnotateContainer] No clip found matching seekTime:', seekTime);
    }
    pendingSelectSeekTimeRef.current = null;
  }, [clipRegions, selectClip]);

  // Hide fullscreen button when it wouldn't meaningfully increase video size
  const fullscreenWorthwhile = useFullscreenWorthwhile(videoRef, annotateFullscreen);

  /**
   * Handle Add Clip button click (non-fullscreen mode).
   * Creating a new clip requires auth (shows login modal if guest).
   * Editing an existing clip does not require auth.
   * Context (paused video, timestamp) is preserved through the auth modal.
   */
  const handleAddClipFromButton = useCallback(() => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    if (selectionState.type === 'SELECTED') {
      editClip(selectionState.clipId);
    } else {
      requireAuth(() => startCreating());
    }
  }, [videoRef, selectionState, editClip, startCreating, requireAuth]);

  /**
   * Handle creating a clip from fullscreen overlay
   * Now saves to backend in real-time (if video is uploaded and we have a gameId)
   */
  const handleFullscreenCreateClip = useCallback(async (clipData) => {
    const newRegion = addClipRegion(
      clipData.startTime,
      clipData.duration,
      clipData.notes,
      clipData.rating,
      '',
      clipData.tags,
      clipData.name,
      currentVideoSequence,
    );
    if (newRegion) {
      seek(newRegion.startTime);

      // Save to backend if we have a game ID (game record exists in DB even during upload)
      if (annotateGameId) {
        const result = await saveClip(annotateGameId, {
          start_time: newRegion.startTime,
          end_time: newRegion.endTime,
          name: newRegion.name,
          rating: newRegion.rating,
          tags: newRegion.tags,
          notes: newRegion.notes,
          video_sequence: currentVideoSequence,
        });

        if (result?.raw_clip_id) {
          setRawClipId(newRegion.id, result.raw_clip_id);

          if (result.project_created) {
            toast.success('Project created for your 5-star clip!', {
              message: 'We automatically create a highlight project for every brilliant play so you can export it anytime.',
              duration: 8000,
            });
          }
        }
      }
    }
    // Overlay closes automatically: addClipRegion calls onSelect → selectClip → CREATING→SELECTED
  }, [addClipRegion, seek, annotateGameId, saveClip, setRawClipId, currentVideoSequence]);

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

    // Update locally first
    updateClipRegion(regionId, updates);

    // Skip backend sync if no game ID
    if (!annotateGameId) {
      return;
    }

    // If clip doesn't have rawClipId, save it to backend first
    if (!region.rawClipId) {

      // Merge current values with updates for the save
      const clipData = {
        start_time: updates.startTime ?? region.startTime,
        end_time: updates.endTime ?? region.endTime,
        name: updates.name ?? region.name,
        rating: updates.rating ?? region.rating,
        tags: updates.tags ?? region.tags,
        notes: updates.notes ?? region.notes,
        video_sequence: region.videoSequence ?? currentVideoSequence,
      };

      const result = await saveClip(annotateGameId, clipData);
      if (result?.raw_clip_id) {
        setRawClipId(region.id, result.raw_clip_id);

        if (result.project_created) {
          toast.success('Project created for your 5-star clip!', {
            message: 'We automatically create a highlight project for every brilliant play so you can export it anytime.',
            duration: 8000,
          });
        }
      }
    } else {
      // Clip already has rawClipId, just update
      const backendUpdates = {};
      if (updates.name !== undefined) backendUpdates.name = updates.name;
      if (updates.rating !== undefined) backendUpdates.rating = updates.rating;
      if (updates.tags !== undefined) backendUpdates.tags = updates.tags;
      if (updates.notes !== undefined) backendUpdates.notes = updates.notes;
      if (updates.startTime !== undefined) backendUpdates.start_time = updates.startTime;
      if (updates.endTime !== undefined) backendUpdates.end_time = updates.endTime;

      // Handle duration changes - need to send computed start_time
      // Since duration changes keep endTime fixed and adjust startTime
      if (updates.duration !== undefined && updates.startTime === undefined) {
        const newStartTime = Math.max(0, region.endTime - updates.duration);
        backendUpdates.start_time = newStartTime;
      }


      if (Object.keys(backendUpdates).length > 0) {
        const result = await updateClipRemote(region.rawClipId, backendUpdates);
        if (result?.project_created) {
          toast.success('Project created for your 5-star clip!', {
            message: 'We automatically create a highlight project for every brilliant play so you can export it anytime.',
            duration: 8000,
          });
        }
      }
    }
  }, [clipRegions, updateClipRegion, annotateGameId, saveClip, updateClipRemote, setRawClipId, currentVideoSequence]);

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
    togglePlay();
  }, [closeOverlay, togglePlay]);

  /**
   * Handle annotate region selection - selects the region AND seeks to its start
   */
  /**
   * Timeline seek — wraps seek() with overlay management.
   * When the user clicks the timeline (a gesture) while the overlay is open,
   * and the target time has no clip, close the overlay. This is distinct from
   * scrub handle drags (which use seek() directly and should NOT close the overlay).
   */
  const handleTimelineSeek = useCallback((time) => {
    seek(time);
    if (selectionState.type === 'EDITING' || selectionState.type === 'CREATING') {
      if (!getAnnotateRegionAtTime(time)) {
        closeOverlay();
      }
    }
  }, [seek, selectionState, getAnnotateRegionAtTime, closeOverlay]);

  const handleSelectRegion = useCallback((regionId) => {
    const region = clipRegions.find(r => r.id === regionId);
    if (region) {
      // If overlay is open (EDITING), stay in EDITING with new clip; otherwise SELECTED
      if (selectionState.type === 'EDITING') {
        editClip(regionId);
      } else {
        selectClip(regionId);
      }
      seek(region.startTime);
      setAnnotateSelectedLayer('clips');
    } else {
      console.warn('[AnnotateContainer] Region not found! Available IDs:', clipRegions.map(r => r.id));
    }
  }, [clipRegions, selectionState, selectClip, editClip, seek]);

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

    const FRAME_TOLERANCE = 0.15; // ~4 frames at 30fps — handles seek snapping
    const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);

    if (type === 'SELECTED') {
      const selectedClip = clipRegions.find(r => r.id === clipId);
      if (selectedClip && (currentTime < selectedClip.startTime - FRAME_TOLERANCE || currentTime > selectedClip.endTime + FRAME_TOLERANCE)) {
        regionAtPlayhead ? selectClip(regionAtPlayhead.id) : deselectClip();
      }
    } else {
      if (regionAtPlayhead) selectClip(regionAtPlayhead.id);
    }
  }, [annotateVideoUrl, currentTime, selectionState, getAnnotateRegionAtTime, clipRegions, selectClip, deselectClip]);

  // Effect: Sync playback speed with video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = annotatePlaybackSpeed;
    }
  }, [annotatePlaybackSpeed, videoRef]);

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
      if (!annotateVideoMetadata || !annotateVideoMetadata.duration) {
        setAnnotateVideoMetadata({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          aspectRatio: video.videoWidth / video.videoHeight,
          fileName: annotateVideoMetadata?.fileName || 'game.mp4',
          format: 'mp4',
          size: annotateVideoMetadata?.size,
          resolution: `${video.videoWidth}x${video.videoHeight}`,
        });
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
  useEffect(() => {
    if (!annotateGameId || currentTime <= 0) return;
    const key = currentVideoSequence || 'single';
    const prev = viewedHighWaterRef.current.get(key) || 0;
    if (currentTime > prev) {
      viewedHighWaterRef.current.set(key, currentTime);
    }
  }, [currentTime, annotateGameId, currentVideoSequence]);

  // T251: Compute total viewed duration across all videos (for finish-annotation)
  const getViewedDuration = useCallback(() => {
    let total = 0;
    for (const val of viewedHighWaterRef.current.values()) {
      total += val;
    }
    // Include persisted duration — take the max since high-water mark only increases
    return Math.max(total, persistedViewedDurationRef.current);
  }, []);

  // Computed: Effective duration
  const effectiveDuration = annotateVideoMetadata?.duration || videoDuration || 0;

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

  // T82: Simple tab-based video switching
  // Each video is independent with its own timeline (no virtual absolute timeline)
  const handleVideoTabSwitch = useCallback(async (index) => {
    if (!gameVideos || index < 0 || index >= gameVideos.length) return;
    if (index === activeVideoIndex) return;

    const video = gameVideos[index];
    const streamingUrl = video.url || video.serverUrl;

    try {
      // Revoke previous blob URL before switching
      if (annotateVideoUrl && annotateVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(annotateVideoUrl);
      }

      // Download full video as blob for instant seeks
      const response = await fetch(streamingUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.status}`);
      }
      const blob = await response.blob();
      const file = new File([blob], 'game_video.mp4', { type: blob.type || 'video/mp4' });
      const blobUrl = createVideoURL(file);

      setActiveVideoIndex(index);
      setAnnotateVideoUrl(blobUrl);
      // Update metadata to this video's duration
      setAnnotateVideoMetadata(prev => ({
        ...prev,
        duration: video.duration,
        width: video.width || prev?.width,
        height: video.height || prev?.height,
      }));
    } catch (err) {
      console.error('[AnnotateContainer] Failed to download video for tab switch:', err);
      toast.error('Failed to load video');
    }
  }, [gameVideos, activeVideoIndex, annotateVideoUrl, setAnnotateVideoUrl, setAnnotateVideoMetadata]);

  // Filter clip regions to only show clips for the current video
  const filteredClipRegions = useMemo(() => {
    if (!gameVideos) return clipRegions; // single-video: show all
    return clipRegions.filter(r => r.videoSequence === currentVideoSequence);
  }, [clipRegions, gameVideos, currentVideoSequence]);

  // Filtered regions with layout (for timeline display)
  const filteredRegionsWithLayout = useMemo(() => {
    if (!gameVideos) return annotateRegionsWithLayout;
    return annotateRegionsWithLayout.filter(r => r.videoSequence === currentVideoSequence);
  }, [annotateRegionsWithLayout, gameVideos, currentVideoSequence]);

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
    uploadProgress: storeUploadProgress, // From global store
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
    getAnnotateRegionAtTime,
    selectAnnotateRegion, // Raw select for keyboard shortcuts (doesn't seek)
    isEditMode, // Derived from state machine: true when SELECTED
    lockScrub, // Suppress auto-deselect during sidebar scrub
    unlockScrub,

    // T710: Annotation playback (dual-video ping-pong)
    playback,

    // Computed
    effectiveDuration,

    // T82: Multi-video state
    gameVideos,
    activeVideoIndex,
    isMultiVideo: !!gameVideos,
    handleVideoTabSwitch,
    currentVideoSequence,
    // Filtered clip regions for current video (multi-video only)
    filteredClipRegions,
    filteredRegionsWithLayout,

    // Game ID (for finish-annotation call when leaving)
    annotateGameId,

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
