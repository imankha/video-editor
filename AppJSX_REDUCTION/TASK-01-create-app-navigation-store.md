# TASK-01: Create App Navigation Store

## Objective
Create a Zustand store and React context for app-wide navigation and project state, eliminating prop drilling for navigation callbacks.

## Current Problem
App.jsx passes navigation callbacks (`setEditorMode`, `onNavigate`) as props through multiple layers. Each screen needs these to navigate, creating tight coupling.

```jsx
// Current: Prop drilling
<FramingScreen onNavigate={setEditorMode} />
<OverlayScreen onNavigate={setEditorMode} onSwitchToFraming={() => handleModeChange('framing')} />
```

## Solution
Create a navigation store that any component can access directly.

---

## Implementation Steps

### Step 1: Create Navigation Store

**File**: `src/frontend/src/stores/navigationStore.js`

```javascript
import { create } from 'zustand';

/**
 * Navigation store for app-wide screen transitions
 *
 * Modes:
 * - 'project-manager': Project/game selection
 * - 'annotate': Mark clips in game footage
 * - 'framing': Crop, trim, speed editing
 * - 'overlay': Highlight effects
 */
export const useNavigationStore = create((set, get) => ({
  // Current screen/mode
  mode: 'project-manager',

  // Previous mode (for back navigation)
  previousMode: null,

  // Selected project ID (null = no project selected)
  projectId: null,

  // Navigation history for breadcrumb-style navigation
  history: [],

  // Actions
  navigate: (newMode, options = {}) => {
    const { mode } = get();

    // Don't navigate to same mode
    if (newMode === mode) return;

    set({
      previousMode: mode,
      mode: newMode,
      history: [...get().history, mode].slice(-10), // Keep last 10
    });

    // Optional callback after navigation
    if (options.onNavigate) {
      options.onNavigate(newMode);
    }
  },

  goBack: () => {
    const { previousMode, history } = get();
    if (previousMode) {
      set({
        mode: previousMode,
        previousMode: history[history.length - 1] || null,
        history: history.slice(0, -1),
      });
    }
  },

  setProjectId: (id) => set({ projectId: id }),

  clearProject: () => set({
    projectId: null,
    mode: 'project-manager'
  }),

  // Reset to initial state
  reset: () => set({
    mode: 'project-manager',
    previousMode: null,
    projectId: null,
    history: [],
  }),
}));

// Selector hooks for common patterns
export const useCurrentMode = () => useNavigationStore(state => state.mode);
export const useProjectId = () => useNavigationStore(state => state.projectId);
export const useNavigate = () => useNavigationStore(state => state.navigate);
```

### Step 2: Create Project Context

This context holds the loaded project data (not just ID).

**File**: `src/frontend/src/contexts/ProjectContext.jsx`

```jsx
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
```

### Step 3: Update Store Index

**File**: `src/frontend/src/stores/index.js`

Add export:
```javascript
export { useNavigationStore, useCurrentMode, useProjectId, useNavigate } from './navigationStore';
```

### Step 4: Update Contexts Index

**File**: `src/frontend/src/contexts/index.js`

Add export:
```javascript
export { ProjectProvider, useProject, useProjectOptional } from './ProjectContext';
```

### Step 5: Write Tests

**File**: `src/frontend/src/stores/navigationStore.test.js`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { useNavigationStore } from './navigationStore';

describe('navigationStore', () => {
  beforeEach(() => {
    useNavigationStore.getState().reset();
  });

  it('starts with project-manager mode', () => {
    expect(useNavigationStore.getState().mode).toBe('project-manager');
  });

  it('navigates to new mode', () => {
    const { navigate } = useNavigationStore.getState();
    navigate('framing');
    expect(useNavigationStore.getState().mode).toBe('framing');
    expect(useNavigationStore.getState().previousMode).toBe('project-manager');
  });

  it('does not navigate to same mode', () => {
    const { navigate } = useNavigationStore.getState();
    navigate('framing');
    navigate('framing');
    expect(useNavigationStore.getState().history.length).toBe(1);
  });

  it('goes back to previous mode', () => {
    const { navigate, goBack } = useNavigationStore.getState();
    navigate('framing');
    navigate('overlay');
    goBack();
    expect(useNavigationStore.getState().mode).toBe('framing');
  });

  it('sets and clears project', () => {
    const { setProjectId, clearProject } = useNavigationStore.getState();
    setProjectId(123);
    expect(useNavigationStore.getState().projectId).toBe(123);
    clearProject();
    expect(useNavigationStore.getState().projectId).toBe(null);
    expect(useNavigationStore.getState().mode).toBe('project-manager');
  });

  it('tracks navigation history', () => {
    const { navigate } = useNavigationStore.getState();
    navigate('framing');
    navigate('overlay');
    navigate('annotate');
    expect(useNavigationStore.getState().history).toEqual(['project-manager', 'framing', 'overlay']);
  });
});
```

---

## Integration Plan

This store will be used in subsequent tasks. For now, it exists alongside the current `editorMode` state in App.jsx.

In Task 07, we'll migrate from:
```jsx
// App.jsx
const { editorMode, setEditorMode } = useEditorStore();
```

To:
```jsx
// App.jsx
const mode = useCurrentMode();
const navigate = useNavigate();
```

---

## Files Changed
- `src/frontend/src/stores/navigationStore.js` (new)
- `src/frontend/src/stores/index.js` (update)
- `src/frontend/src/contexts/ProjectContext.jsx` (new)
- `src/frontend/src/contexts/index.js` (update)
- `src/frontend/src/stores/navigationStore.test.js` (new)

## Verification
```bash
cd src/frontend && npm test -- navigationStore
```

## Commit Message
```
feat: Add navigation store and project context

- Create navigationStore for app-wide screen transitions
- Create ProjectContext for shared project state
- Add tests for navigation store
- Preparation for App.jsx reduction
```
