import { useCallback } from 'react';
import { ProjectManager } from '../components/ProjectManager';
import { useProjects } from '../hooks/useProjects';
import { useGames } from '../hooks/useGames';
import { API_BASE } from '../config';

/**
 * ProjectsScreen - Self-contained screen for Project Manager
 *
 * This component owns all project/game management hooks and state:
 * - useProjects - project CRUD operations
 * - useGames - game CRUD operations
 *
 * Props from App.jsx are minimal:
 * - onNavigate - navigation callback
 * - onOpenDownloads - callback to open downloads panel
 *
 * @see tasks/PHASE2-ARCHITECTURE-PLAN.md for architecture context
 */
export function ProjectsScreen({
  // Navigation
  onNavigate,
  onSelectProject,
  onSelectProjectWithMode,
  onAnnotate,

  // Downloads
  onOpenDownloads,

  // Game loading handler (passed from App)
  onLoadGame,
}) {
  // Project management hooks
  const {
    projects,
    selectedProject,
    selectedProjectId,
    loading: projectsLoading,
    hasProjects,
    fetchProjects,
    selectProject,
    createProject,
    deleteProject,
    clearSelection,
    refreshSelectedProject,
    discardUncommittedChanges
  } = useProjects();

  // Games management hook
  const {
    games,
    isLoading: gamesLoading,
    fetchGames,
    createGame,
    uploadGameVideo,
    getGame,
    deleteGame,
    saveAnnotationsDebounced,
    getGameVideoUrl,
  } = useGames();

  return (
    <ProjectManager
      projects={projects}
      loading={projectsLoading}
      onSelectProject={onSelectProject}
      onSelectProjectWithMode={onSelectProjectWithMode}
      onCreateProject={createProject}
      onDeleteProject={deleteProject}
      onAnnotate={onAnnotate}
      // Games props
      games={games}
      gamesLoading={gamesLoading}
      onLoadGame={onLoadGame}
      onDeleteGame={deleteGame}
      onFetchGames={fetchGames}
      onOpenDownloads={onOpenDownloads}
    />
  );
}

export default ProjectsScreen;
