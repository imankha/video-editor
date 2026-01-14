import { useMemo, useRef, useCallback } from 'react';
import { FolderOpen } from 'lucide-react';
import { DownloadsPanel } from './components/DownloadsPanel';
import { GalleryButton } from './components/GalleryButton';
import { useProjects } from './hooks/useProjects';
import { Button, ConfirmationDialog, ModeSwitcher } from './components/shared';
import DebugInfo from './components/DebugInfo';
// Screen components (self-contained, own their hooks)
import { FramingScreen, OverlayScreen, AnnotateScreen, ProjectsScreen } from './screens';
import { AppStateProvider, ProjectProvider } from './contexts';
import { useEditorStore, useExportStore, useFramingStore, useOverlayStore } from './stores';

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

  // Project management
  const {
    selectedProject,
    selectedProjectId,
    fetchProjects,
    selectProject,
    clearSelection,
    discardUncommittedChanges
  } = useProjects();

  // Export button ref (for triggering export programmatically from mode switch dialog)
  const exportButtonRef = useRef(null);

  // Export completion callback - used by Screen components to refresh data
  const handleExportComplete = useCallback(() => {
    fetchProjects();
    // Downloads count is auto-refreshed by DownloadsPanel via galleryStore
  }, [fetchProjects]);

  // Handler for loading saved games from ProjectManager
  // Sets pendingGameId in sessionStorage and navigates to annotate mode
  const handleLoadGame = useCallback((gameId) => {
    console.log('[App] Loading game - setting pendingGameId in sessionStorage:', gameId);
    sessionStorage.setItem('pendingGameId', gameId.toString());
    setEditorMode('annotate');
  }, [setEditorMode]);

  // Computed state for UI
  const hasOverlayVideo = !!workingVideo?.url;

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
  }), [
    editorMode,
    setEditorMode,
    selectedProjectId,
    selectedProject,
    exportingProject,
    setExportingProject,
    globalExportProgress,
    setGlobalExportProgress,
  ]);

  // If no project selected and not in annotate mode, show ProjectsScreen
  if (!selectedProject && editorMode !== 'annotate') {
    return (
      <ProjectsScreen
          onStateReset={clearSelection}
          onLoadGame={handleLoadGame}
          onProjectSelected={selectProject}
        />
    );
  }

  return (
    <ProjectProvider>
    <AppStateProvider value={appStateValue}>
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex">
      {/* Annotate mode: AnnotateScreen handles its own sidebar + main content */}
      {editorMode === 'annotate' && <AnnotateScreen />}

      {/* Main Content - For framing/overlay modes */}
      {editorMode !== 'annotate' && (
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              {/* Back to Projects button */}
              <Button
                variant="secondary"
                icon={FolderOpen}
                onClick={() => {
                  clearSelection();
                  fetchProjects();
                  setEditorMode('project-manager');
                }}
              >
                Projects
              </Button>
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">
                  Reel Ballers
                </h1>
                <p className="text-gray-400">
                  Showcase your player's brilliance
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <GalleryButton />
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
        onOpenProject={(projectId) => {
          selectProject(projectId);
          setEditorMode('overlay');
        }}
        onOpenGame={handleLoadGame}
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
