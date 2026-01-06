# Task 07: Final Cleanup and App.jsx Simplification

## Goal
After Tasks 01-06, clean up App.jsx to be a minimal mode router (~150-200 lines)

## Impact
- **Final App.jsx size**: ~150-200 lines
- **Risk level**: Low (cleanup only)

## Prerequisites
- Tasks 01-06 completed and verified

## Remaining Items in App.jsx

After previous tasks, App.jsx should only contain:

1. **Store initialization** (~20 lines)
   - useEditorStore
   - useExportStore

2. **Container calls** (~50 lines)
   - AnnotateContainer
   - OverlayContainer
   - FramingContainer

3. **Mode routing** (~30 lines)
   - Conditional rendering based on editorMode

4. **Shared modals** (~30 lines)
   - DownloadsPanel
   - ProjectCreationSettings
   - ConfirmationDialog

5. **Providers wrapper** (~20 lines)
   - AppStateProvider

## Target App.jsx Structure

```jsx
import { useEditorStore, useExportStore } from './stores';
import { AnnotateContainer, OverlayContainer, FramingContainer } from './containers';
import { FramingModeView, OverlayModeView, AnnotateModeView } from './modes';
import { ProjectManager } from './components/ProjectManager';
import { AppStateProvider } from './contexts';
// ... modal imports

function App() {
  // 1. Store state
  const { editorMode } = useEditorStore();

  // 2. Container initialization (hooks that manage mode-specific state)
  const annotate = AnnotateContainer({ /* minimal props */ });
  const overlay = OverlayContainer({ /* minimal props */ });
  const framing = FramingContainer({ /* minimal props */ });

  // 3. Mode routing
  return (
    <AppStateProvider>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        {/* Header */}
        <Header />

        {/* Mode-specific views */}
        {editorMode === 'project-manager' && <ProjectManager />}
        {editorMode === 'framing' && <FramingModeView {...framing} />}
        {editorMode === 'overlay' && <OverlayModeView {...overlay} />}
        {editorMode === 'annotate' && <AnnotateModeView {...annotate} />}

        {/* Shared modals */}
        <DownloadsPanel />
        <ProjectCreationSettings />
        <ConfirmationDialog />
      </div>
    </AppStateProvider>
  );
}
```

## Cleanup Steps

### Step 1: Extract Header component

If not already done, extract the header/navigation into its own component:
```jsx
// src/frontend/src/components/Header.jsx
export function Header({ editorMode, onModeChange }) {
  // Mode tabs, project info, etc.
}
```

### Step 2: Remove unused imports

After moving code out, many imports in App.jsx will be unused. Remove them:
```jsx
// Remove these if no longer used directly in App.jsx:
import { useCrop, useSegments } from './modes/framing';
import { useHighlight, useHighlightRegions } from './modes/overlay';
// etc.
```

### Step 3: Remove dead code

Check for any handlers or state that are no longer used after the refactor.

### Step 4: Verify container prop spreading

Ensure containers return all needed props and mode views consume them:
```jsx
// If containers return the right shape, can use spread:
<FramingModeView {...framing} />

// Otherwise, explicit prop passing:
<FramingModeView
  videoUrl={framing.videoUrl}
  currentTime={framing.currentTime}
  // ...
/>
```

### Step 5: Document the architecture

Add a comment at the top of App.jsx explaining the architecture:
```jsx
/**
 * App.jsx - Mode Router
 *
 * This file is intentionally minimal. The app is organized as:
 *
 * - Containers (hooks) manage mode-specific state and handlers
 *   @see containers/FramingContainer.jsx
 *   @see containers/OverlayContainer.jsx
 *   @see containers/AnnotateContainer.jsx
 *
 * - Mode Views render the complete UI for each mode
 *   @see modes/FramingModeView.jsx
 *   @see modes/OverlayModeView.jsx
 *   @see modes/AnnotateModeView.jsx
 *
 * - Stores provide global state
 *   @see stores/editorStore.js
 *   @see stores/exportStore.js
 *
 * To make changes:
 * - Framing mode: Edit FramingContainer.jsx or FramingModeView.jsx
 * - Overlay mode: Edit OverlayContainer.jsx or OverlayModeView.jsx
 * - Annotate mode: Edit AnnotateContainer.jsx or AnnotateModeView.jsx
 */
```

## Verification Checklist

- [ ] App.jsx is ~150-200 lines
- [ ] All imports are used
- [ ] No dead code remains
- [ ] Architecture is documented
- [ ] No TypeScript/ESLint errors
- [ ] Run: `cd src/frontend && npm test` - all tests pass
- [ ] Run: `cd src/frontend && npx playwright test` - all E2E tests pass
- [ ] Manual test: All modes work correctly

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| App.jsx lines | 3401 | ~150-200 |
| Lines to read for framing change | 3401 | ~500 (FramingModeView) |
| Lines to read for overlay change | 3401 | ~400 (OverlayModeView) |
| Lines to read for annotate change | 3401 | ~400 (AnnotateModeView) |

## Rollback

If any issues, revert all changes:
```bash
git checkout .
```

Or revert specific files as needed.
