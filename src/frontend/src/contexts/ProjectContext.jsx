import { createContext, useContext } from 'react';
import { useProjectsStore } from '../stores/projectsStore';

const ProjectContext = createContext(null);

/**
 * Thin adapter over projectsStore. The selected project is the single source of
 * truth — `selectProject` fetches and populates `selectedProject` before the
 * editor (and thus this provider) mounts (gated at App.jsx by `!selectedProject`).
 * This context does NOT issue its own fetch; it mirrors store state to preserve
 * the `useProject()` contract for FramingScreen and OverlayScreen. (T3775)
 */
export function ProjectProvider({ children }) {
  const projectId = useProjectsStore(state => state.selectedProjectId);
  const project = useProjectsStore(state => state.selectedProject);
  const refresh = useProjectsStore(state => state.refreshSelectedProject);

  const value = {
    projectId,
    project,
    // Neither consumer reads loading/error; keep the keys stable without
    // surfacing the store's shared loading/error (which reflect unrelated fetches).
    loading: false,
    error: null,
    // refreshSelectedProject re-fetches the selected project and returns it (or
    // null) — OverlayScreen's working-video recovery path relies on this return.
    refresh,
    // Convenience getters
    aspectRatio: project?.aspect_ratio || '9:16',
    hasWorkingVideo: !!project?.working_video_id,
    hasFinalVideo: !!project?.final_video_id,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within ProjectProvider');
  }
  return context;
}

// Optional: Hook that returns null instead of throwing (for optional contexts)
export function useProjectOptional() {
  return useContext(ProjectContext);
}
