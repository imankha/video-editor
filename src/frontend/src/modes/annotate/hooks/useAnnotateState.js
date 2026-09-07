import { useState, useCallback, useRef } from 'react';
import { extractVideoMetadataFromUrl } from '../../../utils/videoMetadata';
import { peekPendingGame } from '../../../utils/pendingNavigation';
import { buildEarlyGameVideoSrc } from '../../../containers/annotateVideoLoad';

/**
 * useAnnotateState - Consolidates annotate mode state management
 *
 * This hook manages:
 * - Annotate video file and URL
 * - Annotate video metadata
 * - Current game ID for saving annotations
 * - Export/import loading states
 * - Playback settings (speed, fullscreen)
 * - UI state (overlay visibility, layer selection)
 *
 * This reduces prop drilling from App.jsx and keeps annotate-specific
 * state together in one place.
 */

const DEFAULT_PLAYBACK_SPEED = 1;
const DEFAULT_SELECTED_LAYER = 'clips';
const DEFAULT_LAYER_FILTER = 'all';

export default function useAnnotateState() {
  // Video state
  const [annotateVideoFile, setAnnotateVideoFile] = useState(null);
  // T4000: when we arrive here to open a saved game (pending-navigation breadcrumb),
  // seed the stable /video src NOW so the controlled <video> mounts WITH a src on the
  // FIRST commit. The byte fetch then starts a render-cycle earlier (overlapping /load)
  // instead of after handleLoadGame's post-commit setAnnotateVideoUrl — which is what
  // made /video fire ~38ms after /load. A non-consuming peek; AnnotateScreen's effect
  // still consumes the breadcrumb and runs the full load, where beginGameVideoLoad's
  // setAnnotateVideoUrl(sameSrc) is a no-op. Null when not opening a saved game.
  const [annotateVideoUrl, setAnnotateVideoUrl] = useState(() => {
    const pending = peekPendingGame();
    return pending ? buildEarlyGameVideoSrc(pending.gameId, pending.seekTime) : null;
  });
  const [annotateVideoMetadata, setAnnotateVideoMetadata] = useState(null);

  // Current game ID and name for saving annotations
  const [annotateGameId, setAnnotateGameId] = useState(null);
  const [annotateGameName, setAnnotateGameName] = useState(null);

  // bug 27p: true when the loaded game's source video has expired (R2 source
  // hard-deleted post-grace). Drives a deliberate "source expired" state in the
  // player instead of a broken/hanging <video>. Authoritative value comes from
  // the /load response (game.storage_status); annotations stay readable.
  const [annotateSourceExpired, setAnnotateSourceExpired] = useState(false);

  // Export/import loading states
  const [isCreatingAnnotatedVideo, setIsCreatingAnnotatedVideo] = useState(false);
  const [isImportingToProjects, setIsImportingToProjects] = useState(false);
  const [isUploadingGameVideo, setIsUploadingGameVideo] = useState(false);

  // Upload progress state: { loaded: bytes, total: bytes, percent: 0-100 } or null
  const [uploadProgress, setUploadProgress] = useState(null);

  // Playback settings
  const [annotatePlaybackSpeed, setAnnotatePlaybackSpeed] = useState(DEFAULT_PLAYBACK_SPEED);
  const [annotateFullscreen, setAnnotateFullscreen] = useState(false);

  // UI state
  // NOTE: showAnnotateOverlay removed — now derived from useClipSelection state machine
  const [annotateSelectedLayer, setAnnotateSelectedLayer] = useState(DEFAULT_SELECTED_LAYER);

  // T5700/T8030: which raw_clips.my_athlete layer NEW clips land on, and which
  // layer the clip list is filtered to. Both are ephemeral session view state —
  // never persisted (no backend write, no store that syncs). The filter resets to
  // 'all' on the game-open gesture; the new-clip layer always defaults to My
  // Athlete, reset imperatively on the same gesture (AnnotateContainer) — never
  // inherited from the previous clip and never via a state-watching effect.
  const [newClipLayerIsMine, setNewClipLayerIsMine] = useState(true);
  const [layerFilter, setLayerFilter] = useState(DEFAULT_LAYER_FILTER);

  // T8890: which camera "angle" the user is currently watching in an overlap
  // game. Pure EPHEMERAL view state (EPIC decision 10) — null means the backbone
  // ("main camera"), the default. Resets on the game-open gesture (below); it is
  // NEVER persisted and NEVER written from a state-watching effect. The concrete
  // backbone sequence is resolved lazily at read sites from buildGameTimeline, so
  // there is no load-time write-back to seed a default (that would be the banned
  // reactive-persistence shape). Inert for angle-free games (stays null).
  const [activeSourceSequence, setActiveSourceSequence] = useState(null);

  // Ref for fullscreen container
  const annotateContainerRef = useRef(null);

  // Ref for annotate mode file input (to trigger file picker directly from ProjectManager)
  const annotateFileInputRef = useRef(null);

  /**
   * Load annotate video from a URL (e.g., from game storage)
   */
  const loadAnnotateVideoFromUrl = useCallback(async (url, gameId = null) => {
    setIsUploadingGameVideo(true);
    setAnnotateVideoUrl(url);
    setAnnotateGameId(gameId);
    setAnnotateVideoFile(null); // Clear file when loading from URL

    try {
      const metadata = await extractVideoMetadataFromUrl(url);
      setAnnotateVideoMetadata(metadata);
      return metadata;
    } catch (error) {
      console.error('[useAnnotateState] Error extracting metadata:', error);
      throw error;
    } finally {
      setIsUploadingGameVideo(false);
    }
  }, []);

  /**
   * Load annotate video from a file upload
   */
  const loadAnnotateVideoFromFile = useCallback(async (file) => {
    setIsUploadingGameVideo(true);
    setAnnotateVideoFile(file);
    setAnnotateGameId(null); // New file means no game ID yet

    const url = URL.createObjectURL(file);
    setAnnotateVideoUrl(url);

    try {
      const metadata = await extractVideoMetadataFromUrl(url);
      setAnnotateVideoMetadata(metadata);
      return metadata;
    } catch (error) {
      console.error('[useAnnotateState] Error extracting metadata:', error);
      // Clean up URL on error
      URL.revokeObjectURL(url);
      setAnnotateVideoUrl(null);
      throw error;
    } finally {
      setIsUploadingGameVideo(false);
    }
  }, []);

  /**
   * Clear all annotate state
   */
  const resetAnnotateState = useCallback(() => {
    // Revoke object URL if it was created from a file
    if (annotateVideoUrl && annotateVideoFile) {
      URL.revokeObjectURL(annotateVideoUrl);
    }

    setAnnotateVideoFile(null);
    setAnnotateVideoUrl(null);
    setAnnotateVideoMetadata(null);
    setAnnotateGameId(null);
    setAnnotateGameName(null);
    setAnnotateSourceExpired(false);
    setIsCreatingAnnotatedVideo(false);
    setIsImportingToProjects(false);
    setIsUploadingGameVideo(false);
    setUploadProgress(null);
    setAnnotatePlaybackSpeed(DEFAULT_PLAYBACK_SPEED);
    setAnnotateFullscreen(false);
    setAnnotateSelectedLayer(DEFAULT_SELECTED_LAYER);
    setNewClipLayerIsMine(true);
    setLayerFilter(DEFAULT_LAYER_FILTER);
    setActiveSourceSequence(null);
  }, [annotateVideoUrl, annotateVideoFile]);

  /**
   * Check if annotate has a video loaded
   */
  const hasAnnotateVideo = Boolean(annotateVideoUrl);

  /**
   * Check if annotate is associated with a saved game
   */
  const isAssociatedWithGame = Boolean(annotateGameId);

  /**
   * Check if any export/import operation is in progress
   */
  const isExportingOrImporting = isCreatingAnnotatedVideo || isImportingToProjects;

  /**
   * Toggle fullscreen mode
   */
  const toggleFullscreen = useCallback(() => {
    setAnnotateFullscreen(prev => !prev);
  }, []);

  /**
   * Cycle through playback speeds
   */
  const cyclePlaybackSpeed = useCallback(() => {
    setAnnotatePlaybackSpeed(prev => {
      const speeds = [0.5, 1, 1.5, 2];
      const currentIndex = speeds.indexOf(prev);
      const nextIndex = (currentIndex + 1) % speeds.length;
      return speeds[nextIndex];
    });
  }, []);

  return {
    // Video state
    annotateVideoFile,
    annotateVideoUrl,
    annotateVideoMetadata,
    annotateGameId,
    hasAnnotateVideo,
    isAssociatedWithGame,

    // Video state setters (for external use like game loading)
    setAnnotateVideoFile,
    setAnnotateVideoUrl,
    setAnnotateVideoMetadata,
    setAnnotateGameId,
    annotateGameName,
    setAnnotateGameName,

    // bug 27p: source-video expiry (graceful degradation)
    annotateSourceExpired,
    setAnnotateSourceExpired,

    // Loading states
    isCreatingAnnotatedVideo,
    setIsCreatingAnnotatedVideo,
    isImportingToProjects,
    setIsImportingToProjects,
    isUploadingGameVideo,
    setIsUploadingGameVideo,
    uploadProgress,
    setUploadProgress,
    isExportingOrImporting,

    // Playback settings
    annotatePlaybackSpeed,
    setAnnotatePlaybackSpeed,
    annotateFullscreen,
    setAnnotateFullscreen,
    toggleFullscreen,
    cyclePlaybackSpeed,

    // UI state
    annotateSelectedLayer,
    setAnnotateSelectedLayer,

    // T5700: layer mode toggle (new-clip default) + clip-list layer filter
    newClipLayerIsMine,
    setNewClipLayerIsMine,
    layerFilter,
    setLayerFilter,

    // T8890: active camera angle (view state, null = backbone / main camera)
    activeSourceSequence,
    setActiveSourceSequence,

    // Refs
    annotateContainerRef,
    annotateFileInputRef,

    // Actions
    loadAnnotateVideoFromUrl,
    loadAnnotateVideoFromFile,
    resetAnnotateState,
  };
}
