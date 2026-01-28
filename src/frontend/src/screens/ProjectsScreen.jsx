import { useState, useCallback, useEffect } from 'react';
import { ProjectManager } from '../components/ProjectManager';
import { DownloadsPanel } from '../components/DownloadsPanel';
import { useProjects } from '../hooks/useProjects';
import { useGames } from '../hooks/useGames';
import { useProjectLoader } from '../hooks/useProjectLoader';
import { useNavigationStore } from '../stores/navigationStore';
import { useEditorStore } from '../stores/editorStore';
import { useExportStore } from '../stores/exportStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useGamesStore } from '../stores/gamesStore';
import { AppStateProvider } from '../contexts';
import exportWebSocketManager from '../services/ExportWebSocketManager';

// Module-level variable to pass File object and game details to AnnotateScreen
// (File objects can't be serialized to sessionStorage)
let pendingGameData = null;

export function getPendingGameFile() {
  return pendingGameData?.file || null;
}

export function getPendingGameDetails() {
  return pendingGameData ? {
    opponentName: pendingGameData.opponentName,
    gameDate: pendingGameData.gameDate,
    gameType: pendingGameData.gameType,
    tournamentName: pendingGameData.tournamentName,
  } : null;
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

  // Project management hooks
  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
    fetchProjects,
    selectProject,
    createProject,
    deleteProject,
  } = useProjects();

  // Games management hook
  const {
    games,
    isLoading: gamesLoading,
    error: gamesError,
    fetchGames,
    deleteGame,
  } = useGames();

  // Watch for games version changes from other components (e.g., AnnotateContainer)
  const gamesVersion = useGamesStore(state => state.gamesVersion);

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

  // Listen for export completion events and refresh project list
  useEffect(() => {
    const unsubComplete = exportWebSocketManager.addEventListener('*', 'complete', (data, exportId) => {
      console.log('[ProjectsScreen] Export completed, refreshing projects:', exportId);
      fetchProjects();
    });

    const unsubError = exportWebSocketManager.addEventListener('*', 'error', (data, exportId) => {
      console.log('[ProjectsScreen] Export failed, refreshing projects:', exportId);
      fetchProjects();
    });

    return () => {
      unsubComplete();
      unsubError();
    };
  }, [fetchProjects]);

  // Refetch games when gamesVersion changes (triggered by other components)
  useEffect(() => {
    if (gamesVersion > 0) {
      console.log('[ProjectsScreen] Games version changed, refetching games list');
      fetchGames();
    }
  }, [gamesVersion, fetchGames]);

  // Listen for extraction completion events via WebSocket
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/extractions`;
    let ws = null;
    let reconnectTimeout = null;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[ProjectsScreen] Connected to extraction WebSocket');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[ProjectsScreen] Extraction event:', data);
          if (data.type === 'extraction_complete' || data.type === 'extraction_failed') {
            // Refresh projects to get updated extraction status
            fetchProjects();
          }
        } catch (e) {
          // Ignore non-JSON messages (like pong)
        }
      };

      ws.onclose = () => {
        console.log('[ProjectsScreen] Extraction WebSocket closed, reconnecting in 5s');
        reconnectTimeout = setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        console.warn('[ProjectsScreen] Extraction WebSocket error:', err);
      };
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
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
