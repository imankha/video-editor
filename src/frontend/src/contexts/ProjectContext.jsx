import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { API_BASE } from '../config';
import { useNavigationStore } from '../stores/navigationStore';

const ProjectContext = createContext(null);

export function ProjectProvider({ children }) {
  const projectId = useNavigationStore(state => state.projectId);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch project data when projectId changes
  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }

    let cancelled = false;

    async function loadProject() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/api/projects/${projectId}`);
        if (!response.ok) throw new Error('Failed to load project');
        const data = await response.json();

        if (!cancelled) {
          setProject(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setProject(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProject();

    return () => { cancelled = true; };
  }, [projectId]);

  // Refresh project data
  const refresh = useCallback(async () => {
    if (!projectId) return;

    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      }
    } catch (err) {
      console.error('[ProjectContext] Failed to refresh:', err);
    }
  }, [projectId]);

  const value = {
    projectId,
    project,
    loading,
    error,
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
