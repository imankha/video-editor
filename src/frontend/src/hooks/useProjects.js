import { useState, useCallback, useEffect } from 'react';

const API_BASE = 'http://localhost:8000/api';

/**
 * useProjects - Manages project state and API interactions
 *
 * Provides:
 * - projects: List of all projects
 * - selectedProject: Currently selected project (null if none)
 * - loading: Loading state
 * - error: Error message if any
 * - Actions: fetchProjects, selectProject, createProject, deleteProject, etc.
 */
export function useProjects() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch all projects from the API
   */
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/projects`);
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      setProjects(data);
      return data;
    } catch (err) {
      setError(err.message);
      console.error('[useProjects] fetchProjects error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Fetch a single project's details
   */
  const fetchProject = useCallback(async (projectId) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}`);
      if (!response.ok) throw new Error('Failed to fetch project');
      const data = await response.json();
      return data;
    } catch (err) {
      setError(err.message);
      console.error('[useProjects] fetchProject error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Select a project by ID (null to deselect)
   */
  const selectProject = useCallback(async (projectId) => {
    if (projectId === null) {
      setSelectedProjectId(null);
      setSelectedProject(null);
      return null;
    }

    setSelectedProjectId(projectId);
    const project = await fetchProject(projectId);
    setSelectedProject(project);
    return project;
  }, [fetchProject]);

  /**
   * Create a new project
   */
  const createProject = useCallback(async (name, aspectRatio) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, aspect_ratio: aspectRatio })
      });
      if (!response.ok) throw new Error('Failed to create project');
      const project = await response.json();

      // Refresh projects list
      await fetchProjects();

      return project;
    } catch (err) {
      setError(err.message);
      console.error('[useProjects] createProject error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchProjects]);

  /**
   * Delete a project
   */
  const deleteProject = useCallback(async (projectId) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete project');

      // If deleting selected project, deselect it
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setSelectedProject(null);
      }

      // Refresh projects list
      await fetchProjects();

      return true;
    } catch (err) {
      setError(err.message);
      console.error('[useProjects] deleteProject error:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, fetchProjects]);

  /**
   * Refresh the selected project's data
   */
  const refreshSelectedProject = useCallback(async () => {
    if (selectedProjectId) {
      const project = await fetchProject(selectedProjectId);
      setSelectedProject(project);
      return project;
    }
    return null;
  }, [selectedProjectId, fetchProject]);

  /**
   * Clear project selection (used when entering Annotate mode)
   */
  const clearSelection = useCallback(() => {
    setSelectedProjectId(null);
    setSelectedProject(null);
  }, []);

  /**
   * Discard all uncommitted framing changes for a project.
   * Deletes any clip versions that haven't been exported yet.
   */
  const discardUncommittedChanges = useCallback(async (projectId) => {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/discard-uncommitted`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to discard uncommitted changes');
      const result = await response.json();
      console.log('[useProjects] Discarded uncommitted changes:', result.discarded_count);
      return result;
    } catch (err) {
      console.error('[useProjects] discardUncommittedChanges error:', err);
      throw err;
    }
  }, []);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return {
    // State
    projects,
    selectedProjectId,
    selectedProject,
    loading,
    error,
    hasProjects: projects.length > 0,

    // Actions
    fetchProjects,
    fetchProject,
    selectProject,
    createProject,
    deleteProject,
    refreshSelectedProject,
    clearSelection,
    discardUncommittedChanges
  };
}

export default useProjects;
