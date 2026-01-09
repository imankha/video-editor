# TASK-05: Finalize AnnotateScreen

## Objective
Complete the AnnotateScreen self-containment by removing remaining dependencies on App.jsx.

## Current State
AnnotateScreen is already mostly self-contained. App.jsx passes:

```jsx
// App.jsx lines 1898-1924
<AnnotateScreen
  onNavigate={setEditorMode}
  onBackToProjects={() => setEditorMode('project-manager')}
  onOpenProjectCreationSettings={() => setShowProjectCreationSettings(true)}
  downloadsCount={downloadsCount}
  onOpenDownloads={() => setIsDownloadsPanelOpen(true)}
  initialFile={pendingAnnotateFile}
  onInitialFileHandled={() => setPendingAnnotateFile(null)}
  initialGameId={pendingGameId}
  onInitialGameHandled={() => setPendingGameId(null)}
  createGame={createGame}
  uploadGameVideo={uploadGameVideo}
  getGame={getGame}
  getGameVideoUrl={getGameVideoUrl}
  saveAnnotationsDebounced={saveAnnotationsDebounced}
  fetchProjects={fetchProjects}
  projectCreationSettings={projectCreationSettings}
/>
```

## Remaining Issues

1. **Navigation props** - Should use navigation store
2. **Initial file/game via props** - Should use sessionStorage or store
3. **Games hooks passed as props** - Should be internal
4. **Downloads count/handler** - Should use store or context
5. **Project creation settings** - Should be internal or global context

---

## Implementation Steps

### Step 1: Use Navigation Store

Replace navigation props with store:

```jsx
// Before
onNavigate={setEditorMode}
onBackToProjects={() => setEditorMode('project-manager')}

// After (in AnnotateScreen)
const navigate = useNavigationStore(state => state.navigate);
// Use navigate('project-manager') directly
```

### Step 2: Handle Initial Data via Storage

**Current approach** (props):
```jsx
initialFile={pendingAnnotateFile}
onInitialFileHandled={() => setPendingAnnotateFile(null)}
initialGameId={pendingGameId}
onInitialGameHandled={() => setPendingGameId(null)}
```

**New approach** (sessionStorage + store):

```javascript
// When user clicks "Annotate Game" in ProjectManager
sessionStorage.setItem('pendingGameId', gameId);
navigate('annotate');

// In AnnotateScreen
useEffect(() => {
  const pendingGameId = sessionStorage.getItem('pendingGameId');
  if (pendingGameId) {
    sessionStorage.removeItem('pendingGameId');
    loadGame(parseInt(pendingGameId));
  }
}, []);
```

### Step 3: Internalize Games Hooks

Move games hook usage inside AnnotateScreen:

```jsx
// Before (props from App.jsx)
createGame={createGame}
uploadGameVideo={uploadGameVideo}
getGame={getGame}

// After (internal)
function AnnotateScreen() {
  const {
    createGame,
    uploadGameVideo,
    getGame,
    getGameVideoUrl,
    saveAnnotationsDebounced,
  } = useGames();
  // ...
}
```

### Step 4: Update AnnotateScreen

**File**: `src/frontend/src/screens/AnnotateScreen.jsx`

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { useGames } from '../hooks/useGames';
import { useProjects } from '../hooks/useProjects';
import { useSettings } from '../hooks/useSettings';
import { useDownloads } from '../hooks/useDownloads';
import { AnnotateContainer } from '../containers/AnnotateContainer';
import { AnnotateModeView } from '../modes/AnnotateModeView';
import { ClipsSidePanel } from '../components/annotate/ClipsSidePanel';
import { DownloadsPanel } from '../components/DownloadsPanel';
import { ProjectCreationSettings } from '../components/ProjectCreationSettings';

export function AnnotateScreen() {
  // Navigation
  const navigate = useNavigationStore(state => state.navigate);

  // Games - OWNED BY THIS SCREEN
  const {
    createGame,
    uploadGameVideo,
    getGame,
    getGameVideoUrl,
    saveAnnotationsDebounced,
  } = useGames();

  // Projects (for import/export)
  const { fetchProjects } = useProjects();

  // Settings
  const {
    projectCreationSettings,
    updateProjectCreationSettings,
    resetSettings,
  } = useSettings();

  // Downloads
  const { count: downloadsCount, fetchCount: refreshDownloadsCount } = useDownloads();

  // Local UI state
  const [isDownloadsPanelOpen, setIsDownloadsPanelOpen] = useState(false);
  const [showProjectCreationSettings, setShowProjectCreationSettings] = useState(false);

  // =========================================
  // INITIAL DATA HANDLING
  // =========================================

  // Check for pending game ID on mount
  useEffect(() => {
    const pendingGameId = sessionStorage.getItem('pendingGameId');
    if (pendingGameId) {
      sessionStorage.removeItem('pendingGameId');
      // Will be handled by AnnotateContainer
      setInitialGameId(parseInt(pendingGameId));
    }
  }, []);

  // Check for pending file (from file picker)
  useEffect(() => {
    // File handling would require more complex approach
    // For now, keep file input in ProjectsScreen
  }, []);

  const [initialGameId, setInitialGameId] = useState(null);

  // =========================================
  // CONTAINER
  // =========================================

  // AnnotateContainer handles all annotate mode state and logic
  const annotate = AnnotateContainer({
    // Games API
    createGame,
    uploadGameVideo,
    getGame,
    getGameVideoUrl,
    saveAnnotationsDebounced,
    // Initial game to load
    initialGameId,
    onInitialGameHandled: () => setInitialGameId(null),
    // Projects
    fetchProjects,
    projectCreationSettings,
  });

  // Destructure container values
  const {
    // Video state
    annotateVideoRef,
    annotateVideoUrl,
    annotateVideoMetadata,
    isAnnotateVideoLoading,
    annotateCurrentTime,
    annotateDuration,
    annotateIsPlaying,
    // Clip regions
    clipRegions,
    selectedRegionId,
    // Handlers
    handleGameVideoSelect,
    handleLoadGame,
    handleCreateAnnotatedVideo,
    handleImportIntoProjects,
    handleAddClipFromButton,
    // ... other container exports
  } = annotate;

  // =========================================
  // HANDLERS
  // =========================================

  const handleBackToProjects = useCallback(() => {
    // Save any pending changes
    annotate.flushPendingSaves?.();
    navigate('project-manager');
  }, [annotate, navigate]);

  // =========================================
  // RENDER
  // =========================================

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Sidebar */}
      <ClipsSidePanel
        clips={clipRegions}
        selectedClipId={selectedRegionId}
        onSelectClip={annotate.handleSelectAnnotateRegion}
        onAddClip={handleAddClipFromButton}
        // ... other props
      />

      {/* Main content */}
      <div className="flex-1">
        <AnnotateModeView
          // Video
          videoRef={annotateVideoRef}
          videoUrl={annotateVideoUrl}
          metadata={annotateVideoMetadata}
          currentTime={annotateCurrentTime}
          duration={annotateDuration}
          isPlaying={annotateIsPlaying}
          isLoading={isAnnotateVideoLoading}
          // Annotate state
          annotate={annotate}
          // Downloads
          downloadsCount={downloadsCount}
          onOpenDownloads={() => setIsDownloadsPanelOpen(true)}
          // Settings
          onOpenProjectCreationSettings={() => setShowProjectCreationSettings(true)}
          // Navigation
          onBackToProjects={handleBackToProjects}
        />
      </div>

      {/* Modals */}
      <DownloadsPanel
        isOpen={isDownloadsPanelOpen}
        onClose={() => setIsDownloadsPanelOpen(false)}
        onOpenProject={(projectId) => {
          navigate('overlay');
          // Set project ID in navigation store
          useNavigationStore.getState().setProjectId(projectId);
        }}
        onCountChange={refreshDownloadsCount}
      />

      <ProjectCreationSettings
        isOpen={showProjectCreationSettings}
        onClose={() => setShowProjectCreationSettings(false)}
        settings={projectCreationSettings}
        onUpdateSettings={updateProjectCreationSettings}
        onReset={resetSettings}
      />
    </div>
  );
}
```

### Step 5: Update App.jsx Integration

After this task, App.jsx only needs:

```jsx
{mode === 'annotate' && <AnnotateScreen />}
```

No props required!

---

## Data Flow

### Loading a Saved Game
```
ProjectsScreen                    AnnotateScreen
      |                                |
      | (click game)                   |
      |                                |
      v                                |
sessionStorage.set('pendingGameId')    |
      |                                |
      | navigate('annotate')           |
      |                                |
      |                                v
      |                     useEffect reads sessionStorage
      |                                |
      |                                v
      |                     AnnotateContainer.loadGame()
```

### Creating New Game
```
ProjectsScreen                    AnnotateScreen
      |                                |
      | (click Annotate Game)          |
      |                                v
      | navigate('annotate')    AnnotateScreen shows file picker
      |                                |
      |                                v
      |                     User selects file
      |                                |
      |                                v
      |                     createGame() + uploadGameVideo()
```

---

## Files Changed
- `src/frontend/src/screens/AnnotateScreen.jsx` (update)
- `src/frontend/src/App.jsx` (simplify - remove annotate props)

## Verification
```bash
cd src/frontend && npm test
cd src/frontend && npx playwright test "Annotate"
```

## Manual Testing
1. From Projects, click "Annotate Game"
2. Upload video, mark clips
3. Export clips
4. Load saved game from Projects
5. Verify all functionality works

## Commit Message
```
refactor: Finalize AnnotateScreen self-containment

- Remove navigation props, use navigationStore
- Handle initial game ID via sessionStorage
- Internalize useGames hook
- Internalize settings and downloads hooks
- AnnotateScreen now requires no props from App.jsx
```
