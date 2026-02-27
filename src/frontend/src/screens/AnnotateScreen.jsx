import { useState, useEffect, useCallback, useRef } from 'react';
import { Home, Scissors } from 'lucide-react';
import { AnnotateModeView } from '../modes';
import { ClipsSidePanel } from '../modes/annotate';
import { AnnotateContainer } from '../containers';
import { GalleryButton } from '../components/GalleryButton';
import { Breadcrumb, Button } from '../components/shared';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import { useEditorStore } from '../stores/editorStore';
import { useUploadStore } from '../stores/uploadStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProjectsStore } from '../stores/projectsStore';
import { getPendingGameFile, getPendingGameDetails, clearPendingGameFile } from './ProjectsScreen';

/**
 * AnnotateScreen - Self-contained screen for Annotate mode
 *
 * This component is the SINGLE SOURCE OF TRUTH for all annotate state.
 * App.jsx does NOT call AnnotateContainer - only this screen does.
 *
 * This component owns all annotate-specific hooks and state:
 * - AnnotateContainer - all annotate logic and state
 * - useVideo - video playback
 * - useZoom - video zoom/pan
 * - useGames - game management
 * - useSettings - project creation settings
 * - useGalleryStore - downloads count and panel state
 * - Keyboard shortcuts for annotate mode
 *
 * Data flow:
 * - Initial game ID: sessionStorage (from ProjectsScreen game load)
 * - File selection: Via ProjectsScreen "Add Game" flow
 *
 * @see AppJSX_REDUCTION/TASK-05-finalize-annotate-screen.md
 */
export function AnnotateScreen({ onClearSelection }) {
  // Editor mode (for navigation between screens)
  // NOTE: Using editorStore (not navigationStore) because App.jsx renders based on editorStore
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // Games — Zustand store (reactive to profile switches)
  const uploadGameVideo = useGamesDataStore(state => state.uploadGameVideo);
  const getGame = useGamesDataStore(state => state.getGame);
  const getGameVideoUrl = useGamesDataStore(state => state.getGameVideoUrl);
  const finishAnnotation = useGamesDataStore(state => state.finishAnnotation);

  // Projects — Zustand store
  const fetchProjects = useProjectsStore(state => state.fetchProjects);

  // Track if we're loading a game (ref persists across re-renders without causing them)
  const isLoadingRef = useRef(false);
  // Track pending seek time for navigation from Framing mode
  const [pendingSeekTime, setPendingSeekTime] = useState(null);

  // Get active upload from store (for restoring annotation after navigating back from Games)
  const activeUpload = useUploadStore(state => state.activeUpload);

  // Check on mount if we're loading a game or file or have an active upload, set loading flag to prevent redirect
  useState(() => {
    const pendingDetails = getPendingGameDetails();
    const hasMultiVideo = pendingDetails?.files?.length > 0;
    if (sessionStorage.getItem('pendingGameId') || getPendingGameFile() || hasMultiVideo || useUploadStore.getState().activeUpload?.blobUrl) {
      isLoadingRef.current = true;
    }
  });

  // Video hook - without segment awareness for annotate mode
  // IMPORTANT: We use the videoRef from this hook (not from App.jsx props)
  // This ensures seek/play/pause work correctly with the video element
  const {
    videoRef,
    currentTime,
    duration,
    isPlaying,
    isLoading: isVideoLoading,
    isVideoElementLoading,
    loadingProgress,
    loadingElapsedSeconds,
    error: videoError,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,
    handlers,
  } = useVideo(null, null);

  // Zoom hook
  const {
    zoom,
    panOffset,
    zoomByWheel,
    updatePan,
    zoomIn,
    zoomOut,
    resetZoom,
    MIN_ZOOM,
    MAX_ZOOM,
  } = useZoom();

  // Ref to store gameId for use in handleBackToProjects (avoids circular dependency)
  const gameIdRef = useRef(null);

  // Handlers
  const handleBackToProjects = useCallback(() => {
    // Trigger extraction of any unextracted clips in projects before leaving
    if (gameIdRef.current) {
      finishAnnotation(gameIdRef.current);
    }
    onClearSelection?.();  // Clear App.jsx's selected project (from Framing → Annotate navigation)
    setEditorMode('project-manager');
  }, [finishAnnotation, onClearSelection, setEditorMode]);

  // AnnotateContainer - encapsulates all annotate mode state and handlers
  // NOTE: Clips are now saved in real-time during annotation, no batch import needed
  const annotate = AnnotateContainer({
    videoRef,
    currentTime,
    duration,
    isPlaying,
    togglePlay,
    stepForward,
    stepBackward,
    restart,
    seek,
    uploadGameVideo, // T80: Unified upload with deduplication
    getGame,
    getGameVideoUrl,
    fetchProjects,
    onBackToProjects: handleBackToProjects,
    setEditorMode,
  });

  const {
    annotateVideoUrl,
    annotateVideoMetadata,
    annotateGameName,
    annotateGameId,
    annotateFullscreen,
    showAnnotateOverlay,
    annotateSelectedLayer,
    annotatePlaybackSpeed,
    annotateContainerRef,
    isCreatingAnnotatedVideo,
    isUploadingGameVideo,
    uploadProgress,
    hasAnnotateClips,
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
    handleSelectRegion: handleSelectAnnotateRegion,
    setAnnotatePlaybackSpeed,
    setAnnotateSelectedLayer,
    // Clip region actions
    updateClipRegion,
    deleteClipRegion,
    importAnnotations,
    getAnnotateRegionAtTime,
    getAnnotateExportData,
    selectAnnotateRegion,
    // Cleanup
    clearAnnotateState,
    // T82: Multi-video
    gameVideos,
    activeVideoIndex,
    isMultiVideo,
    handleVideoTabSwitch,
    filteredClipRegions,
    filteredRegionsWithLayout,
  } = annotate;

  // Keep gameIdRef updated for handleBackToProjects
  useEffect(() => {
    gameIdRef.current = annotateGameId;
  }, [annotateGameId]);

  // Handle initial game ID from sessionStorage (when loading a saved game or navigating from Framing)
  useEffect(() => {
    const pendingGameId = sessionStorage.getItem('pendingGameId');
    const pendingClipSeekTime = sessionStorage.getItem('pendingClipSeekTime');
    console.log('[AnnotateScreen] Game load effect - pendingGameId:', pendingGameId, 'pendingClipSeekTime:', pendingClipSeekTime, 'videoUrl:', annotateVideoUrl, 'isLoading:', isLoadingRef.current);
    if (pendingGameId && !annotateVideoUrl) {
      console.log('[AnnotateScreen] Loading game from pendingGameId:', pendingGameId);
      isLoadingRef.current = true;
      sessionStorage.removeItem('pendingGameId');
      sessionStorage.removeItem('pendingClipSeekTime');

      // If there's a pending seek time (from Framing navigation), queue it
      if (pendingClipSeekTime) {
        setPendingSeekTime(parseFloat(pendingClipSeekTime));
      }

      handleLoadGame(parseInt(pendingGameId));
    }
  }, [handleLoadGame, annotateVideoUrl]);

  // Handle pending game file from ProjectsScreen (when "Add Game" was clicked)
  // Supports both single-video (file) and multi-video (files array in details)
  useEffect(() => {
    const pendingFile = getPendingGameFile();
    const pendingDetails = getPendingGameDetails();
    const hasMultiVideo = pendingDetails?.files?.length > 0;
    if ((pendingFile || hasMultiVideo) && !annotateVideoUrl) {
      isLoadingRef.current = true;
      clearPendingGameFile();
      // For multi-video, pendingFile is null - handleGameVideoSelect reads files from details
      handleGameVideoSelect(pendingFile, pendingDetails);
    }
  }, [handleGameVideoSelect, annotateVideoUrl]);

  // Handle pending seek time after video loads (from Framing mode navigation)
  // Use videoRef.current.currentTime directly to avoid infinite loop from seek() triggering re-renders
  useEffect(() => {
    if (pendingSeekTime != null && annotateVideoUrl && videoRef.current) {
      console.log('[AnnotateScreen] Seeking to pending time:', pendingSeekTime);
      videoRef.current.currentTime = pendingSeekTime;
      setPendingSeekTime(null);
    }
  }, [pendingSeekTime, annotateVideoUrl]);

  // Keyboard shortcuts for annotate mode
  // These are handled here (not in App.jsx) to use the same state instance
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle if typing in an input or textarea
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      // Space bar: Toggle play/pause
      if (event.code === 'Space' && annotateVideoUrl) {
        event.preventDefault();
        togglePlay();
        return;
      }

      // 'A' key: Add clip (opens overlay) - works in both normal and fullscreen mode
      if ((event.key === 'a' || event.key === 'A') && annotateVideoUrl && !showAnnotateOverlay) {
        event.preventDefault();
        handleAddClipFromButton();
        return;
      }

      // Arrow keys: Navigate playhead or clips
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        if (!annotateVideoUrl) return;
        // Don't handle if modifier keys are pressed
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        event.preventDefault();
        const isLeft = event.code === 'ArrowLeft';

        // Playhead layer: step frames
        if (annotateSelectedLayer === 'playhead') {
          if (isLeft) {
            stepBackward();
          } else {
            stepForward();
          }
          return;
        }

        // Clips layer: navigate between annotated clips
        const activeClips = isMultiVideo ? filteredClipRegions : clipRegions;
        if (activeClips.length > 0) {
          const sortedRegions = [...activeClips].sort((a, b) => a.startTime - b.startTime);

          let currentIndex = sortedRegions.findIndex(r => r.id === annotateSelectedRegionId);
          if (currentIndex === -1) {
            currentIndex = isLeft ? sortedRegions.length : -1;
          }

          const targetIndex = isLeft
            ? Math.max(0, currentIndex - 1)
            : Math.min(sortedRegions.length - 1, currentIndex + 1);

          if (targetIndex !== currentIndex || currentIndex === -1) {
            const targetRegion = sortedRegions[targetIndex];
            selectAnnotateRegion?.(targetRegion.id);
            seek(targetRegion.startTime);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    annotateVideoUrl,
    annotateSelectedLayer,
    clipRegions,
    filteredClipRegions,
    isMultiVideo,
    annotateSelectedRegionId,
    selectAnnotateRegion,
    togglePlay,
    stepForward,
    stepBackward,
    seek,
    showAnnotateOverlay,
    handleAddClipFromButton,
  ]);

  // NOTE: We intentionally do NOT clear state on unmount.
  // React 18 StrictMode causes double-mount in development, and clearing
  // state on the first unmount breaks the component.
  // State is cleared explicitly when needed:
  // - After importing clips to projects (in handleImportIntoProjects)
  // - When loading a new game (state is reset before loading new data)

  // Redirect to projects if no video and not loading and no active upload to restore
  useEffect(() => {
    const hasActiveUploadToRestore = activeUpload?.blobUrl;
    if (!annotateVideoUrl && !isLoadingRef.current && !isUploadingGameVideo && !hasActiveUploadToRestore) {
      setEditorMode('projects');
    }
  }, [annotateVideoUrl, isUploadingGameVideo, setEditorMode, activeUpload]);

  // If no video loaded but we're loading, render nothing (loading is fast)
  if (!annotateVideoUrl) {
    return null;
  }

  // Clear loading flag once video is ready
  if (isLoadingRef.current) {
    isLoadingRef.current = false;
  }

  return (
    <>
      {/* Sidebar - Clips list and TSV import */}
      <ClipsSidePanel
        clipRegions={isMultiVideo ? filteredClipRegions : clipRegions}
        selectedRegionId={annotateSelectedRegionId}
        onSelectRegion={handleSelectAnnotateRegion}
        onUpdateRegion={updateClipRegion}
        onDeleteRegion={deleteClipRegion}
        onImportAnnotations={importAnnotations}
        maxNotesLength={ANNOTATE_MAX_NOTES_LENGTH}
        clipCount={isMultiVideo ? filteredClipRegions.length : annotateClipCount}
        videoDuration={annotateVideoMetadata?.duration}
        isLoading={isLoadingAnnotations}
        isVideoUploading={isUploadingGameVideo}
      />
      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                icon={Home}
                iconOnly
                onClick={handleBackToProjects}
                title="Home"
              />
              <Breadcrumb
                type="Games"
                itemName={annotateGameName}
              />
            </div>
            <div className="flex items-center gap-4">
              <GalleryButton />
              {/* Annotate mode indicator */}
              <div className="flex items-center gap-2 px-4 py-2 bg-green-600/20 border border-green-600/40 rounded-lg">
                <Scissors size={16} className="text-green-400" />
                <span className="text-sm font-medium text-green-400">Annotate</span>
              </div>
            </div>
          </div>
          {/* T82: Video switcher tabs for multi-video games */}
          {isMultiVideo && gameVideos && (
            <div className="flex gap-2 mb-4">
              {gameVideos.map((video, index) => {
                const label = gameVideos.length === 2
                  ? (index === 0 ? 'First Half' : 'Second Half')
                  : `Part ${index + 1}`;
                const isActive = index === activeVideoIndex;
                return (
                  <button
                    key={video.sequence}
                    onClick={() => handleVideoTabSwitch(index)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          <AnnotateModeView
        // Video state
        videoRef={videoRef}
        annotateVideoUrl={annotateVideoUrl}
        annotateVideoMetadata={annotateVideoMetadata}
        annotateContainerRef={annotateContainerRef}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        isLoading={isVideoLoading || isUploadingGameVideo}
        isVideoElementLoading={isVideoElementLoading}
        loadingProgress={loadingProgress}
        loadingElapsedSeconds={loadingElapsedSeconds}
        error={videoError}
        handlers={handlers}
        // Fullscreen state
        annotateFullscreen={annotateFullscreen}
        showAnnotateOverlay={showAnnotateOverlay}
        // Playback
        togglePlay={togglePlay}
        stepForward={stepForward}
        stepBackward={stepBackward}
        restart={restart}
        seek={seek}
        annotatePlaybackSpeed={annotatePlaybackSpeed}
        onSpeedChange={setAnnotatePlaybackSpeed}
        // Clips/regions
        annotateRegionsWithLayout={isMultiVideo ? filteredRegionsWithLayout : annotateRegionsWithLayout}
        annotateSelectedRegionId={annotateSelectedRegionId}
        hasAnnotateClips={isMultiVideo ? filteredClipRegions.length > 0 : hasAnnotateClips}
        // Handlers
        onSelectRegion={handleSelectAnnotateRegion}
        onDeleteRegion={deleteClipRegion}
        onToggleFullscreen={handleToggleFullscreen}
        onAddClip={handleAddClipFromButton}
        getAnnotateRegionAtTime={getAnnotateRegionAtTime}
        getAnnotateExportData={getAnnotateExportData}
        // Fullscreen overlay handlers
        onFullscreenCreateClip={handleFullscreenCreateClip}
        onFullscreenUpdateClip={handleFullscreenUpdateClip}
        onOverlayResume={handleOverlayResume}
        onOverlayClose={handleOverlayClose}
        // Layer selection
        annotateSelectedLayer={annotateSelectedLayer}
        onLayerSelect={setAnnotateSelectedLayer}
        // Export state (exportProgress is read from store in AnnotateModeView)
        isCreatingAnnotatedVideo={isCreatingAnnotatedVideo}
        isUploadingGameVideo={isUploadingGameVideo}
        uploadProgress={uploadProgress}
        // Export handlers
        onCreateAnnotatedVideo={handleCreateAnnotatedVideo}
        // Zoom (for video player)
        zoom={zoom}
        panOffset={panOffset}
        onZoomChange={zoomByWheel}
        onPanChange={updatePan}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
        MIN_ZOOM={MIN_ZOOM}
        MAX_ZOOM={MAX_ZOOM}
          />
        </div>
      </div>
    </>
  );
}

export default AnnotateScreen;
