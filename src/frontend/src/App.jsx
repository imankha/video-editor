import { useMemo, useRef, useCallback, useEffect } from 'react';
import { Home, Scissors } from 'lucide-react';
import { Logo } from './components/Logo';
import { warmAllUserVideos, setWarmupPriority, WARMUP_PRIORITY } from './utils/cacheWarming';
import { ConnectionStatus } from './components/ConnectionStatus';
import { DownloadsPanel } from './components/DownloadsPanel';
import { GalleryButton } from './components/GalleryButton';
import { GlobalExportIndicator } from './components/GlobalExportIndicator';
import { UploadProgressIndicator } from './components/UploadProgressIndicator';
import { useProjects } from './hooks/useProjects';
import { useExportRecovery } from './hooks/useExportRecovery';
import { Breadcrumb, Button, ConfirmationDialog, ModeSwitcher, ToastContainer } from './components/shared';
import DebugInfo from './components/DebugInfo';
import { getProjectDisplayName } from './utils/clipDisplayName';
// Screen components (self-contained, own their hooks)
import { FramingScreen, OverlayScreen, AnnotateScreen, ProjectsScreen } from './screens';
import { AppStateProvider, ProjectProvider } from './contexts';
import { useEditorStore, useExportStore, useFramingStore, useOverlayStore, useProjectDataStore, EDITOR_MODES } from './stores';

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

  // Working video from project data store (canonical owner)
  const workingVideo = useProjectDataStore(state => state.workingVideo);

  // Overlay store - for loading state and tracking changes
  const isLoadingWorkingVideo = useOverlayStore(state => state.isLoadingWorkingVideo);
  const overlayChangedSinceExport = useOverlayStore(state => state.overlayChangedSinceExport);

  // Clip data for "Edit in Annotate" button - single source of truth from projectDataStore
  const selectedClipId = useProjectDataStore(state => state.selectedClipId);
  const clips = useProjectDataStore(state => state.clips);

  // Derive selected clip - memoized to avoid recalculation
  const selectedClipForAnnotate = useMemo(() => {
    if (selectedClipId && clips.length > 0) {
      const clip = clips.find(c => c.id === selectedClipId);
      if (clip) return clip;
    }
    // Fall back to first clip if nothing selected
    return clips?.[0] ?? null;
  }, [selectedClipId, clips]);

  // Project management
  const {
    selectedProject,
    selectedProjectId,
    fetchProjects,
    selectProject,
    clearSelection,
    discardUncommittedChanges
  } = useProjects();

  // Export recovery - reconnects to active exports on app startup
  useExportRecovery();

  // Pre-warm R2 cache for all user videos on app init
  // TODO(T200): Move this to post-login hook when User Management is implemented
  useEffect(() => {
    warmAllUserVideos();
  }, []);

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
    setWarmupPriority(WARMUP_PRIORITY.GAMES); // Prioritize game video warming
    sessionStorage.setItem('pendingGameId', gameId.toString());
    setEditorMode(EDITOR_MODES.ANNOTATE);
  }, [setEditorMode]);

  // Computed state for UI
  const hasOverlayVideo = !!workingVideo?.url;

  // Handler for "Edit in Annotate" button - navigates to Annotate mode with clip's game
  const handleEditInAnnotate = useCallback(() => {
    // Check both possible field names (clipStore uses gameId, projectDataStore uses game_id)
    const gameId = selectedClipForAnnotate?.gameId || selectedClipForAnnotate?.game_id;
    if (!gameId) return;

    setWarmupPriority(WARMUP_PRIORITY.GAMES); // Prioritize game video warming

    // Store navigation intent for AnnotateScreen to pick up
    sessionStorage.setItem('pendingGameId', gameId.toString());
    const startTime = selectedClipForAnnotate?.annotateStartTime ?? selectedClipForAnnotate?.start_time;
    if (startTime != null) {
      sessionStorage.setItem('pendingClipSeekTime', startTime.toString());
    }

    // Switch to annotate mode
    setEditorMode(EDITOR_MODES.ANNOTATE);
  }, [selectedClipForAnnotate, setEditorMode]);

  // Check if we can edit in annotate (clip has game association)
  const canEditInAnnotate = !!(selectedClipForAnnotate?.gameId || selectedClipForAnnotate?.game_id);

  // Handle mode change between Framing, Overlay, and Project Manager
  const handleModeChange = useCallback((newMode) => {
    if (newMode === editorMode) return;

    console.log(`[App] Switching from ${editorMode} to ${newMode} mode`);

    // Check if leaving framing with uncommitted changes
    // Only show confirmation when there's a working video that would be invalidated
    // With gesture-based sync, framing data is auto-saved, so we only need to warn about
    // re-exporting if there's an existing working video
    if (editorMode === EDITOR_MODES.FRAMING && framingChangedSinceExport && hasOverlayVideo) {
      console.log('[App] Framing changes would invalidate working video - showing confirmation dialog');
      openModeSwitchDialog(newMode, EDITOR_MODES.FRAMING);
      return;
    }

    // Check if leaving overlay with uncommitted changes (and project has final video)
    if (editorMode === EDITOR_MODES.OVERLAY && overlayChangedSinceExport && selectedProject?.has_final_video) {
      console.log('[App] Uncommitted overlay changes detected - showing confirmation dialog');
      openModeSwitchDialog(newMode, EDITOR_MODES.OVERLAY);
      return;
    }

    // For project-manager, also clear selection and refresh projects
    if (newMode === EDITOR_MODES.PROJECT_MANAGER) {
      clearSelection();
      fetchProjects();
    }

    setEditorMode(newMode);
  }, [editorMode, hasOverlayVideo, framingChangedSinceExport, overlayChangedSinceExport, selectedProject?.has_final_video, openModeSwitchDialog, setEditorMode, clearSelection, fetchProjects]);

  // Mode switch dialog handlers
  const handleModeSwitchCancel = useCallback(() => {
    closeModeSwitchDialog();
  }, [closeModeSwitchDialog]);

  const handleModeSwitchExport = useCallback(() => {
    const sourceMode = modeSwitchDialog.sourceMode;
    closeModeSwitchDialog();
    console.log('[App] User chose to export first - triggering export');
    if (exportButtonRef.current?.triggerExport) {
      exportButtonRef.current.triggerExport();
    }
    // Clear the "changed" flag since we triggered an export - user shouldn't be prompted again
    if (sourceMode === EDITOR_MODES.FRAMING) {
      useFramingStore.getState().setFramingChangedSinceExport(false);
    } else if (sourceMode === EDITOR_MODES.OVERLAY) {
      useOverlayStore.getState().setOverlayChangedSinceExport(false);
    }
  }, [closeModeSwitchDialog, modeSwitchDialog.sourceMode]);

  const handleModeSwitchDiscard = useCallback(async () => {
    const targetMode = modeSwitchDialog.pendingMode;
    const sourceMode = modeSwitchDialog.sourceMode;

    // Handle discard based on source mode
    if (sourceMode === EDITOR_MODES.OVERLAY) {
      // For overlay, just reset the changed flag (changes are auto-saved to backend)
      console.log('[App] Discarding overlay changes (resetting flag)');
      useOverlayStore.getState().setOverlayChangedSinceExport(false);
    } else if (selectedProjectId) {
      // For framing, call the backend to discard uncommitted changes
      try {
        console.log('[App] Discarding framing changes');
        await discardUncommittedChanges(selectedProjectId);
      } catch (err) {
        console.error('[App] Failed to discard framing changes:', err);
      }
    }

    closeModeSwitchDialog();

    // Handle project-manager specific cleanup
    if (targetMode === EDITOR_MODES.PROJECT_MANAGER) {
      clearSelection();
      fetchProjects();
    }

    setEditorMode(targetMode || EDITOR_MODES.PROJECT_MANAGER);
  }, [selectedProjectId, discardUncommittedChanges, closeModeSwitchDialog, setEditorMode, modeSwitchDialog.pendingMode, modeSwitchDialog.sourceMode, clearSelection, fetchProjects]);

  // Backward-compatible wrapper for setExportingProject
  const setExportingProject = useCallback((value) => {
    if (value === null) {
      clearExport();
    } else {
      // Note: startExport expects (exportId, projectId, type)
      startExport(value.exportId, value.projectId, value.stage);
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
  if (!selectedProject && editorMode !== EDITOR_MODES.ANNOTATE) {
    return (
      <>
        <ProjectsScreen
            onStateReset={clearSelection}
            onLoadGame={handleLoadGame}
            onProjectSelected={selectProject}
          />
        {/* Global Export Indicator - shows progress on ProjectsScreen too */}
        <GlobalExportIndicator />
        {/* Upload Progress Indicator - shows upload progress on all screens */}
        <UploadProgressIndicator />
      </>
    );
  }

  return (
    <ProjectProvider>
    <AppStateProvider value={appStateValue}>
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex">
      {/* Connection status banner - shows when backend is unreachable */}
      <ConnectionStatus />
      {/* Annotate mode: AnnotateScreen handles its own sidebar + main content */}
      {editorMode === EDITOR_MODES.ANNOTATE && <AnnotateScreen onClearSelection={clearSelection} />}

      {/* Main Content - For framing/overlay modes */}
      {editorMode !== EDITOR_MODES.ANNOTATE && (
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              {/* Logo */}
              <Logo size={32} />
              {/* Back to Home button */}
              <Button
                variant="ghost"
                icon={Home}
                iconOnly
                onClick={() => handleModeChange(EDITOR_MODES.PROJECT_MANAGER)}
                title="Home"
              />
              <Breadcrumb
                type="Projects"
                itemName={getProjectDisplayName(selectedProject)}
              />
            </div>
            <div className="flex items-center gap-2">
              <GalleryButton />
              {/* Combined mode switcher with Annotate button */}
              <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
                {/* Edit in Annotate button - styled like mode tabs */}
                {canEditInAnnotate && (
                  <button
                    onClick={handleEditInAnnotate}
                    className="flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200 text-gray-400 hover:text-white hover:bg-white/10"
                    title="Edit source clip in Annotate mode"
                  >
                    <Scissors size={16} />
                    <span className="font-medium text-sm">Annotate</span>
                  </button>
                )}
                {/* Framing/Overlay mode toggle - rendered inline */}
                <ModeSwitcher
                  mode={editorMode}
                  onModeChange={handleModeChange}
                  disabled={false}
                  hasOverlayVideo={hasOverlayVideo}
                  framingOutOfSync={framingChangedSinceExport && hasOverlayVideo}
                  hasAnnotateVideo={false}
                  isLoadingWorkingVideo={isLoadingWorkingVideo}
                  inline={true}
                />
              </div>
            </div>
          </div>

          {/* Mode-specific views */}
          {editorMode === EDITOR_MODES.FRAMING && (
            <FramingScreen
              onExportComplete={handleExportComplete}
              exportButtonRef={exportButtonRef}
            />
          )}

          {editorMode === EDITOR_MODES.OVERLAY && (
            <OverlayScreen
              onExportComplete={handleExportComplete}
              exportButtonRef={exportButtonRef}
            />
          )}

        </div>
      </div>
      )}

      {/* Debug Info */}
      <DebugInfo />

      {/* Global Export Indicator - shows progress across all screens */}
      <GlobalExportIndicator />

      {/* Upload Progress Indicator - shows upload progress on all screens */}
      <UploadProgressIndicator />

      {/* Downloads Panel */}
      <DownloadsPanel
        onOpenProject={(projectId) => {
          // Only re-fetch project if it's not already selected
          if (projectId !== selectedProjectId) {
            selectProject(projectId);
          }
          // Always switch to overlay mode (handles case where user is in annotate)
          setEditorMode(EDITOR_MODES.OVERLAY);
        }}
        onOpenGame={handleLoadGame}
      />

      {/* Mode Switch Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={modeSwitchDialog.isOpen}
        title={modeSwitchDialog.sourceMode === 'overlay' ? 'Uncommitted Overlay Changes' : 'Uncommitted Framing Changes'}
        message={modeSwitchDialog.sourceMode === 'overlay'
          ? 'You have overlay edits that haven\'t been exported yet.\n\n• Export: Create a new final video (GPU processing), then switch modes\n• Discard: Throw away changes and switch modes\n• X: Cancel and stay in overlay mode'
          : 'You have framing edits that haven\'t been exported yet.\n\n• Export: Re-export clip (GPU processing), then switch modes. This will reset any overlay work.\n• Discard: Throw away changes and switch modes\n• X: Cancel and stay in framing mode'
        }
        onClose={handleModeSwitchCancel}
        buttons={[
          {
            label: 'Discard',
            onClick: handleModeSwitchDiscard,
            variant: 'danger'
          },
          {
            label: 'Export',
            onClick: handleModeSwitchExport,
            variant: 'primary'
          }
        ]}
      />

      {/* Toast Notifications */}
      <ToastContainer />
    </div>
    </AppStateProvider>
    </ProjectProvider>
  );
}

export default App;
