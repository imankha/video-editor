import { useState, useEffect, useCallback, useRef } from 'react';
import { FolderOpen } from 'lucide-react';
import { AnnotateModeView } from '../modes';
import { ClipsSidePanel } from '../modes/annotate';
import { AnnotateContainer } from '../containers';
import { GalleryButton } from '../components/GalleryButton';
import { Button } from '../components/shared';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import { useGames } from '../hooks/useGames';
import { useProjects } from '../hooks/useProjects';
import { useEditorStore } from '../stores/editorStore';
import { getPendingGameFile, clearPendingGameFile } from './ProjectsScreen';

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
export function AnnotateScreen() {
  // Editor mode (for navigation between screens)
  // NOTE: Using editorStore (not navigationStore) because App.jsx renders based on editorStore
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // Games - OWNED BY THIS SCREEN
  const {
    createGame,
    uploadGameVideo,
    getGame,
    getGameVideoUrl,
    saveAnnotationsDebounced,
  } = useGames();

  // Projects (for import/export)
  const { fetchProjects } = useProjects();

  // Track if we're loading a game (ref persists across re-renders without causing them)
  const isLoadingRef = useRef(false);

  // Check on mount if we're loading a game or file, set loading flag to prevent redirect
  useState(() => {
    if (sessionStorage.getItem('pendingGameId') || getPendingGameFile()) {
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
  } = useZoom();

  // Handlers
  const handleBackToProjects = useCallback(() => {
    setEditorMode('project-manager');
  }, [setEditorMode]);

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
    createGame,
    uploadGameVideo,
    getGame,
    getGameVideoUrl,
    saveAnnotationsDebounced,
    fetchProjects,
    onBackToProjects: handleBackToProjects,
    setEditorMode,
  });

  const {
    annotateVideoUrl,
    annotateVideoMetadata,
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
  } = annotate;

  // Handle initial game ID from sessionStorage (when loading a saved game)
  useEffect(() => {
    const pendingGameId = sessionStorage.getItem('pendingGameId');
    console.log('[AnnotateScreen] Game load effect - pendingGameId:', pendingGameId, 'videoUrl:', annotateVideoUrl, 'isLoading:', isLoadingRef.current);
    if (pendingGameId && !annotateVideoUrl) {
      console.log('[AnnotateScreen] Loading game from pendingGameId:', pendingGameId);
      isLoadingRef.current = true;
      sessionStorage.removeItem('pendingGameId');
      handleLoadGame(parseInt(pendingGameId));
    }
  }, [handleLoadGame, annotateVideoUrl]);

  // Handle pending game file from ProjectsScreen (when "Add Game" was clicked)
  useEffect(() => {
    const pendingFile = getPendingGameFile();
    console.log('[AnnotateScreen] Pending file effect - file:', pendingFile?.name, 'videoUrl:', annotateVideoUrl, 'isLoading:', isLoadingRef.current);
    if (pendingFile && !annotateVideoUrl) {
      console.log('[AnnotateScreen] Loading pending game file:', pendingFile.name);
      isLoadingRef.current = true;
      clearPendingGameFile();
      handleGameVideoSelect(pendingFile);
    }
  }, [handleGameVideoSelect, annotateVideoUrl]);

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
        if (clipRegions.length > 0) {
          const sortedRegions = [...clipRegions].sort((a, b) => a.startTime - b.startTime);

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
    annotateSelectedRegionId,
    selectAnnotateRegion,
    togglePlay,
    stepForward,
    stepBackward,
    seek,
  ]);

  // NOTE: We intentionally do NOT clear state on unmount.
  // React 18 StrictMode causes double-mount in development, and clearing
  // state on the first unmount breaks the component.
  // State is cleared explicitly when needed:
  // - After importing clips to projects (in handleImportIntoProjects)
  // - When loading a new game (state is reset before loading new data)

  // Redirect to projects if no video and not loading
  useEffect(() => {
    console.log('[AnnotateScreen] Redirect check - videoUrl:', !!annotateVideoUrl, 'isLoading:', isLoadingRef.current, 'isUploading:', isUploadingGameVideo);
    if (!annotateVideoUrl && !isLoadingRef.current && !isUploadingGameVideo) {
      console.log('[AnnotateScreen] No video and not loading, redirecting to projects');
      setEditorMode('projects');
    }
  }, [annotateVideoUrl, isUploadingGameVideo, setEditorMode]);

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
        clipRegions={clipRegions}
        selectedRegionId={annotateSelectedRegionId}
        onSelectRegion={handleSelectAnnotateRegion}
        onUpdateRegion={updateClipRegion}
        onDeleteRegion={deleteClipRegion}
        onImportAnnotations={importAnnotations}
        maxNotesLength={ANNOTATE_MAX_NOTES_LENGTH}
        clipCount={annotateClipCount}
        videoDuration={annotateVideoMetadata?.duration}
        isLoading={isLoadingAnnotations}
      />
      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <Button
                variant="secondary"
                icon={FolderOpen}
                onClick={handleBackToProjects}
              >
                Projects
              </Button>
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">Annotate Game</h1>
                <p className="text-gray-400">Mark clips to extract from your game footage</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <GalleryButton />
            </div>
          </div>
          <AnnotateModeView
        // Video state
        videoRef={videoRef}
        annotateVideoUrl={annotateVideoUrl}
        annotateVideoMetadata={annotateVideoMetadata}
        annotateContainerRef={annotateContainerRef}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
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
        annotateRegionsWithLayout={annotateRegionsWithLayout}
        annotateSelectedRegionId={annotateSelectedRegionId}
        hasAnnotateClips={hasAnnotateClips}
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
          />
        </div>
      </div>
    </>
  );
}

export default AnnotateScreen;
