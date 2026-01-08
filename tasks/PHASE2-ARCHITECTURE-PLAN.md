# Phase 2: Make App.jsx Bare Bones

## Progress Status (Updated 2026-01-06)

| Task | Status | Notes |
|------|--------|-------|
| 1. Create navigation abstraction | ✅ Complete | Added `SCREENS`, `getScreenByType`, `navigateTo` to editorStore |
| 2. Create FramingScreen | ✅ Complete | `screens/FramingScreen.jsx` - owns useCrop, useSegments, useZoom |
| 3. Create OverlayScreen | ✅ Complete | `screens/OverlayScreen.jsx` - owns useHighlight, useHighlightRegions |
| 4. Create AnnotateScreen | ✅ Complete | `screens/AnnotateScreen.jsx` - SINGLE SOURCE OF TRUTH for annotate state |
| 5. Create ProjectsScreen | ✅ Complete | `screens/ProjectsScreen.jsx` - wraps ProjectManager |
| 6. Fix duplicate state issue | ✅ Complete | Removed AnnotateContainer from App.jsx |
| 7. Move keyboard shortcuts to AnnotateScreen | ✅ Complete | AnnotateScreen now handles its own keyboard events |
| 8. Add header to AnnotateScreen | ✅ Complete | Tests can now find "Annotate Game" heading |
| 9. Configure Playwright reporting | ✅ Complete | JSON + HTML reporters, artifacts in test-results/ |
| 10. Verify E2E tests | 🔄 Partial | 2/18 passed, 1 failed (404), rest didn't run |

---

## 🚨 CURRENT STATE FOR NEXT AI

### Latest Test Results (Manual Run by User)
```
Test 1: PASSED - Project Manager loads correctly
Test 2: PASSED - Annotate Mode - Upload video and import TSV
Test 3: FAILED - Annotations not loading when loading saved game
Tests 4-18: DID NOT RUN (stopped after failure)
```

### Fix Applied (2026-01-06): Race Condition in Annotation Loading

**Root Cause**: When loading a saved game, there was a race condition:
1. `resetAnnotate()` sets `duration = null`
2. `setAnnotateVideoMetadata(metadata)` queues state update (async)
3. `importAnnotations(annotations)` sees `duration = null`, queues annotations
4. By the time re-render happens, the queued annotations weren't processed reliably

**Fix Applied**:
- Modified `importAnnotations` in [useAnnotate.js](src/frontend/src/modes/annotate/hooks/useAnnotate.js) to accept an optional `overrideDuration` parameter
- Modified `handleLoadGame` in [AnnotateContainer.jsx](src/frontend/src/containers/AnnotateContainer.jsx) to pass the known duration directly

**Code Changes**:
```javascript
// useAnnotate.js - importAnnotations now accepts optional duration
const importAnnotations = useCallback((annotations, overrideDuration = null) => {
  const effectiveDuration = overrideDuration ?? duration;
  // ...
});

// AnnotateContainer.jsx - pass duration when loading saved game
const gameDuration = videoMetadata?.duration || gameData.video_duration;
importAnnotations(gameData.annotations, gameDuration);
```

### To Verify Fix:
1. Run the E2E tests: `cd src/frontend && npx playwright test --reporter=line`
2. Or test manually: Load a saved game from Games tab, verify clips appear

---

## Changes Made This Session (2026-01-06)

### 1. Eliminated Duplicate AnnotateContainer State

**Root Cause Identified**: App.jsx and AnnotateScreen both called `AnnotateContainer()` separately, creating two independent state instances. This caused:
- Keyboard shortcuts in App.jsx operating on state A
- UI in AnnotateScreen operating on state B
- States getting out of sync during E2E tests

**Fix Applied**:

**App.jsx** - Removed AnnotateContainer entirely:
```jsx
// REMOVED this import:
// import { AnnotateContainer } from './containers';

// REMOVED this call:
// const annotate = AnnotateContainer({ ... });

// App.jsx now ONLY passes props to AnnotateScreen
// It does NOT call AnnotateContainer
```

### 2. Added Game Loading Handoff Pattern

**File: App.jsx**
```jsx
// New state for game loading
const [pendingGameId, setPendingGameId] = useState(null);

const handleLoadGame = useCallback((gameId) => {
  console.log('[App] Loading game - setting pendingGameId:', gameId);
  setPendingGameId(gameId);
  setEditorMode('annotate');
}, [setEditorMode]);

// Passed to AnnotateScreen:
<AnnotateScreen
  initialGameId={pendingGameId}
  onInitialGameHandled={() => setPendingGameId(null)}
  // ... other props
/>
```

**File: AnnotateScreen.jsx** - Receives and handles the game ID:
```jsx
export function AnnotateScreen({
  // ...
  initialGameId,
  onInitialGameHandled,
  // ...
}) {
  // Handle initial game ID from ProjectManager (when loading a saved game)
  useEffect(() => {
    if (initialGameId && !annotateVideoUrl) {
      console.log('[AnnotateScreen] Loading game from initialGameId:', initialGameId);
      handleLoadGame(initialGameId);
      onInitialGameHandled?.();
    }
  }, [initialGameId]); // Minimal deps to avoid re-triggering
```

### 3. Moved Keyboard Shortcuts to AnnotateScreen

**File: AnnotateScreen.jsx** - Now handles its own keyboard events:
```jsx
// Keyboard shortcuts for annotate mode
// These are handled here (not in App.jsx) to use the same state instance
useEffect(() => {
  const handleKeyDown = (event) => {
    const tagName = event.target?.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') return;

    // Space bar: Toggle play/pause
    if (event.code === 'Space' && annotateVideoUrl) {
      event.preventDefault();
      togglePlay();
      return;
    }

    // Arrow keys: Navigate playhead or clips
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      // ... navigation logic
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [annotateVideoUrl, annotateSelectedLayer, clipRegions, /* ... */]);
```

**File: App.jsx** - Now passes null for annotate props to useKeyboardShortcuts:
```jsx
useKeyboardShortcuts({
  hasVideo: Boolean(videoUrl || effectiveOverlayVideoUrl) || editorMode === 'annotate',
  // ... other props
  // Annotate mode props - keyboard handling is now in AnnotateScreen
  annotateVideoUrl: null,
  annotateSelectedLayer: null,
  clipRegions: [],
  annotateSelectedRegionId: null,
  selectAnnotateRegion: null,
});
```

### 4. Fixed Cleanup useEffect Running Too Often

**Problem**: `clearAnnotateState` function reference changed between renders, causing cleanup to run incorrectly.

**File: AnnotateScreen.jsx** - Fixed with ref pattern:
```jsx
// Cleanup on unmount - use ref to avoid running on every re-render
const clearStateRef = useRef(clearAnnotateState);
clearStateRef.current = clearAnnotateState;

useEffect(() => {
  // Empty deps = only runs cleanup on actual unmount
  return () => {
    console.log('[AnnotateScreen] Unmounting - clearing state');
    clearStateRef.current();
  };
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

### 5. Added Header to AnnotateScreen

**Problem**: Tests couldn't find `h1:has-text("Annotate Game")` because the header was inside App.jsx's `{editorMode !== 'annotate'}` block.

**File: AnnotateScreen.jsx** - Added header:
```jsx
return (
  <>
    <ClipsSidePanel ... />
    <div className="flex-1 overflow-auto">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button onClick={onBackToProjects} className="px-4 py-2 bg-gray-700...">
              ← Projects
            </button>
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Annotate Game</h1>
              <p className="text-gray-400">Mark clips to extract from your game footage</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={onOpenDownloads} className="...">
              Gallery {downloadsCount > 0 && `(${downloadsCount})`}
            </button>
          </div>
        </div>
        <AnnotateModeView ... />
      </div>
    </div>
  </>
);
```

---

## ✅ Playwright Configured for AI-Readable Results

**Configuration in `src/frontend/playwright.config.js`:**

```javascript
reporter: [
  ['html', { outputFolder: 'test-results/html' }],
  ['json', { outputFile: 'test-results/results.json' }],
  ['list'],
],
outputDir: 'test-results/artifacts',
use: {
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
},
```

### How to Share Test Results with AI

After running tests (`npx playwright test`), share these files:

1. **For quick summary**: Read `src/frontend/test-results/results.json`
2. **For detailed debugging**: Screenshots in `test-results/artifacts/`
3. **Example workflow**:
   ```bash
   cd src/frontend
   npx playwright test
   # Then share: test-results/results.json
   ```

---

## Architecture: Single Source of Truth Pattern

### AnnotateScreen is THE authority for annotate state

```
App.jsx (routing only)
├── Does NOT call AnnotateContainer
├── Manages pendingAnnotateFile and pendingGameId
├── Passes these to AnnotateScreen
└── Renders AnnotateScreen when editorMode === 'annotate'

AnnotateScreen.jsx (SINGLE SOURCE OF TRUTH)
├── Calls AnnotateContainer() - THE ONLY PLACE THIS IS CALLED
├── Owns all annotate state
├── Handles keyboard shortcuts internally
├── Handles initialFile and initialGameId
└── Renders ClipsSidePanel + AnnotateModeView
```

### File Handoff Pattern

When user selects a file or game to load:
1. App.jsx sets `pendingAnnotateFile` or `pendingGameId`
2. App.jsx sets `editorMode = 'annotate'`
3. AnnotateScreen mounts and receives the pending values
4. AnnotateScreen handles them in useEffect
5. AnnotateScreen calls `onInitialFileHandled()` or `onInitialGameHandled()` to clear pending state

---

## Key Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/frontend/src/App.jsx` | ~2173 | Main app, routing, shared state |
| `src/frontend/src/screens/AnnotateScreen.jsx` | ~376 | Self-contained annotate mode |
| `src/frontend/src/screens/FramingScreen.jsx` | ~469 | Self-contained framing mode |
| `src/frontend/src/screens/OverlayScreen.jsx` | ~300 | Self-contained overlay mode |
| `src/frontend/src/screens/ProjectsScreen.jsx` | ~83 | Self-contained projects view |
| `src/frontend/src/containers/AnnotateContainer.jsx` | ~500 | Annotate state/handlers (NOT a React component) |
| `src/frontend/src/hooks/useKeyboardShortcuts.js` | ~223 | Consolidated keyboard handler |

---

## Next Steps for AI

### Priority 1: Fix the 404 Error in Test 3

1. Run the backend server and frontend
2. Run test 3 specifically: `npx playwright test "Export TSV round-trip" --reporter=line`
3. Check browser console and network tab for the 404
4. The 404 is likely in:
   - Video URL becoming invalid after export
   - API endpoint `/api/games/...` not found
   - Backend not handling a specific request

### Priority 2: Continue App.jsx Reduction

Current: ~2173 lines, Target: ~150 lines

Remaining work:
- Move more hook calls into screens
- Remove unused imports
- Simplify mode-specific logic

### Priority 3: Run All E2E Tests

Once test 3 is fixed:
```bash
cd src/frontend
npx playwright test --reporter=line
```

---

## Common Debugging Commands

```bash
# Start backend
cd src/backend && .venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000

# Start frontend
cd src/frontend && npm run dev

# Run all E2E tests
cd src/frontend && npx playwright test

# Run specific test
cd src/frontend && npx playwright test "Export TSV round-trip" --reporter=line

# Run tests with UI (debug mode)
cd src/frontend && npx playwright test --ui

# Check test list
cd src/frontend && npx playwright test --list
```

---

## Port Allocation (Simplified)

| Purpose | Backend Port | Frontend Port |
|---------|--------------|---------------|
| Dev (manual product testing) | 8000 | 5173 |
| E2E tests (user or AI) | 8001 | 5174 |

### How E2E Server Startup Works

**Servers auto-start by default.** When you run `npx playwright test`:
- If ports 8001/5174 are free → Playwright starts fresh servers
- If servers already running on 8001/5174 → Playwright reuses them

This means:
- **You can keep dev servers running on 8000/5173** - no conflicts!
- **Both user and AI run E2E the same way** - just `npx playwright test`
- **No environment variables needed** - `MANUAL_SERVERS` has been removed

### If Tests Hang (Port Already in Use)

If a previous test run left zombie processes:

```bash
# Kill processes on E2E ports (Windows PowerShell)
powershell -Command "Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
powershell -Command "Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
```

**NEVER** use hardcoded process IDs like `Stop-Process -Id 451196` - these are stale from previous runs.

---

## Test File Location

E2E tests are in: `src/frontend/e2e/full-workflow.spec.js`

Test structure:
- Full Workflow Tests (6 tests)
- Clip Editing Tests (2 tests)
- UI Component Tests (2 tests)
- API Integration Tests (6 tests)
- Game Loading Debug (2 tests in separate file)

---

## Notes for Context

### Why AnnotateContainer is NOT a React Component

`AnnotateContainer` is a function that returns an object of state and handlers. It's called like a hook but isn't one. This pattern was used to group related state but causes confusion:

```jsx
// AnnotateContainer is called like this:
const annotate = AnnotateContainer({ videoRef, currentTime, ... });

// It returns an object:
const { annotateVideoUrl, handleGameVideoSelect, ... } = annotate;
```

This is why calling it in multiple places created duplicate state - each call creates fresh useState instances.

### The "Broken State" Issue

After export, the app sometimes enters a "broken state" where:
- Purple background visible
- Only "Annotate" button shown
- Video element missing

This happens when `annotateVideoUrl` becomes null/undefined unexpectedly. The `clearAnnotateState` function is the main suspect - it should only run on unmount.
