# Task 06: App.jsx Refactor for Project-Based Flow

## Context

**Project:** Browser-based video editor for soccer highlights with Annotate, Framing, and Overlay modes.

**Tech Stack:**
- Frontend: React 18 + Vite (port 5173)
- Backend: FastAPI + Python (port 8000)

**Current App.jsx Structure (~1000 lines):**
```javascript
function App() {
  // Video state
  const [annotateVideoFile, setAnnotateVideoFile] = useState(null);
  const [annotateVideoUrl, setAnnotateVideoUrl] = useState(null);

  // Editor mode (currently: 'annotate', 'framing', 'overlay')
  const [editorMode, setEditorMode] = useState('framing');

  // Existing hooks
  const annotateHook = useAnnotate();
  const clipManager = useClipManager();

  // ... handlers, effects, render
}
```

**New Project-Aware Navigation:**
```
┌─────────────────────────────────────────┐
│  editorMode === 'project-manager'       │
│  OR (!selectedProject && !annotate)     │
│  → Show ProjectManager                  │
├─────────────────────────────────────────┤
│  editorMode === 'annotate'              │
│  → Show Annotate mode (no project)      │
├─────────────────────────────────────────┤
│  selectedProject + editorMode           │
│  → Show Framing or Overlay mode         │
│  → Aspect ratio from project            │
│  → Overlay disabled until working_video │
└─────────────────────────────────────────┘
```

**Key State Changes:**
- Add `useProjects()` hook
- Add `useProjectClips()` hook
- Mode switching respects project selection
- Aspect ratio comes from project, not user selection

---

## Objective
Refactor App.jsx to implement the project-based navigation flow where:
- No project selected → Show Project Manager
- Project selected → Show Framing/Overlay modes
- Annotate mode → Clears project selection

## Dependencies
- Tasks 01-05 must be completed

## Key Changes

### App State Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        APP STATES                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐                                       │
│  │  No Project      │ ←──── clearSelection()                │
│  │  Selected        │                                       │
│  │                  │                                       │
│  │  Shows:          │                                       │
│  │  - ProjectManager│                                       │
│  │  - OR Annotate   │                                       │
│  │    (if video     │                                       │
│  │     loaded)      │                                       │
│  └────────┬─────────┘                                       │
│           │                                                  │
│           │ selectProject(id)                               │
│           ▼                                                  │
│  ┌──────────────────┐                                       │
│  │  Project         │                                       │
│  │  Selected        │                                       │
│  │                  │                                       │
│  │  Shows:          │                                       │
│  │  - Framing Mode  │ (default)                             │
│  │  - Overlay Mode  │ (if working_video exists)             │
│  └──────────────────┘                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Files to Modify

### `src/frontend/src/App.jsx`

Make these changes:

#### 1. Add new imports (top of file)

```javascript
// Add these imports
import { useProjects } from './hooks/useProjects';
import { useProjectClips } from './hooks/useProjectClips';
import { ProjectManager } from './components/ProjectManager';
import { ProjectHeader } from './components/ProjectHeader';
```

#### 2. Add project hooks (inside App function, near other hooks)

```javascript
// Project management
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
  refreshSelectedProject
} = useProjects();

// Project clips (only active when project selected)
const {
  clips: projectClips,
  fetchClips: fetchProjectClips,
  uploadClip,
  addClipFromLibrary,
  removeClip: removeProjectClip,
  reorderClips: reorderProjectClips,
  getClipFileUrl
} = useProjectClips(selectedProjectId);
```

#### 3. Modify editorMode logic

Replace the existing `editorMode` state with logic that respects project selection:

```javascript
// Editor mode - now project-aware
// When no project: 'project-manager' or 'annotate'
// When project selected: 'framing' or 'overlay'
const [editorMode, setEditorMode] = useState('project-manager');

// Computed: is overlay available?
const isOverlayAvailable = selectedProject?.working_video_id != null;

// Handle mode switching with project awareness
const handleModeChange = useCallback((newMode) => {
  if (newMode === 'annotate') {
    // Clear project selection when entering annotate
    clearSelection();
  }
  setEditorMode(newMode);
}, [clearSelection]);

// When project is selected, ensure we're in a valid mode
useEffect(() => {
  if (selectedProject) {
    // If we have a project, we should be in framing or overlay
    if (editorMode === 'project-manager' || editorMode === 'annotate') {
      setEditorMode('framing');
    }
    // If in overlay but no working video, go to framing
    if (editorMode === 'overlay' && !isOverlayAvailable) {
      setEditorMode('framing');
    }
  } else {
    // No project selected
    if (editorMode !== 'annotate') {
      setEditorMode('project-manager');
    }
  }
}, [selectedProject, editorMode, isOverlayAvailable]);
```

#### 4. Remove aspect ratio control from Framing

The aspect ratio now comes from the project, not user selection:

```javascript
// Replace globalAspectRatio usage with:
const effectiveAspectRatio = selectedProject?.aspect_ratio || globalAspectRatio;

// Remove or hide the AspectRatioSelector in Framing mode
// The aspect ratio is set when creating the project
```

#### 5. Update the render logic

At the start of the return statement, add the project manager check:

```javascript
// If no project and not in annotate mode, show project manager
if (!selectedProject && editorMode !== 'annotate') {
  return (
    <div className="min-h-screen bg-gray-900">
      <ProjectManager
        projects={projects}
        loading={projectsLoading}
        onSelectProject={async (id) => {
          await selectProject(id);
          setEditorMode('framing');
        }}
        onCreateProject={createProject}
        onDeleteProject={deleteProject}
        onAnnotate={() => {
          clearSelection();
          setEditorMode('annotate');
        }}
      />
    </div>
  );
}
```

#### 6. Update header to show project info

In the header section, add ProjectHeader:

```javascript
{/* Header */}
<div className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
  {/* Left side - Project info or buttons */}
  <div className="flex items-center gap-4">
    {selectedProject ? (
      <ProjectHeader
        selectedProject={selectedProject}
        projects={projects}
        onSelectProject={selectProject}
        onBackToManager={() => {
          clearSelection();
          setEditorMode('project-manager');
        }}
      />
    ) : (
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            clearSelection();
            setEditorMode('project-manager');
          }}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
        >
          ← Projects
        </button>
      </div>
    )}
  </div>

  {/* Center - Mode switcher */}
  {selectedProject && (
    <ModeSwitcher
      mode={editorMode}
      onModeChange={handleModeChange}
      disabled={false}
      hasAnnotateVideo={false}  // Hide annotate when project selected
      hasFramingVideo={true}
      hasOverlayVideo={isOverlayAvailable}
    />
  )}

  {/* Right side - other controls */}
  {/* ... */}
</div>
```

#### 7. Update ModeSwitcher visibility logic

The ModeSwitcher should only show Framing/Overlay when a project is selected:

```javascript
// In the JSX where ModeSwitcher is rendered:
{selectedProject && (
  <ModeSwitcher
    mode={editorMode}
    onModeChange={handleModeChange}
    hasAnnotateVideo={false}
    hasFramingVideo={true}
    // Only enable overlay if working video exists
    hasOverlayVideo={isOverlayAvailable}
  />
)}
```

#### 8. Handle Annotate mode return

When Annotate export completes and creates projects:

```javascript
// Modify handleAnnotateExport to:
// 1. After export completes, refresh projects list
// 2. Optionally auto-select the first created project

const handleAnnotateExport = useCallback(async (clipData) => {
  // ... existing export logic ...

  // After successful export:
  await fetchProjects();

  // Clear annotate state
  setAnnotateVideoFile(null);
  setAnnotateVideoUrl(null);
  setAnnotateVideoMetadata(null);

  // Return to project manager (user can select a created project)
  setEditorMode('project-manager');

}, [/* dependencies */]);
```

## Testing Steps

### 1. Start Fresh
```bash
# Clear database to start fresh
rm -rf user_data/

# Start backend and frontend
```

### 2. Test Initial State (No Projects)

1. **Load the app** - Should show ProjectManager
2. **Verify UI shows:**
   - "Project Manager" header
   - "New Project" button
   - "Annotate Game" button
   - "No projects yet" message

### 3. Test Create Project Flow

1. **Click "New Project"**
2. **Enter name: "Test Project"**
3. **Select 16:9 aspect ratio**
4. **Click Create**
5. **Verify project appears in list**

### 4. Test Project Selection

1. **Click on the created project**
2. **Verify:**
   - ProjectManager disappears
   - Framing mode UI appears
   - ProjectHeader shows project name
   - ModeSwitcher shows Framing (active) and Overlay (disabled)

### 5. Test Project Switching

1. **Click on project name in header**
2. **Verify dropdown opens**
3. **Click "Back to Project Manager"**
4. **Verify returns to ProjectManager view**

### 6. Test Annotate Entry

1. **From ProjectManager, click "Annotate Game"**
2. **Verify enters Annotate mode**
3. **Verify project selection is cleared**

### 7. Test Mode Switching Constraints

1. **Select a project**
2. **Verify Overlay tab is disabled** (no working video yet)
3. **Verify can't click Overlay tab**

### 8. Test Aspect Ratio From Project

1. **Create a 9:16 project**
2. **Select it**
3. **Verify aspect ratio selector is hidden or shows 9:16**
4. **Verify video preview uses 9:16 aspect**

### 9. Test Navigation Persistence

1. **Select a project**
2. **Refresh the page**
3. **Verify returns to ProjectManager** (we don't persist selection yet)

## Success Criteria

- [ ] App shows ProjectManager when no project selected
- [ ] Creating a project adds it to the list
- [ ] Clicking project switches to Framing mode
- [ ] ProjectHeader shows selected project name
- [ ] Can switch projects via dropdown
- [ ] "Back to Project Manager" deselects project
- [ ] ModeSwitcher only shows Framing/Overlay when project selected
- [ ] Overlay is disabled until working_video exists
- [ ] Annotate mode clears project selection
- [ ] Aspect ratio comes from project, not user selection
- [ ] Mode state is consistent with project selection

## Code Patterns to Follow

### Existing patterns in App.jsx:

```javascript
// State declarations use useState
const [editorMode, setEditorMode] = useState('framing');

// Callbacks use useCallback
const handleModeChange = useCallback((mode) => {
  // ...
}, [dependencies]);

// Effects use useEffect
useEffect(() => {
  // React to state changes
}, [dependencies]);

// Conditional rendering pattern
if (someCondition) {
  return <SomeComponent />;
}

// JSX conditional rendering
{condition && <Component />}
{condition ? <ComponentA /> : <ComponentB />}
```

### Hook usage pattern:

```javascript
const {
  // Destructure what you need
  state1,
  state2,
  action1,
  action2
} = useMyHook();
```
