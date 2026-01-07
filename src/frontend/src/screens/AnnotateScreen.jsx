import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AnnotateModeView } from '../modes';
import { ClipsSidePanel } from '../modes/annotate';
import { AnnotateContainer } from '../containers';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import { FileUpload } from '../components/FileUpload';

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
 * - Keyboard shortcuts for annotate mode
 *
 * Props from App.jsx are minimal:
 * - initialFile - file selected before navigating to annotate
 * - initialGameId - game ID to load (when loading saved game)
 * - onOpenProjectCreationSettings - callback to open settings modal
 *
 * @see tasks/PHASE2-ARCHITECTURE-PLAN.md for architecture context
 */
export function AnnotateScreen({
  // Navigation
  onNavigate,
  onBackToProjects,

  // Settings modal
  onOpenProjectCreationSettings,

  // Downloads
  downloadsCount,
  onOpenDownloads,

  // Initial file from ProjectManager (if user selected file before navigating)
  initialFile,
  onInitialFileHandled,

  // Initial game ID (when loading a saved game from ProjectManager)
  initialGameId,
  onInitialGameHandled,

  // Game management hooks (passed from App for now)
  createGame,
  uploadGameVideo,
  getGame,
  getGameVideoUrl,
  saveAnnotationsDebounced,

  // Project hooks
  fetchProjects,
  projectCreationSettings,

  // Export state from store
  exportProgress,
}) {
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

  // AnnotateContainer - encapsulates all annotate mode state and handlers
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
    projectCreationSettings,
    onBackToProjects,
    setEditorMode: onNavigate, // Use onNavigate for mode changes (e.g., Import Into Projects)
    onOpenProjectCreationSettings,
    downloadsCount,
    onOpenDownloads,
  });

  const {
    annotateVideoUrl,
    annotateVideoMetadata,
    annotateFullscreen,
    showAnnotateOverlay,
    annotateSelectedLayer,
    annotatePlaybackSpeed,
    annotateContainerRef,
    annotateFileInputRef,
    isCreatingAnnotatedVideo,
    isImportingToProjects,
    isUploadingGameVideo,
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
    handleImportIntoProjects,
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

  // Handle initial file from ProjectManager (if user selected file before navigating)
  useEffect(() => {
    if (initialFile && !annotateVideoUrl) {
      // Note: handleGameVideoSelect is async, but we don't need to await it
      // The state updates will trigger re-renders as they complete
      handleGameVideoSelect(initialFile);
      // Clear the pending file immediately to prevent re-triggering
      onInitialFileHandled?.();
    }
  }, [initialFile]); // Minimal deps to avoid re-triggering

  // Handle initial game ID from ProjectManager (when loading a saved game)
  useEffect(() => {
    if (initialGameId && !annotateVideoUrl) {
      console.log('[AnnotateScreen] Loading game from initialGameId:', initialGameId);
      handleLoadGame(initialGameId);
      // Clear the pending game ID immediately to prevent re-triggering
      onInitialGameHandled?.();
    }
  }, [initialGameId]); // Minimal deps to avoid re-triggering

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

  // Cleanup on unmount - use ref to avoid running on every re-render
  // This ref captures clearAnnotateState so we don't need it in deps
  const clearStateRef = useRef(clearAnnotateState);
  clearStateRef.current = clearAnnotateState;

  useEffect(() => {
    // Empty deps = only runs cleanup on actual unmount
    return () => {
      console.log('[AnnotateScreen] Unmounting - clearing state');
      clearStateRef.current();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show file upload when no video is loaded
  if (!annotateVideoUrl) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <FileUpload
          onGameVideoSelect={handleGameVideoSelect}
          isLoading={isUploadingGameVideo}
        />
      </div>
    );
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
              <button
                onClick={onBackToProjects}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                ← Projects
              </button>
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">Annotate Game</h1>
                <p className="text-gray-400">Mark clips to extract from your game footage</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={onOpenDownloads}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Gallery {downloadsCount > 0 && `(${downloadsCount})`}
              </button>
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
        // Export state
        exportProgress={exportProgress}
        isCreatingAnnotatedVideo={isCreatingAnnotatedVideo}
        isImportingToProjects={isImportingToProjects}
        isUploadingGameVideo={isUploadingGameVideo}
        // Export handlers
        onCreateAnnotatedVideo={handleCreateAnnotatedVideo}
        onImportIntoProjects={handleImportIntoProjects}
        onOpenProjectCreationSettings={onOpenProjectCreationSettings}
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
