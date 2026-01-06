# App.jsx Decomposition Analysis

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

## Current State: 3401 lines

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

| Task | Description | Impact | Detailed Instructions |
|------|-------------|--------|----------------------|
| 01 | Extract FramingModeView | -500 lines | [TASK-01-extract-framing-mode-view.md](refactor-tasks/TASK-01-extract-framing-mode-view.md) |
| 02 | Extract AnnotateModeView | -400 lines | [TASK-02-extract-annotate-mode-view.md](refactor-tasks/TASK-02-extract-annotate-mode-view.md) |
| 03 | Extract OverlayModeView | -400 lines | [TASK-03-extract-overlay-mode-view.md](refactor-tasks/TASK-03-extract-overlay-mode-view.md) |
| 04 | Move handleTrimSegment to FramingContainer | -200 lines | [TASK-04-move-trim-handler-to-container.md](refactor-tasks/TASK-04-move-trim-handler-to-container.md) |
| 05 | Move clipsWithCurrentState to FramingContainer | -90 lines | [TASK-05-move-clips-with-state-to-container.md](refactor-tasks/TASK-05-move-clips-with-state-to-container.md) |
| 06 | Move Copy/Paste Handlers | -50 lines | [TASK-06-move-copy-paste-handlers.md](refactor-tasks/TASK-06-move-copy-paste-handlers.md) |
| 07 | Final Cleanup | verify ~150 lines | [TASK-07-final-cleanup.md](refactor-tasks/TASK-07-final-cleanup.md) |

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

## Handover Notes

If this refactoring is continued by another session:

1. **Read this file first** - It contains the complete plan
2. **Check which tasks are done** - Look for commits
3. **Run all tests before starting** - Ensure clean state
4. **Follow the task order** - Tasks are ordered by dependency
5. **Commit after each task** - Enables easy rollback
6. **Update progress** - Mark tasks complete

### Key Files to Understand
- `src/frontend/src/App.jsx` - The file being split
- `src/frontend/src/containers/` - Mode containers
- `src/frontend/src/modes/` - Will contain mode views (created by tasks)
- `refactor-tasks/` - Detailed instructions for each task

### Test Commands
```bash
# Frontend unit tests
cd src/frontend && npm test

# E2E tests
cd src/frontend && npx playwright test

# Run specific E2E test
cd src/frontend && npx playwright test "test name"
```
