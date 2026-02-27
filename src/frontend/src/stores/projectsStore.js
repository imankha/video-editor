/**
 * Projects Store
 *
 * Zustand store for project list management. Holds the list of all projects
 * and the currently selected project. This is separate from projectDataStore,
 * which holds clip-level data for the currently open project.
 *
 * Migrated from useProjects hook to enable profile-switch reactivity —
 * _resetDataStores() can clear and re-fetch this store when the active
 * profile changes.
 */

import { create } from 'zustand';
import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;

// Module-level ref for fetch cancellation (prevents stale data on rapid profile switch)
let _fetchController = null;

export const useProjectsStore = create((set, get) => ({
  projects: [],
  selectedProjectId: null,
  selectedProject: null,
  loading: false,
  error: null,

  // Computed
  hasProjects: () => get().projects.length > 0,

  /**
   * Fetch all projects from the API.
   * Cancels any in-flight fetch to prevent stale data from a previous
   * profile overwriting the current one (race condition on rapid switch).
   */
  fetchProjects: async () => {
    if (_fetchController) _fetchController.abort();
    _fetchController = new AbortController();
    const { signal } = _fetchController;

    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/projects`, { signal });
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      set({ projects: data, loading: false });
      return data;
    } catch (err) {
      if (err.name === 'AbortError') return get().projects;
      set({ error: err.message, loading: false });
      console.error('[projectsStore] fetchProjects error:', err);
      return [];
    }
  },

  /**
   * Fetch a single project's details
   */
  fetchProject: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}?_t=${Date.now()}`);
      if (!response.ok) throw new Error('Failed to fetch project');
      const data = await response.json();
      set({ loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      console.error('[projectsStore] fetchProject error:', err);
      return null;
    }
  },

  /**
   * Select a project by ID (null to deselect)
   */
  selectProject: async (projectId) => {
    if (projectId === null) {
      set({ selectedProjectId: null, selectedProject: null });
      return null;
    }

    set({ selectedProjectId: projectId });
    const project = await get().fetchProject(projectId);
    set({ selectedProject: project });
    return project;
  },

  /**
   * Create a new project
   */
  createProject: async (name, aspectRatio) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, aspect_ratio: aspectRatio }),
      });
      if (!response.ok) throw new Error('Failed to create project');
      const project = await response.json();

      await get().fetchProjects();
      return project;
    } catch (err) {
      set({ error: err.message, loading: false });
      console.error('[projectsStore] createProject error:', err);
      return null;
    }
  },

  /**
   * Delete a project
   */
  deleteProject: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete project');

      if (get().selectedProjectId === projectId) {
        set({ selectedProjectId: null, selectedProject: null });
      }

      await get().fetchProjects();
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      console.error('[projectsStore] deleteProject error:', err);
      return false;
    }
  },

  /**
   * Refresh the selected project's data
   */
  refreshSelectedProject: async () => {
    const { selectedProjectId } = get();
    if (selectedProjectId) {
      const project = await get().fetchProject(selectedProjectId);
      set({ selectedProject: project });
      return project;
    }
    return null;
  },

  /**
   * Clear project selection
   */
  clearSelection: () => {
    set({ selectedProjectId: null, selectedProject: null });
  },

  /**
   * Rename a project
   */
  renameProject: async (projectId, newName) => {
    const project = get().projects.find(p => p.id === projectId);
    if (!project) return;

    const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, aspect_ratio: project.aspect_ratio }),
    });
    if (!response.ok) throw new Error('Failed to rename project');

    // Update local state — clear is_auto_created so getProjectDisplayName
    // returns the user-chosen name instead of the auto-generated clip name
    set(state => ({
      projects: state.projects.map(p =>
        p.id === projectId ? { ...p, name: newName, is_auto_created: false } : p
      ),
    }));
  },

  /**
   * Discard all uncommitted framing changes for a project.
   */
  discardUncommittedChanges: async (projectId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/discard-uncommitted`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to discard uncommitted changes');
      const result = await response.json();
      return result;
    } catch (err) {
      console.error('[projectsStore] discardUncommittedChanges error:', err);
      throw err;
    }
  },

  /**
   * Reset store — called on profile switch.
   * Clears all data so the UI immediately reflects the empty state
   * before new data is fetched.
   */
  reset: () => {
    if (_fetchController) { _fetchController.abort(); _fetchController = null; }
    set({
      projects: [],
      selectedProjectId: null,
      selectedProject: null,
      loading: false,
      error: null,
    });
  },
}));

// Selector hooks for granular subscriptions
export const useProjects = () => useProjectsStore(state => state.projects);
export const useSelectedProject = () => useProjectsStore(state => state.selectedProject);
export const useSelectedProjectId = () => useProjectsStore(state => state.selectedProjectId);
export const useProjectsLoading = () => useProjectsStore(state => state.loading);
