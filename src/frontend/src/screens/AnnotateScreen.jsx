import { useState, useEffect, useMemo, useCallback } from 'react';
import { AnnotateModeView } from '../modes';
import { ClipsSidePanel } from '../modes/annotate';
import { AnnotateContainer } from '../containers';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import { useGames } from '../hooks/useGames';
import { useProjects } from '../hooks/useProjects';
import { useSettings } from '../hooks/useSettings';
import { useDownloads } from '../hooks/useDownloads';
import { FileUpload } from '../components/FileUpload';
import { useEditorStore } from '../stores/editorStore';

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
 * - useDownloads - downloads count
 * - Keyboard shortcuts for annotate mode
 *
 * Data flow:
 * - Initial game ID: sessionStorage (from ProjectsScreen game load)
 * - File selection: Internal FileUpload component (no props from App.jsx)
 *
 * @see AppJSX_REDUCTION/TASK-05-finalize-annotate-screen.md
 */
export function AnnotateScreen({ initialFile, onInitialFileConsumed }) {
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

  // Settings
  const {
    projectCreationSettings,
    updateProjectCreationSettings,
    resetSettings,
  } = useSettings();

  // Downloads
  const { count: downloadsCount, fetchCount: refreshDownloadsCount } = useDownloads();

  // Local UI state
  const [showProjectCreationSettings, setShowProjectCreationSettings] = useState(false);

  // Initial game ID from sessionStorage (when loading saved game from ProjectManager)
  const [initialGameId, setInitialGameId] = useState(null);

  // Check for pending game ID on mount
  useEffect(() => {
    const pendingGameId = sessionStorage.getItem('pendingGameId');
    if (pendingGameId) {
      console.log('[AnnotateScreen] Found pendingGameId in sessionStorage:', pendingGameId);
      sessionStorage.removeItem('pendingGameId');
      setInitialGameId(parseInt(pendingGameId));
    }
  }, []);

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

  const handleOpenDownloads = useCallback(() => {
    // Navigate to project-manager and open downloads panel
    // For now, we'll use session storage to signal downloads should open
    sessionStorage.setItem('openDownloadsPanel', 'true');
    setEditorMode('project-manager');
  }, [setEditorMode]);

  const handleOpenProjectCreationSettings = useCallback(() => {
    setShowProjectCreationSettings(true);
  }, []);

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
    onBackToProjects: handleBackToProjects,
    setEditorMode,
    onOpenProjectCreationSettings: handleOpenProjectCreationSettings,
    downloadsCount,
    onOpenDownloads: handleOpenDownloads,
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

  // Note: File selection is now handled entirely by this screen's FileUpload component
  // No more initialFile prop from App.jsx (File objects can't be serialized to sessionStorage)

  // Handle initial game ID from sessionStorage (when loading a saved game)
  useEffect(() => {
    if (initialGameId && !annotateVideoUrl) {
      console.log('[AnnotateScreen] Loading game from initialGameId:', initialGameId);
      handleLoadGame(initialGameId);
      // Clear the initial game ID immediately to prevent re-triggering
      setInitialGameId(null);
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

  // NOTE: We intentionally do NOT clear state on unmount.
  // React 18 StrictMode causes double-mount in development, and clearing
  // state on the first unmount breaks the component.
  // State is cleared explicitly when needed:
  // - After importing clips to projects (in handleImportIntoProjects)
  // - When loading a new game (state is reset before loading new data)

  // Handle initialFile from ProjectsScreen (when user clicks Add Game and selects a file)
  useEffect(() => {
    if (initialFile && !annotateVideoUrl) {
      console.log('[AnnotateScreen] Processing initial file:', initialFile.name);
      handleGameVideoSelect(initialFile);
      // Clear the pending file so it's not re-processed
      if (onInitialFileConsumed) {
        onInitialFileConsumed();
      }
    }
  }, [initialFile]); // Minimal deps to avoid re-triggering

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
                onClick={handleBackToProjects}
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
                onClick={handleOpenDownloads}
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
        // Export state (exportProgress is read from store in AnnotateModeView)
        isCreatingAnnotatedVideo={isCreatingAnnotatedVideo}
        isImportingToProjects={isImportingToProjects}
        isUploadingGameVideo={isUploadingGameVideo}
        // Export handlers
        onCreateAnnotatedVideo={handleCreateAnnotatedVideo}
        onImportIntoProjects={handleImportIntoProjects}
        onOpenProjectCreationSettings={handleOpenProjectCreationSettings}
        // Zoom (for video player)
        zoom={zoom}
        panOffset={panOffset}
        onZoomChange={zoomByWheel}
        onPanChange={updatePan}
          />
        </div>
      </div>

      {/* Project Creation Settings Modal - owned by this screen */}
      {showProjectCreationSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-white mb-4">Project Creation Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Aspect Ratio</label>
                <select
                  value={projectCreationSettings?.aspectRatio || '9:16'}
                  onChange={(e) => updateProjectCreationSettings({ aspectRatio: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded"
                >
                  <option value="9:16">9:16 (Portrait)</option>
                  <option value="16:9">16:9 (Landscape)</option>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="4:5">4:5 (Instagram)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={resetSettings}
                className="px-4 py-2 text-gray-400 hover:text-white"
              >
                Reset
              </button>
              <button
                onClick={() => setShowProjectCreationSettings(false)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AnnotateScreen;
