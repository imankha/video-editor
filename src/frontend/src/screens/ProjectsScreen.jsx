import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ProjectManager } from '../components/ProjectManager';
import { DownloadsPanel } from '../components/DownloadsPanel';
import { useGameUpload } from '../hooks/useGameUpload';
import { useProjectLoader } from '../hooks/useProjectLoader';
import { useNavigationStore } from '../stores/navigationStore';
import { useEditorStore } from '../stores/editorStore';
import { useExportStore } from '../stores/exportStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useProjectsStore } from '../stores/projectsStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useUploadStore } from '../stores/uploadStore';
import { AppStateProvider } from '../contexts';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import extractionWebSocketManager from '../services/ExtractionWebSocketManager';

// Module-level variable to pass File object and game details to AnnotateScreen
// (File objects can't be serialized to sessionStorage)
let pendingGameData = null;

export function getPendingGameFile() {
  // For multi-video (per_half), files array is set instead of file
  return pendingGameData?.file || null;
}

export function getPendingGameDetails() {
  if (!pendingGameData) return null;
  return {
    opponentName: pendingGameData.opponentName,
    gameDate: pendingGameData.gameDate,
    gameType: pendingGameData.gameType,
    tournamentName: pendingGameData.tournamentName,
    videoMode: pendingGameData.videoMode || undefined,
    files: pendingGameData.files || undefined,
  };
}

export function clearPendingGameFile() {
  pendingGameData = null;
}

/**
 * ProjectsScreen - Self-contained screen for Project Manager
 *
 * This component owns all project/game management and loading:
 * - useProjects - project CRUD operations
 * - useGames - game CRUD operations
 * - useProjectLoader - project loading with clips and working video
 * - useGalleryStore - downloads count
 *
 * Props:
 * - onStateReset - called before loading new project (App.jsx clears selection)
 * - onLoadGame - callback to navigate to annotate mode with game ID
 * - onProjectSelected - callback to sync selectedProject with App.jsx
 *
 * @see AppJSX_REDUCTION/TASK-02-self-contained-projects-screen.md
 */
export function ProjectsScreen({
  onStateReset, // Called before loading new project
  onLoadGame: onLoadGameProp, // Callback to set pendingGameId in App.jsx
  onProjectSelected, // Callback to sync selectedProject with App.jsx's useProjects
}) {
  const navigate = useNavigationStore(state => state.navigate);
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // Project management — Zustand store (reactive to profile switches)
  const projects = useProjectsStore(state => state.projects);
  const projectsLoading = useProjectsStore(state => state.loading);
  const projectsError = useProjectsStore(state => state.error);
  const fetchProjects = useProjectsStore(state => state.fetchProjects);
  const selectProject = useProjectsStore(state => state.selectProject);
  const createProject = useProjectsStore(state => state.createProject);
  const deleteProject = useProjectsStore(state => state.deleteProject);

  // Games management — Zustand store (reactive to profile switches)
  const games = useGamesDataStore(state => state.games);
  const gamesLoading = useGamesDataStore(state => state.isLoading);
  const gamesError = useGamesDataStore(state => state.error);
  const fetchGames = useGamesDataStore(state => state.fetchGames);
  const deleteGame = useGamesDataStore(state => state.deleteGame);

  // Upload management hook (for pending uploads list)
  const {
    pendingUploads,
    fetchPendingUploads,
  } = useGameUpload();

  // Active upload from uploadStore (in-progress upload that persists across navigation)
  const activeUpload = useUploadStore(state => state.activeUpload);

  // Project loading
  const { loadProject } = useProjectLoader();

  // Gallery store for downloads panel
  const openGallery = useGalleryStore(state => state.open);
  const downloadsCount = useGalleryStore(state => state.count);

  // Local UI state
  const [loadingProjectId, setLoadingProjectId] = useState(null);

  // Export store for global export state (uses new activeExports system)
  // Note: useExportRecovery in App.jsx handles syncing with server on startup
  // This component only reads from the store - single source of truth
  const activeExports = useExportStore(state => state.activeExports);
  const getProcessingExports = useExportStore(state => state.getProcessingExports);

  // Fetch projects and games on mount (first load — profile switches
  // are handled by _resetDataStores which calls fetchProjects/fetchGames)
  useEffect(() => {
    fetchProjects();
    fetchGames();
  }, [fetchProjects, fetchGames]);

  // Listen for export completion events and refresh project list
  useEffect(() => {
    const unsubComplete = exportWebSocketManager.addEventListener('*', 'complete', (data, exportId) => {
      fetchProjects();
    });

    const unsubError = exportWebSocketManager.addEventListener('*', 'error', (data, exportId) => {
      fetchProjects();
    });

    return () => {
      unsubComplete();
      unsubError();
    };
  }, [fetchProjects]);

  // Fetch pending uploads on mount
  useEffect(() => {
    fetchPendingUploads();
  }, [fetchPendingUploads]);

  // Listen for extraction events and refresh project list (real-time status updates)
  useEffect(() => {
    extractionWebSocketManager.connect();

    const unsubComplete = extractionWebSocketManager.addEventListener('extraction_complete', () => {
      fetchProjects();
    });

    const unsubFailed = extractionWebSocketManager.addEventListener('extraction_failed', () => {
      fetchProjects();
    });

    return () => {
      unsubComplete();
      unsubFailed();
    };
  }, [fetchProjects]);

  // Handle project selection
  const handleSelectProject = useCallback(async (projectId) => {
    console.log('[ProjectsScreen] Selecting project:', projectId);
    setLoadingProjectId(projectId);

    try {
      // Clear App.jsx state before loading new project
      if (onStateReset) {
        onStateReset();
      }

      // Fetch project details
      const project = await selectProject(projectId);

      // Sync selectedProject with App.jsx's useProjects instance
      if (onProjectSelected) {
        await onProjectSelected(projectId);
      }

      // Load project with all associated data
      const result = await loadProject(project);

      // Sync with editorStore for legacy compatibility
      setEditorMode(result.mode);

      console.log('[ProjectsScreen] Project loaded:', result);
    } catch (err) {
      console.error('[ProjectsScreen] Failed to select project:', err);
    } finally {
      setLoadingProjectId(null);
    }
  }, [selectProject, loadProject, setEditorMode, onStateReset, onProjectSelected]);

  // Handle project selection with mode override
  const handleSelectProjectWithMode = useCallback(async (projectId, options = {}) => {
    console.log('[ProjectsScreen] Selecting project with mode:', projectId, options);
    setLoadingProjectId(projectId);

    try {
      // Clear App.jsx state before loading new project
      if (onStateReset) {
        onStateReset();
      }

      // Fetch project details
      const project = await selectProject(projectId);

      // Sync selectedProject with App.jsx's useProjects instance
      if (onProjectSelected) {
        await onProjectSelected(projectId);
      }

      // Load project with all associated data
      const result = await loadProject(project, {
        mode: options.mode,
        clipIndex: options.clipIndex,
      });

      // Sync with editorStore for legacy compatibility
      setEditorMode(result.mode);

      console.log('[ProjectsScreen] Project loaded with mode:', result);
    } catch (err) {
      console.error('[ProjectsScreen] Failed to select project:', err);
    } finally {
      setLoadingProjectId(null);
    }
  }, [selectProject, loadProject, setEditorMode, onStateReset, onProjectSelected]);

  // Handle game loading (navigate to annotate)
  const handleLoadGame = useCallback((gameId) => {
    console.log('[ProjectsScreen] Loading game:', gameId);
    // Call App.jsx callback to set pendingGameId state
    if (onLoadGameProp) {
      onLoadGameProp(gameId);
    }
  }, [onLoadGameProp]);

  // Handle annotate with file and game details (navigate to annotate mode with pre-selected data)
  // The data is stored in module-level variable and picked up by AnnotateScreen
  const handleAnnotateWithFile = useCallback((gameData) => {
    pendingGameData = gameData;
    setEditorMode('annotate');
  }, [setEditorMode]);

  // Ref to prevent multiple resume triggers
  const isResumingRef = useRef(false);

  // Handle resuming a pending upload
  // Navigate to Annotate mode with the file - same flow as new upload
  // The backend handles resume detection: same hash = resume, different hash = new upload
  const handleResumeUpload = useCallback((file, expectedFilename) => {
    // Prevent multiple triggers (double-click, re-render, etc.)
    if (isResumingRef.current) {
      console.log('[ProjectsScreen] Resume already in progress, ignoring');
      return;
    }
    isResumingRef.current = true;

    console.log('[ProjectsScreen] Resuming upload, navigating to Annotate:', file.name);

    // Warn if filename doesn't match (quick check, not hash)
    if (expectedFilename && file.name !== expectedFilename) {
      const proceed = window.confirm(
        `The selected file "${file.name}" has a different name than the original "${expectedFilename}".\n\n` +
        `If this is the same video file (just renamed), click OK to continue.\n` +
        `If this is a different file, click Cancel and select the correct file.`
      );
      if (!proceed) {
        isResumingRef.current = false;
        return;
      }
    }

    // Navigate to Annotate mode with the file - same as new upload flow
    // AnnotateScreen will handle the upload and show progress
    pendingGameData = { file };
    setEditorMode('annotate');

    // Reset after a short delay to allow navigation to complete
    setTimeout(() => {
      isResumingRef.current = false;
    }, 1000);
  }, [setEditorMode]);

  // Handle cancelling a pending upload
  const handleCancelPendingUpload = useCallback(async (sessionId) => {
    console.log('[ProjectsScreen] Cancelling upload:', sessionId);
    try {
      const { cancelUpload } = await import('../services/uploadManager');
      await cancelUpload(sessionId);
      await fetchPendingUploads();
    } catch (err) {
      console.error('[ProjectsScreen] Cancel upload failed:', err);
    }
  }, [fetchPendingUploads]);

  // Handle clicking the active upload - navigate back to annotate mode
  const handleClickActiveUpload = useCallback(() => {
    console.log('[ProjectsScreen] Clicking active upload, navigating to annotate');
    setEditorMode('annotate');
  }, [setEditorMode]);

  // Compute exporting project from the global activeExports store
  // Find first actively processing export to display in the UI
  const activeExportingProject = (() => {
    const processingExports = Object.values(activeExports).filter(
      exp => exp.status === 'pending' || exp.status === 'processing'
    );
    if (processingExports.length === 0) return null;

    // Return the most recent one
    const mostRecent = processingExports.sort(
      (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
    )[0];

    return {
      projectId: mostRecent.projectId,
      stage: mostRecent.type,
      exportId: mostRecent.exportId,
      progress: mostRecent.progress
    };
  })();

  // App state for context (for components that need it)
  const appStateValue = {
    editorMode: 'project-manager',
    selectedProjectId: null,
    selectedProject: null,
    exportingProject: activeExportingProject,
    downloadsCount,
  };

  return (
    <AppStateProvider value={appStateValue}>
      <div className="min-h-screen bg-gray-900">
        <ProjectManager
          projects={projects}
          loading={projectsLoading || loadingProjectId !== null}
          error={projectsError}
          loadingProjectId={loadingProjectId}
          onSelectProject={handleSelectProject}
          onSelectProjectWithMode={handleSelectProjectWithMode}
          onCreateProject={createProject}
          onRefreshProjects={fetchProjects}
          onDeleteProject={deleteProject}
          onAnnotateWithFile={handleAnnotateWithFile}
          // Games props
          games={games}
          gamesLoading={gamesLoading}
          gamesError={gamesError}
          onLoadGame={handleLoadGame}
          onDeleteGame={deleteGame}
          onFetchGames={fetchGames}
          onOpenDownloads={openGallery}
          // Pending uploads props
          pendingUploads={pendingUploads}
          onResumeUpload={handleResumeUpload}
          onCancelPendingUpload={handleCancelPendingUpload}
          // Active upload props (in-progress upload)
          activeUpload={activeUpload}
          onClickActiveUpload={handleClickActiveUpload}
        />

        {/* Downloads Panel */}
        <DownloadsPanel
          onOpenProject={(projectId) => {
            handleSelectProjectWithMode(projectId, { mode: 'overlay' });
          }}
          onOpenGame={handleLoadGame}
        />
      </div>
    </AppStateProvider>
  );
}

export default ProjectsScreen;
