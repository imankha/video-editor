import { useState, useCallback, useRef, useEffect } from 'react';
import { ProjectManager } from '../components/ProjectManager';
import { DownloadsPanel } from '../components/DownloadsPanel';
import { useProjects } from '../hooks/useProjects';
import { useGames } from '../hooks/useGames';
import { useDownloads } from '../hooks/useDownloads';
import { useProjectLoader } from '../hooks/useProjectLoader';
import { useNavigationStore } from '../stores/navigationStore';
import { useEditorStore } from '../stores/editorStore';
import { useExportStore } from '../stores/exportStore';
import { AppStateProvider } from '../contexts';
import { API_BASE } from '../config';

/**
 * ProjectsScreen - Self-contained screen for Project Manager
 *
 * This component owns all project/game management and loading:
 * - useProjects - project CRUD operations
 * - useGames - game CRUD operations
 * - useProjectLoader - project loading with clips and working video
 * - useDownloads - downloads count
 *
 * Integration callbacks (for legacy App.jsx integration during transition):
 * - onClipsLoaded - called when clips are loaded (App.jsx needs to update its state)
 * - onWorkingVideoLoaded - called when working video is loaded
 * - onStateReset - called before loading new project (App.jsx clears its state)
 *
 * @see AppJSX_REDUCTION/TASK-02-self-contained-projects-screen.md
 */
export function ProjectsScreen({
  // Legacy integration callbacks (will be removed in Task 07)
  onClipsLoaded,
  onWorkingVideoLoaded,
  onStateReset,
  onLoadGame: onLoadGameProp, // Callback to set pendingGameId in App.jsx
  onProjectSelected, // Callback to sync selectedProject with App.jsx's useProjects
  onAnnotateWithFile, // Callback when user selects a file for annotate mode
  // Settings
  onOpenProjectCreationSettings,
}) {
  const navigate = useNavigationStore(state => state.navigate);
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // Project management hooks
  const {
    projects,
    loading: projectsLoading,
    selectProject,
    createProject,
    deleteProject,
  } = useProjects();

  // Games management hook
  const {
    games,
    isLoading: gamesLoading,
    fetchGames,
    deleteGame,
  } = useGames();

  // Downloads
  const { count: downloadsCount, fetchCount: refreshDownloadsCount } = useDownloads();

  // Project loading
  const { loadProject } = useProjectLoader();

  // Local UI state
  const [isDownloadsPanelOpen, setIsDownloadsPanelOpen] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState(null);

  // Track in-progress exports discovered on page load
  const [pendingExports, setPendingExports] = useState({});

  // Export store for global export state
  const { exportingProject, startExport, setGlobalExportProgress } = useExportStore();

  // File input ref for Add Game
  const annotateFileInputRef = useRef(null);

  // Check for in-progress exports on mount
  // This allows users to return and see exports that were running when they left
  useEffect(() => {
    const checkPendingExports = async () => {
      try {
        // Check each project for pending exports
        for (const project of projects) {
          const response = await fetch(`${API_BASE}/api/exports/project/${project.id}`);
          if (response.ok) {
            const data = await response.json();
            const inProgressExport = data.exports?.find(
              e => e.status === 'processing' || e.status === 'pending'
            );
            const completedExport = data.exports?.find(
              e => e.status === 'complete'
            );

            if (inProgressExport) {
              console.log(`[ProjectsScreen] Found in-progress export for project ${project.id}:`, inProgressExport.job_id);
              setPendingExports(prev => ({
                ...prev,
                [project.id]: {
                  jobId: inProgressExport.job_id,
                  type: inProgressExport.type,
                  status: inProgressExport.status
                }
              }));

              // Start tracking this export globally
              startExport(project.id, inProgressExport.type, inProgressExport.job_id);

              // Connect WebSocket to get progress updates
              connectToExportWebSocket(inProgressExport.job_id);
            } else if (completedExport) {
              // There's a completed export - refresh the project list to show it
              console.log(`[ProjectsScreen] Found completed export for project ${project.id}`);
            }
          }
        }
      } catch (err) {
        console.error('[ProjectsScreen] Failed to check pending exports:', err);
      }
    };

    // Connect to WebSocket for an in-progress export
    const connectToExportWebSocket = (jobId) => {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/export/${jobId}`;

      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log(`[ProjectsScreen] Export progress for ${jobId}:`, data);

        setGlobalExportProgress({
          progress: data.progress,
          message: data.message
        });

        if (data.status === 'complete') {
          console.log(`[ProjectsScreen] Export ${jobId} complete`);
          ws.close();
          // Clear from pending exports
          setPendingExports(prev => {
            const updated = { ...prev };
            // Find and remove the project with this job
            for (const [projectId, info] of Object.entries(updated)) {
              if (info.jobId === jobId) {
                delete updated[projectId];
                break;
              }
            }
            return updated;
          });
        } else if (data.status === 'error') {
          console.error(`[ProjectsScreen] Export ${jobId} failed:`, data.message);
          ws.close();
        }
      };

      ws.onerror = (error) => {
        console.log('[ProjectsScreen] WebSocket error (export may have completed):', error);
      };

      ws.onclose = () => {
        console.log(`[ProjectsScreen] WebSocket closed for ${jobId}`);
      };
    };

    if (projects.length > 0) {
      checkPendingExports();
    }
  }, [projects, startExport, setGlobalExportProgress]);

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
      const result = await loadProject(project, {
        onClipsLoaded,
        onWorkingVideoLoaded,
      });

      // Sync with editorStore for legacy compatibility
      setEditorMode(result.mode);

      console.log('[ProjectsScreen] Project loaded:', result);
    } catch (err) {
      console.error('[ProjectsScreen] Failed to select project:', err);
    } finally {
      setLoadingProjectId(null);
    }
  }, [selectProject, loadProject, setEditorMode, onStateReset, onClipsLoaded, onWorkingVideoLoaded, onProjectSelected]);

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
        onClipsLoaded,
        onWorkingVideoLoaded,
      });

      // Sync with editorStore for legacy compatibility
      setEditorMode(result.mode);

      console.log('[ProjectsScreen] Project loaded with mode:', result);
    } catch (err) {
      console.error('[ProjectsScreen] Failed to select project:', err);
    } finally {
      setLoadingProjectId(null);
    }
  }, [selectProject, loadProject, setEditorMode, onStateReset, onClipsLoaded, onWorkingVideoLoaded, onProjectSelected]);

  // Handle game loading (navigate to annotate)
  const handleLoadGame = useCallback((gameId) => {
    console.log('[ProjectsScreen] Loading game:', gameId);
    // Call App.jsx callback to set pendingGameId state
    if (onLoadGameProp) {
      onLoadGameProp(gameId);
    }
  }, [onLoadGameProp]);

  // Handle annotate (navigate to annotate mode)
  // Trigger file input to open file dialog immediately
  const handleAnnotate = useCallback(() => {
    // Trigger file input to open file dialog
    annotateFileInputRef.current?.click();
  }, []);

  // Handle file selection for annotate mode
  const handleAnnotateFileChange = useCallback((event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      console.log('[ProjectsScreen] File selected for annotate:', files[0].name);
      // Call callback with the selected file
      if (onAnnotateWithFile) {
        onAnnotateWithFile(files[0]);
      }
    }
    // Reset input so same file can be selected again
    event.target.value = '';
  }, [onAnnotateWithFile]);

  // Compute exporting project from either global store or discovered pending exports
  const activeExportingProject = exportingProject || (() => {
    // Find first project with pending export
    for (const [projectId, info] of Object.entries(pendingExports)) {
      return {
        projectId: parseInt(projectId),
        stage: info.type,
        exportId: info.jobId
      };
    }
    return null;
  })();

  // App state for context (for components that need it)
  const appStateValue = {
    editorMode: 'project-manager',
    selectedProjectId: null,
    selectedProject: null,
    exportingProject: activeExportingProject,
    downloadsCount,
    refreshDownloadsCount,
  };

  return (
    <AppStateProvider value={appStateValue}>
      <div className="min-h-screen bg-gray-900">
        {/* Hidden file input for Add Game - triggers file dialog immediately */}
        <input
          ref={annotateFileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          onChange={handleAnnotateFileChange}
          className="hidden"
          multiple
        />

        <ProjectManager
          projects={projects}
          loading={projectsLoading || loadingProjectId !== null}
          loadingProjectId={loadingProjectId}
          onSelectProject={handleSelectProject}
          onSelectProjectWithMode={handleSelectProjectWithMode}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
          onAnnotate={handleAnnotate}
          // Games props
          games={games}
          gamesLoading={gamesLoading}
          onLoadGame={handleLoadGame}
          onDeleteGame={deleteGame}
          onFetchGames={fetchGames}
          onOpenDownloads={() => setIsDownloadsPanelOpen(true)}
        />

        {/* Downloads Panel */}
        <DownloadsPanel
          isOpen={isDownloadsPanelOpen}
          onClose={() => setIsDownloadsPanelOpen(false)}
          onOpenProject={(projectId) => {
            handleSelectProjectWithMode(projectId, { mode: 'overlay' });
            setIsDownloadsPanelOpen(false);
          }}
          onCountChange={refreshDownloadsCount}
        />
      </div>
    </AppStateProvider>
  );
}

export default ProjectsScreen;
