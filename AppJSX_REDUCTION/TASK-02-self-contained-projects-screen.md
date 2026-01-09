# TASK-02: Self-Contained ProjectsScreen

## Objective
Make ProjectsScreen fully self-contained by moving all project selection and loading logic from App.jsx into the screen.

## Current Problem
App.jsx has ~400 lines of project loading logic embedded in `onSelectProject` and `onSelectProjectWithMode` callbacks:

```jsx
// App.jsx lines 1589-1846 - Massive inline callbacks
onSelectProject={async (id) => {
  // 150+ lines of:
  // - Mode determination
  // - State clearing
  // - Clip fetching
  // - Video loading
  // - State restoration
  // - Working video loading
}}
```

This violates loose coupling - App.jsx knows intimate details of how projects are loaded.

## Solution
Move all project loading logic into ProjectsScreen. App.jsx only needs to know that a project was selected.

---

## Implementation Steps

### Step 1: Create useProjectLoader Hook

This hook encapsulates all project loading logic.

**File**: `src/frontend/src/hooks/useProjectLoader.js`

```javascript
import { useCallback } from 'react';
import { API_BASE } from '../config';
import { useNavigationStore } from '../stores/navigationStore';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';

/**
 * Hook for loading projects with all associated data
 * Encapsulates the complex loading logic previously in App.jsx
 */
export function useProjectLoader() {
  const { setProjectId, navigate } = useNavigationStore();

  /**
   * Load a project and navigate to appropriate mode
   * @param {Object} project - Project data from API
   * @param {Object} options - Loading options
   * @returns {Object} Loaded project data with clips, working video, etc.
   */
  const loadProject = useCallback(async (project, options = {}) => {
    const {
      mode = null, // Override auto-detected mode
      clipIndex = 0, // Which clip to select initially
      onProgress = () => {}, // Progress callback
    } = options;

    const projectId = project.id;

    try {
      onProgress({ stage: 'loading', message: 'Loading project...' });

      // Update navigation state
      setProjectId(projectId);

      // Determine target mode
      const targetMode = mode || (project.working_video_id ? 'overlay' : 'framing');

      // Update last_opened_at (non-blocking)
      fetch(`${API_BASE}/api/projects/${projectId}/state?update_last_opened=true`, {
        method: 'PATCH'
      }).catch(e => console.error('Failed to update last_opened_at:', e));

      onProgress({ stage: 'clips', message: 'Loading clips...' });

      // Fetch project clips
      const clipsResponse = await fetch(`${API_BASE}/api/clips/projects/${projectId}/clips`);
      const clips = clipsResponse.ok ? await clipsResponse.json() : [];

      // Load clip metadata
      const clipsWithMetadata = await Promise.all(
        clips.map(async (clip) => {
          const clipUrl = `${API_BASE}/api/clips/projects/${projectId}/clips/${clip.id}/file`;
          try {
            const metadata = await extractVideoMetadataFromUrl(clipUrl);
            return {
              ...clip,
              url: clipUrl,
              metadata,
            };
          } catch (err) {
            console.warn(`Failed to load metadata for clip ${clip.id}:`, err);
            return { ...clip, url: clipUrl, metadata: null };
          }
        })
      );

      // Load working video if exists
      let workingVideo = null;
      if (project.working_video_id) {
        onProgress({ stage: 'working-video', message: 'Loading working video...' });

        try {
          const response = await fetch(`${API_BASE}/api/projects/${projectId}/working-video`);
          if (response.ok) {
            const blob = await response.blob();
            const file = new File([blob], 'working_video.mp4', { type: 'video/mp4' });
            const url = URL.createObjectURL(file);
            const metadata = await extractVideoMetadata(file);

            workingVideo = { file, url, metadata };
          }
        } catch (err) {
          console.error('Failed to load working video:', err);
        }
      }

      onProgress({ stage: 'complete', message: 'Project loaded' });

      // Navigate to target mode
      navigate(targetMode);

      return {
        project,
        clips: clipsWithMetadata,
        selectedClipIndex: Math.min(clipIndex, clipsWithMetadata.length - 1),
        workingVideo,
        mode: targetMode,
      };
    } catch (err) {
      console.error('Failed to load project:', err);
      throw err;
    }
  }, [setProjectId, navigate]);

  return { loadProject };
}
```

### Step 2: Update ProjectsScreen

**File**: `src/frontend/src/screens/ProjectsScreen.jsx`

Update to be fully self-contained:

```jsx
import { useState, useCallback } from 'react';
import { ProjectManager } from '../components/ProjectManager';
import { DownloadsPanel } from '../components/DownloadsPanel';
import { useProjects } from '../hooks/useProjects';
import { useGames } from '../hooks/useGames';
import { useDownloads } from '../hooks/useDownloads';
import { useProjectLoader } from '../hooks/useProjectLoader';
import { useNavigationStore } from '../stores/navigationStore';
import { AppStateProvider } from '../contexts';

export function ProjectsScreen({
  // Only minimal props needed for settings modal
  onOpenProjectCreationSettings,
}) {
  const navigate = useNavigationStore(state => state.navigate);
  const setProjectId = useNavigationStore(state => state.setProjectId);

  // Project management
  const {
    projects,
    loading: projectsLoading,
    fetchProjects,
    selectProject,
    createProject,
    deleteProject,
  } = useProjects();

  // Games management
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

  // Handle project selection
  const handleSelectProject = useCallback(async (projectId) => {
    setLoadingProjectId(projectId);

    try {
      const project = await selectProject(projectId);
      const result = await loadProject(project);

      // Emit loaded data for consuming screens
      // (In future: use context or store)
      console.log('[ProjectsScreen] Project loaded:', result);
    } catch (err) {
      console.error('[ProjectsScreen] Failed to select project:', err);
    } finally {
      setLoadingProjectId(null);
    }
  }, [selectProject, loadProject]);

  // Handle project selection with mode override
  const handleSelectProjectWithMode = useCallback(async (projectId, options) => {
    setLoadingProjectId(projectId);

    try {
      const project = await selectProject(projectId);
      const result = await loadProject(project, options);
      console.log('[ProjectsScreen] Project loaded with mode:', result);
    } catch (err) {
      console.error('[ProjectsScreen] Failed to select project:', err);
    } finally {
      setLoadingProjectId(null);
    }
  }, [selectProject, loadProject]);

  // Handle game loading (navigate to annotate)
  const handleLoadGame = useCallback((gameId) => {
    // Store game ID for AnnotateScreen to pick up
    // (Could use store or sessionStorage)
    sessionStorage.setItem('pendingGameId', String(gameId));
    navigate('annotate');
  }, [navigate]);

  // Handle annotate (new game video)
  const handleAnnotate = useCallback(() => {
    // Clear any pending game, navigate to annotate for new game
    sessionStorage.removeItem('pendingGameId');
    navigate('annotate');
  }, [navigate]);

  // App state for context (for components that need it)
  const appStateValue = {
    editorMode: 'project-manager',
    selectedProjectId: null,
    selectedProject: null,
    exportingProject: null,
    downloadsCount,
    refreshDownloadsCount,
  };

  return (
    <AppStateProvider value={appStateValue}>
      <div className="min-h-screen bg-gray-900">
        <input
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              sessionStorage.setItem('pendingAnnotateFile', 'true');
              // Store file reference (would need FileReader for persistence)
              navigate('annotate');
            }
            e.target.value = '';
          }}
          id="annotate-file-input"
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
          games={games}
          gamesLoading={gamesLoading}
          onLoadGame={handleLoadGame}
          onDeleteGame={deleteGame}
          onFetchGames={fetchGames}
          onOpenDownloads={() => setIsDownloadsPanelOpen(true)}
        />

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
```

### Step 3: Create Project Data Store

For sharing loaded project data between screens.

**File**: `src/frontend/src/stores/projectDataStore.js`

```javascript
import { create } from 'zustand';

/**
 * Store for loaded project data
 * Populated by ProjectsScreen, consumed by FramingScreen/OverlayScreen
 */
export const useProjectDataStore = create((set, get) => ({
  // Loaded clips with metadata
  clips: [],

  // Currently selected clip index
  selectedClipIndex: 0,

  // Working video (if exported)
  workingVideo: null, // { file, url, metadata }

  // Loaded framing state per clip
  clipStates: {}, // { [clipId]: { segments, cropKeyframes } }

  // Actions
  setClips: (clips) => set({ clips }),

  setSelectedClipIndex: (index) => set({ selectedClipIndex: index }),

  setWorkingVideo: (workingVideo) => set({ workingVideo }),

  setClipState: (clipId, state) => set(prev => ({
    clipStates: { ...prev.clipStates, [clipId]: state }
  })),

  getSelectedClip: () => {
    const { clips, selectedClipIndex } = get();
    return clips[selectedClipIndex] || null;
  },

  reset: () => set({
    clips: [],
    selectedClipIndex: 0,
    workingVideo: null,
    clipStates: {},
  }),
}));
```

### Step 4: Update Stores Index

**File**: `src/frontend/src/stores/index.js`

```javascript
export { useProjectDataStore } from './projectDataStore';
```

---

## Migration Steps in App.jsx

After this task, App.jsx can be simplified:

### Before (lines 1566-1878):
```jsx
if (!selectedProject && editorMode !== 'annotate') {
  return (
    <AppStateProvider value={appStateValue}>
      <div className="min-h-screen bg-gray-900">
        {/* 300+ lines of embedded logic */}
        <ProjectManager
          onSelectProject={async (id) => {
            // 150+ lines of loading logic
          }}
        />
      </div>
    </AppStateProvider>
  );
}
```

### After:
```jsx
if (mode === 'project-manager') {
  return <ProjectsScreen onOpenProjectCreationSettings={() => setShowSettings(true)} />;
}
```

---

## Files Changed
- `src/frontend/src/hooks/useProjectLoader.js` (new)
- `src/frontend/src/stores/projectDataStore.js` (new)
- `src/frontend/src/stores/index.js` (update)
- `src/frontend/src/screens/ProjectsScreen.jsx` (update)
- `src/frontend/src/App.jsx` (simplify - in Task 07)

## Verification
```bash
cd src/frontend && npm test
cd src/frontend && npx playwright test "Project Manager"
```

## Commit Message
```
refactor: Make ProjectsScreen self-contained

- Create useProjectLoader hook for project loading logic
- Create projectDataStore for sharing loaded data
- Move project selection callbacks from App.jsx to ProjectsScreen
- ProjectsScreen now handles all project loading internally
```
