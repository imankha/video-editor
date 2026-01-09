# TASK-07: Final App.jsx Cleanup

## Objective
Remove all dead code from App.jsx, leaving only mode routing and shared modal rendering. Target: **~100-150 lines**.

## Prerequisites
Complete Tasks 01-06 first. Each screen must be self-contained before this cleanup.

---

## Current App.jsx Structure (2181 lines)

After Tasks 01-06, the following will be obsolete:

| Section | Lines | Status After Tasks |
|---------|-------|-------------------|
| Hook imports | ~50 | Most removed (moved to screens) |
| useState declarations | ~50 | Most removed |
| Hook calls (useVideo, useCrop, etc.) | ~200 | Removed (screens own their hooks) |
| Container calls | ~200 | Removed |
| Project loading callbacks | ~400 | Removed (in ProjectsScreen) |
| Mode switch handlers | ~100 | Simplified |
| Persistence effects | ~150 | Removed (in screens) |
| Derived state (useMemo) | ~100 | Removed |
| Handler functions | ~300 | Removed |
| JSX render | ~500 | Simplified to routing |

---

## Target App.jsx (~100-150 lines)

```jsx
import { useEffect } from 'react';
import { useNavigationStore, useCurrentMode } from './stores/navigationStore';
import { ProjectProvider } from './contexts/ProjectContext';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { AnnotateScreen } from './screens/AnnotateScreen';
import { FramingScreen } from './screens/FramingScreen';
import { OverlayScreen } from './screens/OverlayScreen';
import { DownloadsPanel } from './components/DownloadsPanel';
import { ProjectCreationSettings } from './components/ProjectCreationSettings';
import { ConfirmationDialog } from './components/shared';
import { useGalleryStore } from './stores/galleryStore';
import { useSettingsStore } from './stores/settingsStore';

/**
 * App.jsx - Mode Router
 *
 * This component's ONLY responsibilities:
 * 1. Route to the correct screen based on current mode
 * 2. Render global modals (Gallery, Settings, Confirmations)
 * 3. Provide top-level context providers
 *
 * All mode-specific logic lives in the respective Screen components.
 */
function App() {
  // Current mode from navigation store
  const mode = useCurrentMode();
  const projectId = useNavigationStore(state => state.projectId);

  // Global modal states
  const isGalleryOpen = useGalleryStore(state => state.isOpen);
  const { isOpen: isSettingsOpen, close: closeSettings } = useSettingsStore();

  // Mode switch confirmation (for unsaved changes)
  const {
    isOpen: isConfirmOpen,
    message: confirmMessage,
    onConfirm,
    onCancel,
    close: closeConfirm,
  } = useNavigationStore(state => state.confirmation);

  // Debug: Log mode changes
  useEffect(() => {
    console.log('[App] Mode:', mode, 'Project:', projectId);
  }, [mode, projectId]);

  return (
    <ProjectProvider>
      <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
        {/* Screen Routing */}
        {mode === 'project-manager' && <ProjectsScreen />}
        {mode === 'annotate' && <AnnotateScreen />}
        {mode === 'framing' && <FramingScreen />}
        {mode === 'overlay' && <OverlayScreen />}

        {/* Global Modals */}
        <DownloadsPanel />

        <ProjectCreationSettings
          isOpen={isSettingsOpen}
          onClose={closeSettings}
        />

        <ConfirmationDialog
          isOpen={isConfirmOpen}
          message={confirmMessage}
          onConfirm={() => {
            onConfirm?.();
            closeConfirm();
          }}
          onCancel={() => {
            onCancel?.();
            closeConfirm();
          }}
        />
      </div>
    </ProjectProvider>
  );
}

export default App;
```

---

## Implementation Steps

### Step 1: Verify All Screens Work Independently

Before removing code from App.jsx, verify each screen works:

```bash
# Test each mode independently
cd src/frontend && npm test
cd src/frontend && npx playwright test
```

### Step 2: Create Settings Store (If Not Already)

**File**: `src/frontend/src/stores/settingsStore.js`

```javascript
import { create } from 'zustand';

export const useSettingsStore = create((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
```

### Step 3: Add Confirmation State to Navigation Store

Update `navigationStore.js` to handle mode switch confirmations:

```javascript
// In navigationStore.js
export const useNavigationStore = create((set, get) => ({
  // ... existing state

  // Confirmation dialog state
  confirmation: {
    isOpen: false,
    message: '',
    onConfirm: null,
    onCancel: null,
  },

  // Show confirmation before navigation
  navigateWithConfirmation: (newMode, { message, onConfirm, onCancel } = {}) => {
    set({
      confirmation: {
        isOpen: true,
        message: message || 'Are you sure you want to leave?',
        onConfirm: () => {
          onConfirm?.();
          get().navigate(newMode);
        },
        onCancel,
      },
    });
  },

  closeConfirmation: () => set({
    confirmation: {
      isOpen: false,
      message: '',
      onConfirm: null,
      onCancel: null,
    },
  }),
}));
```

### Step 4: Remove Dead Code from App.jsx

Remove these sections entirely:

1. **Hook imports** that are now in screens:
   - `useVideo`, `useCrop`, `useSegments`
   - `useHighlight`, `useHighlightRegions`
   - `useZoom`, `useTimelineZoom`
   - `useClipManager`, `useProjectClips`
   - Container imports

2. **State declarations** that are now in screens:
   - `videoFile`, `dragCrop`
   - `includeAudio`
   - `framingChangedSinceExport`
   - All refs (`clipHasUserEditsRef`, `pendingFramingSaveRef`, etc.)

3. **Hook calls** that are now in screens:
   - `useVideo()`, `useCrop()`, `useSegments()`
   - `useHighlight()`, `useHighlightRegions()`
   - Container calls (`FramingContainer`, `OverlayContainer`)

4. **Handler functions** that are now in screens:
   - `handleFileSelect`, `handleSelectClip`, `handleDeleteClip`
   - `handleProceedToOverlay`, `handleModeChange`
   - All persistence handlers

5. **Effects** that are now in screens:
   - Segment initialization
   - Highlight region initialization
   - Auto-save effects
   - Trim cleanup effects

6. **Derived state** that is now in screens:
   - `currentCropState`, `currentHighlightState`
   - `selectedCropKeyframeIndex`, `selectedHighlightKeyframeIndex`
   - `getFilteredKeyframesForExport`

### Step 5: Update Remaining JSX

The JSX should be simplified to just:

```jsx
return (
  <ProjectProvider>
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      {mode === 'project-manager' && <ProjectsScreen />}
      {mode === 'annotate' && <AnnotateScreen />}
      {mode === 'framing' && <FramingScreen />}
      {mode === 'overlay' && <OverlayScreen />}

      <DownloadsPanel />
      <ProjectCreationSettings />
      <ConfirmationDialog />
    </div>
  </ProjectProvider>
);
```

### Step 6: Update Imports

Only keep imports that App.jsx actually uses:

```jsx
import { useEffect } from 'react';
import { useNavigationStore, useCurrentMode } from './stores/navigationStore';
import { ProjectProvider } from './contexts/ProjectContext';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { AnnotateScreen } from './screens/AnnotateScreen';
import { FramingScreen } from './screens/FramingScreen';
import { OverlayScreen } from './screens/OverlayScreen';
import { DownloadsPanel } from './components/DownloadsPanel';
import { ProjectCreationSettings } from './components/ProjectCreationSettings';
import { ConfirmationDialog } from './components/shared';
import { useGalleryStore } from './stores/galleryStore';
import { useSettingsStore } from './stores/settingsStore';
```

---

## Verification Checklist

After cleanup, verify:

- [ ] App.jsx is under 150 lines
- [ ] No hook calls for mode-specific state (useVideo, useCrop, etc.)
- [ ] No handler functions for mode-specific actions
- [ ] No persistence effects
- [ ] No derived state calculations
- [ ] All tests pass
- [ ] E2E tests pass
- [ ] Manual smoke test of all modes

```bash
# Run all tests
cd src/frontend && npm test
cd src/frontend && npx playwright test

# Count lines
wc -l src/frontend/src/App.jsx
# Should be ~100-150
```

---

## Manual Smoke Test

1. **Project Manager**
   - Create project
   - Delete project
   - Open existing project

2. **Annotate Mode**
   - Upload game video
   - Mark clips
   - Export clips
   - Load saved game

3. **Framing Mode**
   - Edit crop keyframes
   - Split segments
   - Trim video
   - Export to overlay

4. **Overlay Mode**
   - Add highlight regions
   - Edit keyframes
   - Change effect type
   - Export final video

5. **Gallery**
   - View exported videos
   - Open project from video
   - Delete video

6. **Mode Switching**
   - Switch between framing and overlay
   - Verify unsaved changes warning
   - Verify state persists

---

## Files Changed
- `src/frontend/src/App.jsx` (major reduction: 2181 → ~150 lines)
- `src/frontend/src/stores/settingsStore.js` (new)
- `src/frontend/src/stores/navigationStore.js` (add confirmation)
- `src/frontend/src/stores/index.js` (update exports)

## Commit Message
```
refactor: Reduce App.jsx to pure mode router

- Remove all mode-specific hooks and state from App.jsx
- Remove all handler functions (now in screens)
- Remove all persistence effects (now in screens)
- App.jsx now only handles mode routing and global modals
- Reduction: 2181 lines → ~150 lines (93% reduction)
```

---

## Success Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| App.jsx lines | 2181 | ~150 | ≤150 |
| Hook calls in App.jsx | 15+ | 3 | ≤5 |
| State variables | 20+ | 0 | 0 |
| Handler functions | 25+ | 0 | 0 |
| Props to FramingScreen | 50+ | 0 | 0 |
| Props to OverlayScreen | 60+ | 0 | 0 |

---

## Architecture Summary

After all tasks complete:

```
App.jsx (~150 lines)
├── Mode routing only
├── Global modals
└── Top-level providers

ProjectsScreen (~300 lines)
├── useProjects, useGames
├── useProjectLoader
└── Project selection UI

AnnotateScreen (~500 lines)
├── AnnotateContainer
├── useGames (internal)
└── Full annotate workflow

FramingScreen (~400 lines)
├── useVideo, useCrop, useSegments (internal)
├── FramingContainer
└── Full framing workflow

OverlayScreen (~400 lines)
├── useVideo, useHighlightRegions (internal)
├── OverlayContainer
└── Full overlay workflow

Stores (shared state)
├── navigationStore - Mode routing
├── projectDataStore - Loaded project data
├── framingStore - Framing persistence
├── overlayStore - Overlay persistence
└── galleryStore - Downloads panel
```

This architecture follows:
- **Loose Coupling**: Screens don't know about each other
- **Tight Cohesion**: Related state/logic grouped in screens
- **DRY**: Shared code in stores and hooks
