# Task 04: Frontend Project State Management

## Objective
Create a React hook and context for managing project state across the application.

## Dependencies
- Tasks 01-03 (backend API must be working)

## Files to Create

### 1. `src/frontend/src/hooks/useProjects.js`

```javascript
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
    clearSelection
  };
}

export default useProjects;
```

### 2. `src/frontend/src/hooks/useProjectClips.js`

```javascript
import { useState, useCallback } from 'react';

const API_BASE = 'http://localhost:8000/api';

/**
 * useProjectClips - Manages working clips for a project
 *
 * Handles:
 * - Fetching clips from server
 * - Adding clips (from library or upload)
 * - Removing clips
 * - Reordering clips
 * - Updating clip progress
 */
export function useProjectClips(projectId) {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch all clips for the project
   */
  const fetchClips = useCallback(async () => {
    if (!projectId) return [];

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/clips/projects/${projectId}/clips`);
      if (!response.ok) throw new Error('Failed to fetch clips');
      const data = await response.json();
      setClips(data);
      return data;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] fetchClips error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /**
   * Add a clip from the raw clips library
   */
  const addClipFromLibrary = useCallback(async (rawClipId) => {
    if (!projectId) return null;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('raw_clip_id', rawClipId.toString());

      const response = await fetch(`${API_BASE}/clips/projects/${projectId}/clips`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) throw new Error('Failed to add clip');
      const clip = await response.json();

      // Refresh clips list
      await fetchClips();

      return clip;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] addClipFromLibrary error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchClips]);

  /**
   * Upload a new clip file to the project
   */
  const uploadClip = useCallback(async (file) => {
    if (!projectId) return null;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/clips/projects/${projectId}/clips`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) throw new Error('Failed to upload clip');
      const clip = await response.json();

      // Refresh clips list
      await fetchClips();

      return clip;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] uploadClip error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchClips]);

  /**
   * Remove a clip from the project
   */
  const removeClip = useCallback(async (clipId) => {
    if (!projectId) return false;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/clips/projects/${projectId}/clips/${clipId}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error('Failed to remove clip');

      // Refresh clips list
      await fetchClips();

      return true;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] removeClip error:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchClips]);

  /**
   * Reorder clips
   */
  const reorderClips = useCallback(async (clipIds) => {
    if (!projectId) return false;

    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/clips/projects/${projectId}/clips/reorder`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clipIds)
        }
      );
      if (!response.ok) throw new Error('Failed to reorder clips');

      // Refresh clips list
      await fetchClips();

      return true;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] reorderClips error:', err);
      return false;
    }
  }, [projectId, fetchClips]);

  /**
   * Update clip progress
   */
  const updateClipProgress = useCallback(async (clipId, progress) => {
    if (!projectId) return false;

    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/clips/projects/${projectId}/clips/${clipId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ progress })
        }
      );
      if (!response.ok) throw new Error('Failed to update clip');

      // Update local state
      setClips(prev => prev.map(c =>
        c.id === clipId ? { ...c, progress } : c
      ));

      return true;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] updateClipProgress error:', err);
      return false;
    }
  }, [projectId]);

  /**
   * Get clip file URL
   */
  const getClipFileUrl = useCallback((clipId) => {
    if (!projectId) return null;
    return `${API_BASE}/clips/projects/${projectId}/clips/${clipId}/file`;
  }, [projectId]);

  return {
    clips,
    loading,
    error,
    hasClips: clips.length > 0,

    fetchClips,
    addClipFromLibrary,
    uploadClip,
    removeClip,
    reorderClips,
    updateClipProgress,
    getClipFileUrl
  };
}

export default useProjectClips;
```

### 3. `src/frontend/src/hooks/useRawClips.js`

```javascript
import { useState, useCallback, useEffect } from 'react';

const API_BASE = 'http://localhost:8000/api';

/**
 * useRawClips - Manages the raw clips library
 *
 * Raw clips are created by exporting from Annotate mode.
 * They can be added to any project.
 */
export function useRawClips() {
  const [rawClips, setRawClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch all raw clips
   */
  const fetchRawClips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/clips/raw`);
      if (!response.ok) throw new Error('Failed to fetch raw clips');
      const data = await response.json();
      setRawClips(data);
      return data;
    } catch (err) {
      setError(err.message);
      console.error('[useRawClips] fetchRawClips error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get URL for a raw clip file
   */
  const getRawClipFileUrl = useCallback((clipId) => {
    return `${API_BASE}/clips/raw/${clipId}/file`;
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchRawClips();
  }, [fetchRawClips]);

  return {
    rawClips,
    loading,
    error,
    hasRawClips: rawClips.length > 0,
    fetchRawClips,
    getRawClipFileUrl
  };
}

export default useRawClips;
```

## Files to Modify

No modifications needed for this task - we're just adding new hooks.

## Testing Steps

### 1. Start Both Servers
```bash
# Terminal 1 - Backend
cd src/backend
python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd src/frontend
npm run dev
```

### 2. Create Test Component

Temporarily add this to App.jsx to test the hooks:

```javascript
// Add at top of App.jsx
import { useProjects } from './hooks/useProjects';
import { useProjectClips } from './hooks/useProjectClips';
import { useRawClips } from './hooks/useRawClips';

// Add inside App function, near the top:
const {
  projects,
  selectedProject,
  loading: projectsLoading,
  createProject,
  selectProject,
  deleteProject
} = useProjects();

// Add temporary debug output in JSX (before return statement add):
console.log('Projects:', projects);
console.log('Selected:', selectedProject);
```

### 3. Test in Browser Console

Open browser dev tools (F12) and check:

1. **Projects loaded on mount:**
   - Console should show `Projects: []` (empty initially)

2. **Create a project via API:**
   ```bash
   curl -X POST http://localhost:8000/api/projects \
     -H "Content-Type: application/json" \
     -d '{"name": "Test Project", "aspect_ratio": "16:9"}'
   ```
   - Refresh browser
   - Console should now show the project

3. **Test from React (in browser console):**
   ```javascript
   // These won't work directly in console but shows the API
   // The hooks need to be called from React components
   ```

### 4. Verify Hook Exports

Check that the files are properly exported and can be imported:
- No console errors about missing imports
- No TypeScript/ESLint errors

### 5. Clean Up

Remove the temporary debug code from App.jsx.

## Success Criteria

- [ ] useProjects hook created and exports correctly
- [ ] useProjectClips hook created and exports correctly
- [ ] useRawClips hook created and exports correctly
- [ ] No import/export errors in browser console
- [ ] Hooks can be imported in App.jsx without errors
- [ ] fetchProjects() is called on mount
- [ ] projects state updates when API has data
