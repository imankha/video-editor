import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, Loader, Upload, Settings } from 'lucide-react';
import { useAnnotateState, useAnnotate, AnnotateMode, ClipsSidePanel, NotesOverlay, AnnotateControls, AnnotateFullscreenOverlay } from '../modes/annotate';
import { FileUpload } from '../components/FileUpload';
import { toast } from '../components/shared';
import { extractVideoMetadata } from '../utils/videoMetadata';
import { useExportStore } from '../stores';
import { useRawClipSave } from '../hooks/useRawClipSave';
import { API_BASE } from '../config';

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
  createGame,
  uploadGameVideo,
  getGame,
  getGameVideoUrl,
  saveAnnotationsDebounced,

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
    isCreatingAnnotatedVideo,
    setIsCreatingAnnotatedVideo,
    isImportingToProjects,
    setIsImportingToProjects,
    isUploadingGameVideo,
    setIsUploadingGameVideo,
    uploadProgress,
    setUploadProgress,
    annotatePlaybackSpeed,
    setAnnotatePlaybackSpeed,
    annotateFullscreen,
    setAnnotateFullscreen,
    showAnnotateOverlay,
    setShowAnnotateOverlay,
    annotateSelectedLayer,
    setAnnotateSelectedLayer,
    annotateContainerRef,
    annotateFileInputRef,
  } = useAnnotateState();

  // Annotate clip management hook
  const {
    clipRegions,
    regionsWithLayout: annotateRegionsWithLayout,
    selectedRegionId: annotateSelectedRegionId,
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
  } = useAnnotate(annotateVideoMetadata);

  // Real-time clip saving hook
  const {
    saveClip,
    updateClip: updateClipRemote,
    deleteClip: deleteClipRemote,
    isSaving: isClipSaving,
  } = useRawClipSave();

  // Export state from Zustand store
  const {
    exportProgress,
    setExportProgress,
    setExportCompleteToastId,
    dismissExportCompleteToast,
  } = useExportStore();

  // Ref to track previous isPlaying state for detecting pause transitions
  const wasPlayingRef = useRef(false);

  /**
   * Handle game video selection for Annotate mode
   * Transitions to annotate mode where user can extract clips from full game footage.
   */
  const handleGameVideoSelect = async (file) => {
    if (!file) return;

    try {
      console.log('[AnnotateContainer] handleGameVideoSelect: Processing', file.name);

      // Extract video metadata (fast, local operation)
      const videoMetadata = await extractVideoMetadata(file);
      console.log('[AnnotateContainer] Extracted game video metadata:', videoMetadata);

      // Create local object URL for IMMEDIATE playback
      const localVideoUrl = URL.createObjectURL(file);

      // Clean up any existing annotate video URL (only if it was an object URL)
      if (annotateVideoUrl && annotateVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(annotateVideoUrl);
      }

      // Create game row IMMEDIATELY (just name, no video yet)
      const gameName = file.name.replace(/\.[^/.]+$/, '');
      console.log('[AnnotateContainer] Creating game row:', gameName);
      const game = await createGame(gameName, {
        duration: videoMetadata.duration,
        width: videoMetadata.width,
        height: videoMetadata.height,
        size: videoMetadata.size,
      });
      console.log('[AnnotateContainer] Game created with ID:', game.id);

      // Set annotate state with LOCAL video URL and game ID
      setAnnotateVideoFile(file);
      setAnnotateVideoUrl(localVideoUrl);
      setAnnotateVideoMetadata(videoMetadata);
      setAnnotateGameId(game.id);

      // Transition to annotate mode IMMEDIATELY
      setEditorMode('annotate');

      console.log('[AnnotateContainer] Set up with game ID:', game.id);

      // Upload video to server in background with progress tracking
      console.log('[AnnotateContainer] Starting background video upload...');
      setIsUploadingGameVideo(true);
      setUploadProgress({ loaded: 0, total: file.size, percent: 0 });

      uploadGameVideo(game.id, file, (loaded, total, percent) => {
        setUploadProgress({ loaded, total, percent });
      })
        .then(() => {
          console.log('[AnnotateContainer] Background video upload complete for game:', game.id);
          setIsUploadingGameVideo(false);
          setUploadProgress(null);
        })
        .catch((uploadErr) => {
          console.error('[AnnotateContainer] Background video upload failed:', uploadErr);
          setIsUploadingGameVideo(false);
          setUploadProgress(null);
        });

    } catch (err) {
      console.error('[AnnotateContainer] Failed to process game video:', err);
      throw err;
    }
  };

  /**
   * Handle loading a saved game into annotate mode
   */
  const handleLoadGame = useCallback(async (gameId) => {
    console.log('[AnnotateContainer] Loading game:', gameId);

    try {
      const gameData = await getGame(gameId);
      console.log('[AnnotateContainer] Loaded game data:', gameData);

      const videoUrl = getGameVideoUrl(gameId);
      console.log('[AnnotateContainer] Game video URL:', videoUrl);

      // Use stored metadata if available
      let videoMetadata = null;
      if (gameData.video_duration && gameData.video_width && gameData.video_height) {
        console.log('[AnnotateContainer] Using stored video metadata (instant load)');
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

      // Clean up any existing annotate video URL
      if (annotateVideoUrl && annotateVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(annotateVideoUrl);
      }

      // Reset annotate state before loading new game
      resetAnnotate();

      // Set annotate state with the game's video
      setAnnotateVideoFile(null);
      setAnnotateVideoUrl(videoUrl);
      setAnnotateVideoMetadata(videoMetadata);
      setAnnotateGameId(gameId);

      // Import saved annotations if they exist
      // Pass duration directly to avoid race condition with state updates
      if (gameData.annotations && gameData.annotations.length > 0) {
        const gameDuration = videoMetadata?.duration || gameData.video_duration;
        console.log('[AnnotateContainer] Importing', gameData.annotations.length, 'saved annotations with duration:', gameDuration);

        // Check for annotations that don't have raw_clips yet (id is the raw_clip id)
        const annotationsWithoutRawClips = gameData.annotations.filter(a => !a.id);

        if (annotationsWithoutRawClips.length > 0) {
          console.log('[AnnotateContainer] Found', annotationsWithoutRawClips.length, 'annotations without raw_clips, creating them...');

          // Create raw_clips for annotations that don't have them
          for (const annotation of annotationsWithoutRawClips) {
            try {
              const result = await saveClip(gameId, {
                start_time: annotation.start_time,
                end_time: annotation.end_time,
                name: annotation.name || '',
                rating: annotation.rating || 3,
                tags: annotation.tags || [],
                notes: annotation.notes || ''
              });

              if (result) {
                // Update the annotation with the new raw_clip id
                annotation.id = result.raw_clip_id;
                console.log('[AnnotateContainer] Created raw_clip', result.raw_clip_id, 'for annotation at', annotation.end_time);
              }
            } catch (err) {
              console.error('[AnnotateContainer] Failed to create raw_clip for annotation:', err);
            }
          }
        }

        importAnnotations(gameData.annotations, gameDuration);
      }

      // Transition to annotate mode
      setEditorMode('annotate');

      console.log('[AnnotateContainer] Successfully loaded game:', gameId);
    } catch (err) {
      console.error('[AnnotateContainer] Failed to load game:', err);
    }
  }, [getGame, getGameVideoUrl, annotateVideoUrl, resetAnnotate, importAnnotations, setEditorMode, saveClip]);

  /**
   * Helper function to call the annotate export API
   */
  const callAnnotateExportApi = useCallback(async (clipData, saveToDb, settings = null) => {
    // Quick health check before starting export
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const healthResponse = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!healthResponse.ok) {
        throw new Error('Server health check failed');
      }
    } catch (healthErr) {
      console.error('[AnnotateContainer] Server health check failed:', healthErr);
      throw new Error('Cannot connect to server. Please ensure the backend server is running on port 8000.');
    }

    const exportId = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    let eventSource = null;

    try {
      eventSource = new EventSource(`${API_BASE}/api/annotate/progress/${exportId}`);
      eventSource.onmessage = (event) => {
        try {
          const progress = JSON.parse(event.data);
          console.log('[AnnotateContainer] SSE progress:', progress.current, '/', progress.total, '=', Math.round((progress.current / progress.total) * 100) + '%', progress.message);
          setExportProgress(progress);
          if (progress.done) {
            eventSource?.close();
          }
        } catch (e) {
          console.warn('[AnnotateContainer] Failed to parse progress:', e);
        }
      };
      eventSource.onerror = () => {
        eventSource?.close();
      };
    } catch (e) {
      console.warn('[AnnotateContainer] Failed to connect to progress endpoint:', e);
    }

    const formData = new FormData();
    formData.append('save_to_db', saveToDb ? 'true' : 'false');
    formData.append('export_id', exportId);

    if (saveToDb && settings) {
      formData.append('settings_json', JSON.stringify(settings));
    }

    const clipsForApi = clipData.map(clip => ({
      start_time: clip.start_time,
      end_time: clip.end_time,
      name: clip.name,
      notes: clip.notes || '',
      rating: clip.rating || 3,
      tags: clip.tags || []
    }));

    formData.append('clips_json', JSON.stringify(clipsForApi));

    if (annotateGameId) {
      formData.append('game_id', annotateGameId.toString());
    } else if (annotateVideoFile) {
      formData.append('video', annotateVideoFile);
    } else {
      eventSource?.close();
      throw new Error('No video source available');
    }

    try {
      const response = await fetch(`${API_BASE}/api/annotate/export`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Export failed: ${response.status}`);
      }

      return await response.json();
    } finally {
      eventSource?.close();
      setTimeout(() => setExportProgress(null), 1000);
    }
  }, [annotateVideoFile, annotateGameId]);

  /**
   * Create Annotated Video - Downloads compilation video, stays on annotate screen
   */
  const handleCreateAnnotatedVideo = useCallback(async (clipData) => {
    console.log('[AnnotateContainer] Create annotated video requested with clips:', clipData);

    const hasVideoSource = annotateVideoFile || annotateGameId;
    if (!hasVideoSource || !clipData || clipData.length === 0) {
      console.error('[AnnotateContainer] Cannot export: no video source or clips');
      return;
    }

    setIsCreatingAnnotatedVideo(true);
    try {
      console.log('[AnnotateContainer] Creating annotated video (download only)...');

      const result = await callAnnotateExportApi(clipData, false);

      console.log('[AnnotateContainer] Annotated video created:', {
        success: result.success,
        downloads: Object.keys(result.downloads || {})
      });

      if (result.downloads?.clips_compilation?.url) {
        console.log('[AnnotateContainer] Downloading clips compilation...');
        const a = document.createElement('a');
        a.href = `${API_BASE}${result.downloads.clips_compilation.url}`;
        a.download = result.downloads.clips_compilation.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        console.log('[AnnotateContainer] Downloaded:', result.downloads.clips_compilation.filename);
      }

      // Show persistent toast - dismissed when user makes changes
      const toastId = toast.success('Annotated video created!', {
        message: 'Your video has been downloaded successfully.',
        duration: 0  // Persistent - dismissed when user makes changes
      });
      setExportCompleteToastId(toastId);
      console.log('[AnnotateContainer] Create annotated video complete');

    } catch (err) {
      console.error('[AnnotateContainer] Create annotated video failed:', err);
      toast.error('Failed to create video', {
        message: err.message
      });
    } finally {
      setIsCreatingAnnotatedVideo(false);
    }
  }, [annotateVideoFile, annotateGameId, callAnnotateExportApi, setExportCompleteToastId]);

  // NOTE: handleImportIntoProjects has been removed - clips are now saved in real-time during annotation
  // The old batch import flow is no longer needed. See handleFullscreenCreateClip for real-time saving.

  /**
   * Handle fullscreen toggle - uses CSS fixed positioning instead of browser API
   */
  const handleToggleFullscreen = useCallback(() => {
    setAnnotateFullscreen(prev => !prev);
  }, [setAnnotateFullscreen]);

  /**
   * Handle Add Clip button click (non-fullscreen mode)
   */
  const handleAddClipFromButton = useCallback(() => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    setShowAnnotateOverlay(true);
  }, [videoRef]);

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
      clipData.name
    );
    if (newRegion) {
      seek(newRegion.startTime);

      // Save to backend if we have a game ID and video is uploaded
      if (annotateGameId && !isUploadingGameVideo) {
        const result = await saveClip(annotateGameId, {
          start_time: newRegion.startTime,
          end_time: newRegion.endTime,
          name: newRegion.name,
          rating: newRegion.rating,
          tags: newRegion.tags,
          notes: newRegion.notes
        });

        if (result?.raw_clip_id) {
          setRawClipId(newRegion.id, result.raw_clip_id);
          console.log('[AnnotateContainer] Clip saved to backend:', result.raw_clip_id);

          if (result.project_created) {
            console.log('[AnnotateContainer] Auto-created 5-star project:', result.project_id);
          }
        }
      } else if (isUploadingGameVideo) {
        console.log('[AnnotateContainer] Video still uploading, clip will be saved when annotations sync');
      }
    }
    setShowAnnotateOverlay(false);
  }, [addClipRegion, seek, annotateGameId, isUploadingGameVideo, saveClip, setRawClipId]);

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

    // Skip backend sync if video is still uploading or no game ID
    if (!annotateGameId || isUploadingGameVideo) {
      console.log('[AnnotateContainer] Skipping backend sync - video uploading or no game ID');
      return;
    }

    // If clip doesn't have rawClipId, save it to backend first
    if (!region.rawClipId) {
      console.log('[AnnotateContainer] Clip has no rawClipId, saving to backend first');

      // Merge current values with updates for the save
      const clipData = {
        start_time: updates.startTime ?? region.startTime,
        end_time: updates.endTime ?? region.endTime,
        name: updates.name ?? region.name,
        rating: updates.rating ?? region.rating,
        tags: updates.tags ?? region.tags,
        notes: updates.notes ?? region.notes
      };

      const result = await saveClip(annotateGameId, clipData);
      if (result?.raw_clip_id) {
        setRawClipId(region.id, result.raw_clip_id);
        console.log('[AnnotateContainer] Clip saved to backend:', result.raw_clip_id);

        if (result.project_created) {
          console.log('[AnnotateContainer] Auto-created 5-star project:', result.project_id);
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

      if (Object.keys(backendUpdates).length > 0) {
        const result = await updateClipRemote(region.rawClipId, backendUpdates);
        if (result?.project_created) {
          console.log('[AnnotateContainer] Auto-created 5-star project:', result.project_id);
        }
      }
    }
  }, [clipRegions, updateClipRegion, annotateGameId, isUploadingGameVideo, saveClip, updateClipRemote, setRawClipId]);

  /**
   * Handle updating an existing clip from fullscreen overlay
   * Uses updateClipRegionWithSync for backend sync
   */
  const handleFullscreenUpdateClip = useCallback(async (regionId, updates) => {
    await updateClipRegionWithSync(regionId, updates);
    setShowAnnotateOverlay(false);
  }, [updateClipRegionWithSync]);

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
      console.log('[AnnotateContainer] Clip deleted from backend:', rawClipId);
    }
  }, [clipRegions, deleteClipRegionLocal, deleteClipRemote]);

  /**
   * Handle closing the fullscreen overlay without creating a clip
   */
  const handleOverlayClose = useCallback(() => {
    setShowAnnotateOverlay(false);
  }, []);

  /**
   * Handle resuming playback from fullscreen overlay
   */
  const handleOverlayResume = useCallback(() => {
    setShowAnnotateOverlay(false);
    togglePlay();
  }, [togglePlay]);

  /**
   * Handle annotate region selection - selects the region AND seeks to its start
   */
  const handleSelectRegion = useCallback((regionId) => {
    console.log('[AnnotateContainer] handleSelectRegion called with regionId:', regionId);
    const region = clipRegions.find(r => r.id === regionId);
    if (region) {
      selectAnnotateRegion(regionId);
      seek(region.startTime);
      setAnnotateSelectedLayer('clips');
    } else {
      console.warn('[AnnotateContainer] Region not found! Available IDs:', clipRegions.map(r => r.id));
    }
  }, [clipRegions, selectAnnotateRegion, seek]);

  // Effect: Auto-select annotate clip when playhead is over a region
  useEffect(() => {
    if (!annotateVideoUrl) return;

    const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);
    if (regionAtPlayhead && regionAtPlayhead.id !== annotateSelectedRegionId) {
      const currentSelection = clipRegions.find(r => r.id === annotateSelectedRegionId);
      if (currentSelection && currentTime >= currentSelection.startTime && currentTime <= currentSelection.endTime) {
        return;
      }
      selectAnnotateRegion(regionAtPlayhead.id);
    }
  }, [annotateVideoUrl, currentTime, getAnnotateRegionAtTime, annotateSelectedRegionId, selectAnnotateRegion, clipRegions]);

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
  useEffect(() => {
    if (!annotateVideoUrl || !videoRef.current) return;

    const video = videoRef.current;

    const handleLoadedMetadata = () => {
      if (!annotateVideoMetadata || !annotateVideoMetadata.duration) {
        console.log('[AnnotateContainer] Video loaded, extracting metadata from element');
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
  }, [annotateVideoUrl, annotateVideoMetadata, videoRef]);

  // Effect: Handle Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && annotateFullscreen) {
        setAnnotateFullscreen(false);
        setShowAnnotateOverlay(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [annotateFullscreen, setAnnotateFullscreen]);

  // Effect: Show overlay when TRANSITIONING from playing to paused while in fullscreen
  useEffect(() => {
    const justPaused = wasPlayingRef.current && !isPlaying;
    wasPlayingRef.current = isPlaying;

    if (annotateFullscreen && justPaused) {
      setShowAnnotateOverlay(true);
    }
  }, [annotateFullscreen, isPlaying]);

  // Effect: Auto-save annotations when they change
  useEffect(() => {
    if (annotateGameId && clipRegions.length > 0) {
      const annotationsForSave = clipRegions.map(region => ({
        start_time: region.startTime,
        end_time: region.endTime,
        name: region.name,
        tags: region.tags || [],
        notes: region.notes || '',
        rating: region.rating || 3
      }));
      saveAnnotationsDebounced(annotateGameId, annotationsForSave);
    }
  }, [annotateGameId, clipRegions, saveAnnotationsDebounced]);

  // Computed: Effective duration
  const effectiveDuration = annotateVideoMetadata?.duration || videoDuration || 0;

  /**
   * Wrapper for importAnnotations that also creates raw_clips for each annotation.
   * Used for TSV imports and any other annotation import that needs raw_clip extraction.
   */
  const importAnnotationsWithRawClips = useCallback(async (annotations, overrideDuration = null) => {
    if (!annotations || annotations.length === 0 || !annotateGameId) {
      return importAnnotations(annotations, overrideDuration);
    }

    console.log('[AnnotateContainer] Creating raw_clips for', annotations.length, 'imported annotations...');

    // Create raw_clips for each annotation that doesn't have one
    for (const annotation of annotations) {
      // Skip if already has a raw_clip_id
      if (annotation.raw_clip_id || annotation.rawClipId) {
        continue;
      }

      try {
        const result = await saveClip(annotateGameId, {
          start_time: annotation.startTime ?? annotation.start_time ?? 0,
          end_time: annotation.endTime ?? annotation.end_time ?? 0,
          name: annotation.name || '',
          rating: annotation.rating || 3,
          tags: annotation.tags || [],
          notes: annotation.notes || ''
        });

        if (result) {
          // Add the raw_clip_id to the annotation
          annotation.raw_clip_id = result.raw_clip_id;
          console.log('[AnnotateContainer] Created raw_clip', result.raw_clip_id, 'for imported annotation');
        }
      } catch (err) {
        console.error('[AnnotateContainer] Failed to create raw_clip for annotation:', err);
      }
    }

    // Now import with rawClipIds attached
    return importAnnotations(annotations, overrideDuration);
  }, [annotateGameId, importAnnotations, saveClip]);

  return {
    // State
    annotateVideoUrl,
    annotateVideoMetadata,
    annotateFullscreen,
    showAnnotateOverlay,
    annotateSelectedLayer,
    annotatePlaybackSpeed,
    annotateContainerRef,
    annotateFileInputRef,
    isCreatingAnnotatedVideo,
    isImportingToProjects, // Kept for backwards compatibility, may be removed later
    isUploadingGameVideo,
    uploadProgress,
    isClipSaving, // Real-time clip save in progress
    hasAnnotateClips,
    exportProgress,

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
    handleCreateAnnotatedVideo,
    handleToggleFullscreen,
    handleAddClipFromButton,
    handleFullscreenCreateClip,
    handleFullscreenUpdateClip,
    handleOverlayClose,
    handleOverlayResume,
    handleSelectRegion,
    setAnnotatePlaybackSpeed,
    setAnnotateSelectedLayer,

    // Clip region actions (wrapped with backend sync)
    updateClipRegion: updateClipRegionWithSync,
    deleteClipRegion,
    importAnnotations: importAnnotationsWithRawClips,
    getAnnotateRegionAtTime,
    getAnnotateExportData,
    selectAnnotateRegion, // Raw select for keyboard shortcuts (doesn't seek)

    // Computed
    effectiveDuration,

    // Cleanup
    clearAnnotateState: useCallback(() => {
      if (annotateVideoUrl && annotateVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(annotateVideoUrl);
      }
      setAnnotateVideoFile(null);
      setAnnotateVideoUrl(null);
      setAnnotateVideoMetadata(null);
      setAnnotateGameId(null);
      setIsUploadingGameVideo(false);
      resetAnnotate();
    }, [annotateVideoUrl, resetAnnotate]),
  };
}

/**
 * AnnotateSidebar - Sidebar component for Annotate mode
 */
export function AnnotateSidebar({
  clipRegions,
  selectedRegionId,
  onSelectRegion,
  onUpdateRegion,
  onDeleteRegion,
  onImportAnnotations,
  maxNotesLength,
  clipCount,
  videoDuration,
  isLoading,
}) {
  return (
    <ClipsSidePanel
      clipRegions={clipRegions}
      selectedRegionId={selectedRegionId}
      onSelectRegion={onSelectRegion}
      onUpdateRegion={onUpdateRegion}
      onDeleteRegion={onDeleteRegion}
      onImportAnnotations={onImportAnnotations}
      maxNotesLength={maxNotesLength}
      clipCount={clipCount}
      videoDuration={videoDuration}
      isLoading={isLoading}
    />
  );
}

/**
 * AnnotateVideoOverlays - Video overlay components for Annotate mode
 */
export function AnnotateVideoOverlays({
  annotateVideoUrl,
  currentTime,
  showAnnotateOverlay,
  annotateFullscreen,
  annotateVideoMetadata,
  getAnnotateRegionAtTime,
  onCreateClip,
  onUpdateClip,
  onResume,
  onClose,
}) {
  if (!annotateVideoUrl) return null;

  const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);

  return (
    <>
      {/* Notes overlay - shows name, rating notation, and notes for region at playhead */}
      {(regionAtPlayhead?.name || regionAtPlayhead?.notes) && (
        <NotesOverlay
          key="annotate-notes"
          name={regionAtPlayhead.name}
          notes={regionAtPlayhead.notes}
          rating={regionAtPlayhead.rating}
          isVisible={true}
          isFullscreen={annotateFullscreen}
        />
      )}

      {/* Fullscreen overlay - appears when paused in fullscreen */}
      {showAnnotateOverlay && (
        <AnnotateFullscreenOverlay
          key="annotate-fullscreen"
          isVisible={showAnnotateOverlay}
          currentTime={currentTime}
          videoDuration={annotateVideoMetadata?.duration || 0}
          existingClip={regionAtPlayhead}
          onCreateClip={onCreateClip}
          onUpdateClip={onUpdateClip}
          onResume={onResume}
          onClose={onClose}
        />
      )}
    </>
  );
}

/**
 * AnnotateVideoControls - Video controls for Annotate mode
 */
export function AnnotateVideoControls({
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onRestart,
  playbackSpeed,
  onSpeedChange,
  isFullscreen,
  onToggleFullscreen,
  onAddClip,
}) {
  return (
    <AnnotateControls
      isPlaying={isPlaying}
      currentTime={currentTime}
      duration={duration}
      onTogglePlay={onTogglePlay}
      onStepForward={onStepForward}
      onStepBackward={onStepBackward}
      onRestart={onRestart}
      playbackSpeed={playbackSpeed}
      onSpeedChange={onSpeedChange}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      onAddClip={onAddClip}
    />
  );
}

/**
 * AnnotateTimeline - Timeline component for Annotate mode
 */
export function AnnotateTimeline({
  currentTime,
  duration,
  isPlaying,
  onSeek,
  regions,
  selectedRegionId,
  onSelectRegion,
  onDeleteRegion,
  selectedLayer,
  onLayerSelect,
}) {
  return (
    <AnnotateMode
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
      onSeek={onSeek}
      regions={regions}
      selectedRegionId={selectedRegionId}
      onSelectRegion={onSelectRegion}
      onDeleteRegion={onDeleteRegion}
      selectedLayer={selectedLayer}
      onLayerSelect={onLayerSelect}
    />
  );
}

/**
 * AnnotateExportPanel - Export panel for Annotate mode
 */
export function AnnotateExportPanel({
  hasClips,
  isCreatingAnnotatedVideo,
  isImportingToProjects,
  isUploadingGameVideo,
  exportProgress,
  onCreateAnnotatedVideo,
  onImportIntoProjects,
  onOpenSettings,
  getExportData,
}) {
  return (
    <div className="mt-6">
      <div className="space-y-3">
        {/* Export Settings */}
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
          <div className="text-sm font-medium text-gray-300 mb-3">
            Annotate Settings
          </div>
          <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
            Extracts marked clips and loads them into Framing mode
          </div>
        </div>

        {/* Export buttons */}
        <div className="space-y-2">
          {/* Progress bar (shown during export) */}
          {exportProgress && (
            <div className="bg-gray-800 rounded-lg p-3 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">{exportProgress.message}</span>
                {exportProgress.total > 0 && (
                  <span className="text-xs text-gray-500">
                    {Math.round((exportProgress.current / exportProgress.total) * 100)}%
                  </span>
                )}
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    exportProgress.done ? 'bg-green-500' : 'bg-blue-500'
                  }`}
                  style={{
                    width: exportProgress.total > 0
                      ? `${(exportProgress.current / exportProgress.total) * 100}%`
                      : '0%'
                  }}
                />
              </div>
              {exportProgress.phase === 'clips' && (
                <div className="text-xs text-gray-500 mt-1">
                  {exportProgress.current > 0 && 'Using cache for unchanged clips'}
                </div>
              )}
            </div>
          )}

          {/* Create Annotated Video - stays on screen */}
          <button
            onClick={() => onCreateAnnotatedVideo(getExportData())}
            disabled={!hasClips || isCreatingAnnotatedVideo || isImportingToProjects || isUploadingGameVideo}
            className={`w-full px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
              !hasClips || isCreatingAnnotatedVideo || isImportingToProjects || isUploadingGameVideo
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {isUploadingGameVideo ? (
              <>
                <Loader className="animate-spin" size={18} />
                <span>Uploading video...</span>
              </>
            ) : isCreatingAnnotatedVideo ? (
              <>
                <Loader className="animate-spin" size={18} />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <Download size={18} />
                <span>Create Annotated Video</span>
              </>
            )}
          </button>

          {/* Import Into Projects - navigates to projects */}
          <div className="flex gap-2">
            <button
              onClick={() => onImportIntoProjects(getExportData())}
              disabled={!hasClips || isCreatingAnnotatedVideo || isImportingToProjects || isUploadingGameVideo}
              className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                !hasClips || isCreatingAnnotatedVideo || isImportingToProjects || isUploadingGameVideo
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isImportingToProjects ? (
                <>
                  <Loader className="animate-spin" size={18} />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Upload size={18} />
                  <span>Import Into Projects</span>
                </>
              )}
            </button>
            {/* Settings button */}
            <button
              onClick={onOpenSettings}
              className="px-3 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors"
              title="Project creation settings"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnnotateContainer;
