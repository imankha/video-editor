# App.jsx Decomposition Analysis

## Quick Context for New AI Sessions

### What is this app?
A video editor with 4 modes:
- **Project Manager**: Select/create projects and games
- **Framing Mode**: Crop, trim, speed adjust video clips
- **Overlay Mode**: Add highlight effects to players
- **Annotate Mode**: Mark clips in game footage for extraction

### Current Architecture (already completed)
Previous refactoring created:
- **Zustand Stores**: `editorStore.js`, `exportStore.js`, `videoStore.js`, `clipStore.js`
- **Containers**: Hook-like functions that manage mode-specific state (NOT React components)
  - `AnnotateContainer.jsx` (~900 lines) - annotate state/handlers
  - `OverlayContainer.jsx` (~600 lines) - overlay state/handlers
  - `FramingContainer.jsx` (~800 lines) - framing state/handlers
- **Extracted Hooks**: `useKeyboardShortcuts.js`, `useExportWebSocket.js`

### The Container Pattern
Containers are **functions that return objects**, not components:
```jsx
// Usage in App.jsx:
const annotate = AnnotateContainer({ videoRef, currentTime, ... });
const { annotateVideoUrl, handleCreateAnnotatedVideo, ... } = annotate;
```

### Key Files
```
src/frontend/src/
├── App.jsx              (3401 lines - THIS IS WHAT WE'RE SPLITTING)
├── containers/
│   ├── AnnotateContainer.jsx
│   ├── OverlayContainer.jsx
│   └── FramingContainer.jsx
├── stores/
│   ├── editorStore.js   (editorMode, selectedLayer)
│   └── exportStore.js   (exportProgress)
├── hooks/
│   ├── useVideo.js      (video playback)
│   ├── useClipManager.js (multi-clip management)
│   ├── useProjects.js   (project CRUD)
│   └── useGames.js      (game management)
└── modes/
    ├── framing/         (useCrop, useSegments, FramingMode component)
    ├── overlay/         (useHighlight, OverlayMode component)
    └── annotate/        (AnnotateMode, AnnotateControls components)
```

---

## Testing Requirement

> **IMPORTANT**: After completing each task, run all tests and fix any failures before proceeding:
> ```bash
> # Frontend unit tests
> cd src/frontend && npm test
>
> # E2E tests
> cd src/frontend && npx playwright test
> ```
> Do not proceed to the next task until all tests pass.

---

## Current State: 2530 lines (after refactoring from 3401)

### Structure Breakdown

| Section | Lines | What It Does |
|---------|-------|--------------|
| Imports + State declarations | 1-200 | 15+ hooks, 20+ state variables |
| Container initializations | 385-662 | Call containers, destructure ~60 values |
| Derived state (useMemo) | 667-777 | clipsWithCurrentState (90 lines alone) |
| Handler functions | 783-2100 | ~1300 lines of handlers |
| useEffect hooks | scattered | ~200 lines total |
| JSX render | 2500-3400 | ~900 lines of JSX |

### Why It's Still 3400 Lines

The containers (AnnotateContainer, OverlayContainer, FramingContainer) extract **mode-specific logic**, but App.jsx still contains:

1. **Orchestration glue** - Connecting containers to each other
2. **Cross-mode transitions** - handleProceedToOverlay, handleModeChange
3. **Shared state management** - videoFile, dragCrop, clipHasUserEditsRef
4. **All JSX rendering** - Even mode-specific JSX lives here
5. **Handler definitions** - Many handlers defined in App.jsx, not containers

---

## Task List

Each task has a detailed file in the `refactor-tasks/` folder.

| Task | Description | Impact | Status | Detailed Instructions |
|------|-------------|--------|--------|----------------------|
| 01 | Extract FramingModeView | -500 lines | ✅ Complete | [TASK-01](refactor-tasks/TASK-01-extract-framing-mode-view.md) |
| 02 | Extract AnnotateModeView | -400 lines | ✅ Complete | [TASK-02](refactor-tasks/TASK-02-extract-annotate-mode-view.md) |
| 03 | Extract OverlayModeView | -400 lines | ✅ Complete | [TASK-03](refactor-tasks/TASK-03-extract-overlay-mode-view.md) |
| 04 | Move handleTrimSegment | -200 lines | ✅ Complete | [TASK-04](refactor-tasks/TASK-04-move-trim-handler-to-container.md) |
| 05 | Move clipsWithCurrentState | -90 lines | ✅ Complete | [TASK-05](refactor-tasks/TASK-05-move-clips-with-state-to-container.md) |
| 06 | Move Copy/Paste Handlers | -50 lines | ✅ Complete | [TASK-06](refactor-tasks/TASK-06-move-copy-paste-handlers.md) |
| 07 | Final Cleanup | verify ~150 lines | ✅ Complete | [TASK-07](refactor-tasks/TASK-07-final-cleanup.md) |

**Refactoring Complete!** Total reduction: 871 lines (25.6% reduction from 3401 to 2530 lines).

> **Update this table** as tasks are completed: ⬜ Not Started → 🔄 In Progress → ✅ Complete

---

## Proposed Architecture: "Mode Router" Pattern

### Goal: Each mode is a self-contained component

```
src/frontend/src/
├── App.jsx                     (~150 lines)  # Just mode routing
├── modes/
│   ├── FramingModeView.jsx     (~500 lines)  # Framing complete view
│   ├── OverlayModeView.jsx     (~400 lines)  # Overlay complete view
│   └── AnnotateModeView.jsx    (~400 lines)  # Annotate complete view
├── containers/
│   ├── FramingContainer.jsx    (~1000 lines) # Framing state/handlers
│   ├── OverlayContainer.jsx    (~700 lines)  # Overlay state/handlers
│   └── AnnotateContainer.jsx   (~1000 lines) # Annotate state/handlers
└── stores/
    ├── editorStore.js          (exists)
    ├── exportStore.js          (exists)
    ├── videoStore.js           (exists)
    └── clipStore.js            (exists)
```

### App.jsx After Refactor (~150 lines)

```jsx
function App() {
  const { editorMode } = useEditorStore();

  // Initialize containers (hooks)
  const annotate = AnnotateContainer({ /* props */ });
  const overlay = OverlayContainer({ /* props */ });
  const framing = FramingContainer({ /* props */ });

  return (
    <AppStateProvider>
      {editorMode === 'project-manager' && <ProjectManager />}
      {editorMode === 'framing' && <FramingModeView {...framing} />}
      {editorMode === 'overlay' && <OverlayModeView {...overlay} />}
      {editorMode === 'annotate' && <AnnotateModeView {...annotate} />}

      {/* Shared modals */}
      <DownloadsPanel />
      <ProjectCreationSettings />
      <ConfirmationDialog />
    </AppStateProvider>
  );
}
```

---

## Execution Order

### Phase 1: Extract Mode Views (Tasks 01-03)
**Impact: -1300 lines from App.jsx**

1. **Task 01**: Extract FramingModeView
   - Create `src/frontend/src/modes/FramingModeView.jsx`
   - Move all framing-specific JSX
   - Run tests, fix issues
   - Commit

2. **Task 02**: Extract AnnotateModeView
   - Create `src/frontend/src/modes/AnnotateModeView.jsx`
   - Move all annotate-specific JSX
   - Run tests, fix issues
   - Commit

3. **Task 03**: Extract OverlayModeView
   - Create `src/frontend/src/modes/OverlayModeView.jsx`
   - Move all overlay-specific JSX
   - Run tests, fix issues
   - Commit

**After Phase 1: App.jsx ~2100 lines**

### Phase 2: Move Handlers (Tasks 04-06)
**Impact: -340 lines from App.jsx**

4. **Task 04**: Move handleTrimSegment
   - Move to FramingContainer.jsx
   - Run tests, fix issues
   - Commit

5. **Task 05**: Move clipsWithCurrentState
   - Move to FramingContainer.jsx
   - Run tests, fix issues
   - Commit

6. **Task 06**: Move Copy/Paste Handlers
   - Move to respective containers
   - Run tests, fix issues
   - Commit

**After Phase 2: App.jsx ~1760 lines**

### Phase 3: Final Cleanup (Task 07)

7. **Task 07**: Final Cleanup
   - Remove unused imports
   - Remove dead code
   - Document architecture
   - Run tests, fix issues
   - Commit

**Final Target: App.jsx ~150-200 lines**

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| App.jsx lines | 3401 | ~150-200 |
| Lines to read for framing change | 3401 | ~500 (FramingModeView) |
| Lines to read for overlay change | 3401 | ~400 (OverlayModeView) |
| Lines to read for annotate change | 3401 | ~400 (AnnotateModeView) |
| Total test count | 264+ | 264+ (no regression) |

---

## Trade-offs

### Pros
- **AI context efficiency**: Change to framing? Load only FramingModeView.jsx (~500 lines)
- **Clear boundaries**: Each mode is self-contained
- **Easier testing**: Can test modes in isolation
- **Faster onboarding**: New developer can understand one mode at a time

### Cons
- **More files**: 4 mode files instead of 1 App.jsx
- **Prop drilling initially**: Until stores are fully migrated
- **Some duplication**: VideoPlayer setup repeated in each mode (can extract later)

### Mitigation
- Create shared components for common patterns if needed
- Use Zustand stores to eliminate prop drilling
- Document the pattern clearly

---

## Rollback Strategy

Each task is a separate commit. If issues arise:
1. `git revert <commit>` for the problematic change
2. All previous commits remain stable
3. Tests must pass before each commit

---

## How to Start (New AI Session)

### Step 1: Verify clean state
```bash
cd src/frontend && npm test          # Should pass
cd src/frontend && npx playwright test  # Should pass (18 tests)
```

### Step 2: Check progress
Look at the Task List table above - find the first ⬜ Not Started task.

### Step 3: Read the task file
Open the task file from `refactor-tasks/TASK-XX-*.md` and follow the step-by-step instructions.

### Step 4: After completing a task
1. Run all tests
2. Fix any failures
3. Commit the changes
4. Update the Task List table (⬜ → ✅)
5. Proceed to next task

---

## Handover Notes

If this refactoring is continued by another session:

1. **Read this file first** - It contains the complete plan
2. **Check the Task List table** - Find first incomplete task
3. **Run all tests before starting** - Ensure clean state
4. **Follow the task order** - Tasks are ordered by dependency
5. **Commit after each task** - Enables easy rollback
6. **Update the Task List table** - Mark tasks complete

### Key Files to Understand
- `src/frontend/src/App.jsx` - The file being split (3401 lines)
- `src/frontend/src/containers/` - Mode containers (hook-like functions)
- `src/frontend/src/modes/` - Will contain mode views (created by tasks)
- `refactor-tasks/` - Detailed instructions for each task

### Test Commands
```bash
# Frontend unit tests (264+ tests)
cd src/frontend && npm test

# E2E tests (18 tests)
cd src/frontend && npx playwright test

# Run specific E2E test
cd src/frontend && npx playwright test "test name"

# Check App.jsx line count
wc -l src/frontend/src/App.jsx
```
