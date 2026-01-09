import { useState, useMemo, useRef, useCallback } from 'react';
import { Image } from 'lucide-react';
import { DownloadsPanel } from './components/DownloadsPanel';
import { useDownloads } from './hooks/useDownloads';
import { useProjects } from './hooks/useProjects';
import { ConfirmationDialog, ModeSwitcher } from './components/shared';
import DebugInfo from './components/DebugInfo';
// Screen components (self-contained, own their hooks)
import { FramingScreen, OverlayScreen, AnnotateScreen, ProjectsScreen } from './screens';
import { AppStateProvider, ProjectProvider } from './contexts';
import { useEditorStore, useExportStore, useFramingStore, useOverlayStore, useProjectDataStore } from './stores';

/**
 * App.jsx - Main application shell
 *
 * This component handles:
 * - Editor mode switching (framing, overlay, annotate, project-manager)
 * - Project selection coordination
 * - Mode switch confirmation dialogs
 * - Global UI (header, downloads panel)
 * - Routing to appropriate screen components
 *
 * Screen-specific logic is now in:
 * - FramingScreen - all framing hooks, clip management, video playback
 * - OverlayScreen - all overlay hooks, highlight regions, video playback
 * - AnnotateScreen - all annotate hooks, game management
 * - ProjectsScreen - project listing, game listing
 */
function App() {
  // Editor mode state from Zustand store
  const {
    editorMode,
    setEditorMode,
    modeSwitchDialog,
    openModeSwitchDialog,
    closeModeSwitchDialog,
  } = useEditorStore();

  // Export state from Zustand store
  const {
    exportingProject,
    startExport,
    clearExport,
    globalExportProgress,
    setGlobalExportProgress,
  } = useExportStore();

  // Framing store - for detecting uncommitted changes in mode switch
  const framingChangedSinceExport = useFramingStore(state => state.framingChangedSinceExport);

  // Overlay store - for checking if working video exists
  const workingVideo = useOverlayStore(state => state.workingVideo);
  const isLoadingWorkingVideo = useOverlayStore(state => state.isLoadingWorkingVideo);

  // Project data store - for checking loaded clips
  const loadedClips = useProjectDataStore(state => state.clips);

  // Project management
  const {
    selectedProject,
    selectedProjectId,
    hasProjects,
    fetchProjects,
    selectProject,
    clearSelection,
    refreshSelectedProject,
    discardUncommittedChanges
  } = useProjects();

  // Pending file for annotate mode (set by ProjectsScreen when user clicks Add Game)
  const [pendingAnnotateFile, setPendingAnnotateFile] = useState(null);

  // Downloads panel state
  const [isDownloadsPanelOpen, setIsDownloadsPanelOpen] = useState(false);
  const { count: downloadsCount, fetchCount: refreshDownloadsCount } = useDownloads();

  // Export button ref (for triggering export programmatically from mode switch dialog)
  const exportButtonRef = useRef(null);

  // Export completion callback - used by Screen components to refresh data
  const handleExportComplete = useCallback(() => {
    fetchProjects();
    refreshDownloadsCount();
  }, [fetchProjects, refreshDownloadsCount]);

  // Handler for loading saved games from ProjectManager
  // Sets pendingGameId in sessionStorage and navigates to annotate mode
  const handleLoadGame = useCallback((gameId) => {
    console.log('[App] Loading game - setting pendingGameId in sessionStorage:', gameId);
    sessionStorage.setItem('pendingGameId', gameId.toString());
    setEditorMode('annotate');
  }, [setEditorMode]);

  // Handler for when user selects a file for annotate mode (from ProjectsScreen Add Game button)
  const handleAnnotateWithFile = useCallback((file) => {
    console.log('[App] Annotate with file:', file.name);
    setPendingAnnotateFile(file);
    setEditorMode('annotate');
  }, [setEditorMode]);

  // Integration callbacks for ProjectsScreen
  const handleProjectStateReset = useCallback(() => {
    console.log('[App] Resetting state for new project');
    // Project data store will be reset by FramingScreen on mount
    clearSelection();
  }, [clearSelection]);

  const handleProjectClipsLoaded = useCallback(async ({ projectAspectRatio }) => {
    console.log('[App] Clips loaded callback - aspect ratio:', projectAspectRatio);
    // Clip loading is now handled by FramingScreen
  }, []);

  const handleProjectWorkingVideoLoaded = useCallback(async ({ file, url, metadata, clipMetadata }) => {
    console.log('[App] Working video loaded callback');
    // Working video is now managed by OverlayScreen via overlayStore
  }, []);

  // Computed state for UI
  const hasOverlayVideo = !!workingVideo?.url;
  const hasClips = loadedClips && loadedClips.length > 0;

  // Handle mode change between Framing and Overlay
  const handleModeChange = useCallback((newMode) => {
    if (newMode === editorMode) return;

    console.log(`[App] Switching from ${editorMode} to ${newMode} mode`);

    // Check if switching from framing to overlay with uncommitted changes
    if (editorMode === 'framing' && newMode === 'overlay' && hasOverlayVideo && framingChangedSinceExport) {
      console.log('[App] Uncommitted framing changes detected - showing confirmation dialog');
      openModeSwitchDialog('overlay');
      return;
    }

    setEditorMode(newMode);
  }, [editorMode, hasOverlayVideo, framingChangedSinceExport, openModeSwitchDialog, setEditorMode]);

  // Mode switch dialog handlers
  const handleModeSwitchCancel = useCallback(() => {
    closeModeSwitchDialog();
  }, [closeModeSwitchDialog]);

  const handleModeSwitchExport = useCallback(() => {
    closeModeSwitchDialog();
    console.log('[App] User chose to export first - triggering export');
    if (exportButtonRef.current?.triggerExport) {
      exportButtonRef.current.triggerExport();
    }
  }, [closeModeSwitchDialog]);

  const handleModeSwitchDiscard = useCallback(async () => {
    if (selectedProjectId) {
      try {
        console.log('[App] Discarding framing changes');
        await discardUncommittedChanges(selectedProjectId);
        closeModeSwitchDialog();
        setEditorMode('overlay');
      } catch (err) {
        console.error('[App] Failed to discard changes:', err);
        closeModeSwitchDialog();
      }
    } else {
      closeModeSwitchDialog();
    }
  }, [selectedProjectId, discardUncommittedChanges, closeModeSwitchDialog, setEditorMode]);

  // Backward-compatible wrapper for setExportingProject
  const setExportingProject = useCallback((value) => {
    if (value === null) {
      clearExport();
    } else {
      startExport(value.projectId, value.stage, value.exportId);
    }
  }, [clearExport, startExport]);

  // App-level shared state for context
  const appStateValue = useMemo(() => ({
    editorMode,
    setEditorMode,
    selectedProjectId,
    selectedProject,
    exportingProject,
    setExportingProject,
    globalExportProgress,
    setGlobalExportProgress,
    downloadsCount,
    refreshDownloadsCount,
  }), [
    editorMode,
    setEditorMode,
    selectedProjectId,
    selectedProject,
    exportingProject,
    setExportingProject,
    globalExportProgress,
    setGlobalExportProgress,
    downloadsCount,
    refreshDownloadsCount,
  ]);

  // If no project selected and not in annotate mode, show ProjectsScreen
  if (!selectedProject && editorMode !== 'annotate') {
    return (
      <ProjectsScreen
        onClipsLoaded={handleProjectClipsLoaded}
        onWorkingVideoLoaded={handleProjectWorkingVideoLoaded}
        onStateReset={handleProjectStateReset}
        onLoadGame={handleLoadGame}
        onProjectSelected={selectProject}
        onAnnotateWithFile={handleAnnotateWithFile}
      />
    );
  }

  return (
    <ProjectProvider>
    <AppStateProvider value={appStateValue}>
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex">
      {/* Annotate mode: AnnotateScreen handles its own sidebar + main content */}
      {editorMode === 'annotate' && (
        <AnnotateScreen
          initialFile={pendingAnnotateFile}
          onInitialFileConsumed={() => setPendingAnnotateFile(null)}
        />
      )}

      {/* Main Content - For framing/overlay modes */}
      {editorMode !== 'annotate' && (
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              {/* Back to Projects button */}
              <button
                onClick={() => {
                  clearSelection();
                  fetchProjects();
                  setEditorMode('project-manager');
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                ← Projects
              </button>
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">
                  Player Showcase
                </h1>
                <p className="text-gray-400">
                  Showcase your player's brilliance
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Gallery button */}
              <button
                onClick={() => setIsDownloadsPanelOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 rounded-lg transition-colors"
                title="Gallery"
              >
                <Image size={18} className="text-purple-400" />
                <span className="text-sm text-gray-400">Gallery</span>
                {downloadsCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
                    {downloadsCount > 9 ? '9+' : downloadsCount}
                  </span>
                )}
              </button>
              {/* Mode toggle */}
              <ModeSwitcher
                mode={editorMode}
                onModeChange={handleModeChange}
                disabled={false}
                hasOverlayVideo={hasOverlayVideo}
                framingOutOfSync={framingChangedSinceExport && hasOverlayVideo}
                hasAnnotateVideo={false}
                isLoadingWorkingVideo={isLoadingWorkingVideo}
              />
            </div>
          </div>

          {/* Mode-specific views */}
          {editorMode === 'framing' && (
            <FramingScreen
              onExportComplete={handleExportComplete}
              exportButtonRef={exportButtonRef}
            />
          )}

          {editorMode === 'overlay' && (
            <OverlayScreen
              onExportComplete={handleExportComplete}
            />
          )}

        </div>
      </div>
      )}

      {/* Debug Info */}
      <DebugInfo />

      {/* Downloads Panel */}
      <DownloadsPanel
        isOpen={isDownloadsPanelOpen}
        onClose={() => setIsDownloadsPanelOpen(false)}
        onOpenProject={(projectId) => {
          selectProject(projectId);
          setEditorMode('overlay');
          setIsDownloadsPanelOpen(false);
        }}
        onCountChange={refreshDownloadsCount}
      />

      {/* Mode Switch Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={modeSwitchDialog.isOpen}
        title="Uncommitted Framing Changes"
        message="You have made framing edits that haven't been exported yet. The current working video doesn't reflect these changes. What would you like to do?"
        onClose={handleModeSwitchCancel}
        buttons={[
          {
            label: 'Cancel',
            onClick: handleModeSwitchCancel,
            variant: 'secondary'
          },
          {
            label: 'Discard Changes',
            onClick: handleModeSwitchDiscard,
            variant: 'danger'
          },
          {
            label: 'Export First',
            onClick: handleModeSwitchExport,
            variant: 'primary'
          }
        ]}
      />
    </div>
    </AppStateProvider>
    </ProjectProvider>
  );
}

export default App;
