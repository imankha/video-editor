# App.jsx Reduction Plan

## CURRENT STATUS

| Field | Value |
|-------|-------|
| **Current Task** | Task 05 - AnnotateScreen |
| **App.jsx Lines** | 1811 |
| **Last Updated** | 2026-01-07 |
| **Blocked By** | None |

### Task Progress

| Task | Status | Actual Lines | Notes |
|------|--------|--------------|-------|
| 01 - Navigation Store | ✅ Complete | 2180 | Created navigationStore.js, ProjectContext.jsx |
| 02 - ProjectsScreen | ✅ Complete | 1899 | Created useProjectLoader, projectDataStore, self-contained loading |
| 03 - FramingScreen | ✅ Complete | 1876 | FramingScreen owns useVideo, useProject integration |
| 04 - OverlayScreen | ✅ Complete | 1811 | OverlayScreen owns hooks, overlayStore for coordination |
| 05 - AnnotateScreen | ⬜ Not Started | - | |
| 06 - GalleryScreen | ⬜ Not Started | - | |
| 07 - Final Cleanup | ⬜ Not Started | - | **FULL TEST AFTER** |

**Status Legend:** ⬜ Not Started | 🔄 In Progress | ✅ Complete | ❌ Blocked

---

## HANDOFF NOTES

*Updated after each task by the AI. Read this first when starting a new session.*

### Latest Session Notes
```
Task 04 Complete (2026-01-07):
- Created overlayStore.js for working video, clip metadata, effect type
- OverlayScreen now owns all overlay hooks internally:
  - useOverlayState (local drag/selection state)
  - useHighlight (keyframe-based)
  - useHighlightRegions (boundary-based)
  - useVideo (without segment awareness)
  - useZoom, useTimelineZoom
- FramingScreen sets overlayStore when exporting (setWorkingVideo, setClipMetadata)
- OverlayScreen reads from stores/contexts:
  - useProject for projectId/project
  - useOverlayStore for working video
  - useProjectDataStore for framing clips (pass-through mode)
  - useFramingStore for hasChangedSinceExport
- Simplified OverlayScreen props: 70+ props → 1 (onExportComplete)
- All overlay persistence logic now in OverlayScreen
- All 348 unit tests pass, 26 E2E tests pass
- App.jsx: 1876 → 1811 lines (-65 lines)
- Ready for Task 05: Finalize AnnotateScreen
```

### Known Issues / Blockers
```
None.
```

### Decisions Made
```
- Using Zustand for navigation store (consistent with existing stores)
- ProjectContext auto-fetches project when projectId changes
- History limited to last 10 entries to prevent memory issues
- Integration callbacks bridge screens to App.jsx during transition
- useProjects hook has separate instances per component
- FramingScreen initializes from projectDataStore clips (set by useProjectLoader)
- Video hooks remain in App.jsx until OverlayScreen is self-contained (Task 04)
```

---

## QUICK START FOR NEW AI SESSION

### ⚠️ TESTING POLICY
- **DO run:** Unit tests (`npm test`) - run these yourself after changes
- **DO NOT run:** E2E tests (`playwright test`) - ask the user to run these
- After each task, ask the user to run E2E tests and wait for confirmation before proceeding

### 1. Understand the Goal
Reduce `src/frontend/src/App.jsx` from **2181 lines** to **~150 lines** by extracting logic into self-contained screen components.

### 2. Check Current Status
Look at the "Task Progress" table above. Find the first ⬜ Not Started task.

### 3. Read the Task File
Open `TASK-XX-*.md` for detailed instructions.

### 4. Verify Clean State Before Starting
```bash
cd src/frontend && npm test
wc -l src/frontend/src/App.jsx
```
**Note:** Ask the user to run E2E tests manually - do NOT run them yourself.

### 5. After Completing Task
1. Run verification (see Post-Task Protocol below)
2. Update this README:
   - Change task status to ✅
   - Record actual App.jsx line count
   - Add handoff notes for next session
3. Commit changes

---

## PROJECT CONTEXT

### What is This App?
A browser-based video editor with 4 mutually exclusive modes:
- **Project Manager**: Select/create projects and games
- **Annotate Mode**: Mark clips in game footage for extraction
- **Framing Mode**: Crop, trim, speed adjust video clips
- **Overlay Mode**: Add highlight effects to players

### Key Files
```
src/frontend/src/
├── App.jsx                 # THE FILE WE'RE REDUCING (2181 lines)
├── screens/
│   ├── ProjectsScreen.jsx  # Project selection
│   ├── AnnotateScreen.jsx  # Clip marking
│   ├── FramingScreen.jsx   # Video editing
│   └── OverlayScreen.jsx   # Highlight effects
├── containers/
│   ├── AnnotateContainer.jsx
│   ├── FramingContainer.jsx
│   └── OverlayContainer.jsx
├── stores/
│   ├── editorStore.js      # Editor mode state
│   ├── exportStore.js      # Export progress
│   ├── videoStore.js
│   └── clipStore.js
├── hooks/
│   ├── useVideo.js         # Video playback
│   ├── useProjects.js      # Project CRUD
│   ├── useProjectClips.js  # Clip management
│   ├── useGames.js         # Game management
│   └── ... (many more)
└── modes/
    ├── framing/            # useCrop, useSegments
    ├── overlay/            # useHighlight, useHighlightRegions
    └── annotate/           # Annotation components
```

### Current App.jsx Problems
1. **God Class**: 2181 lines handling ALL modes
2. **Prop Drilling**: 50+ props to FramingScreen, 60+ to OverlayScreen
3. **Mixed Concerns**: Video, crop, segments, highlights all initialized together
4. **Embedded Logic**: 400+ lines of project loading in render callbacks

---

## DESIGN PRINCIPLES

### 1. Loose Coupling
- Screens don't know about each other's internals
- App.jsx doesn't know about any screen's internal workings
- Communication via Zustand stores, not props

### 2. Tight Cohesion
- Each screen owns ALL state and logic for its mode
- Related functionality lives together

### 3. DRY (Don't Repeat Yourself)
- Shared utilities in `hooks/` and `utils/`
- Shared state in Zustand stores

---

## TASK SUMMARY

| Task | Description | Lines Removed | Expected Lines | Complexity |
|------|-------------|---------------|----------------|------------|
| Start | Current state | - | **2181** | - |
| [TASK-01](TASK-01-create-app-navigation-store.md) | Create navigation store | +50 (new) | **2181** | Low |
| [TASK-02](TASK-02-self-contained-projects-screen.md) | Self-contained ProjectsScreen | -400 | **~1780** | High |
| [TASK-03](TASK-03-self-contained-framing-screen.md) | Self-contained FramingScreen | -500 | **~1280** | High |
| [TASK-04](TASK-04-self-contained-overlay-screen.md) | Self-contained OverlayScreen | -600 | **~680** | High |
| [TASK-05](TASK-05-finalize-annotate-screen.md) | Finalize AnnotateScreen | -100 | **~580** | Medium |
| [TASK-06](TASK-06-extract-gallery-screen.md) | Extract GalleryScreen | -50 | **~530** | Low |
| [TASK-07](TASK-07-final-app-cleanup.md) | Final App.jsx cleanup | -380 | **~150** | Medium |

---

## POST-TASK VERIFICATION PROTOCOL

### ⚠️ IMPORTANT: E2E Test Policy
**DO NOT run E2E tests yourself.** After completing each task:
1. Run unit tests (`npm test`)
2. Ask the user: "Please run the E2E tests and let me know the results"
3. Wait for user confirmation before proceeding to the next task

### After EVERY Task:

#### Step 1: Run Unit Tests
```bash
cd src/frontend && npm test
```

#### Step 2: Ask User to Run E2E Tests
Tell the user:
> "I've completed the task. Please run E2E tests and let me know the results:
> `cd src/frontend && npx playwright test --project=chromium --reporter=line`"

#### Step 3: Count App.jsx Lines
```bash
wc -l src/frontend/src/App.jsx
```

#### Step 4: Verify Logic Removal
Inspect App.jsx to confirm this logic is GONE:

| Task | Logic That MUST Be Removed |
|------|---------------------------|
| 01 | N/A (infrastructure only) |
| 02 | `onSelectProject` callback body, `onSelectProjectWithMode` callback body, project loading refs |
| 03 | `useVideo()`, `useCrop()`, `useSegments()`, `useZoom()`, `FramingContainer`, framing handlers, `videoFile`, `dragCrop`, `includeAudio` state |
| 04 | `useOverlayState()`, `useHighlight()`, `useHighlightRegions()`, `OverlayContainer`, `saveOverlayData`, `loadOverlayData` |
| 05 | `pendingAnnotateFile`, `pendingGameId`, annotate props to AnnotateScreen |
| 06 | `isDownloadsPanelOpen`, `downloadsCount` props |
| 07 | ALL remaining dead imports, unused handlers, orphaned effects |

#### Step 5: Verify Integration
- [ ] New component imports correctly from stores/contexts
- [ ] Functionality works (manual click-through)
- [ ] No console errors

#### Step 6: Update README
- Change task status in table above
- Record actual line count
- Add handoff notes

#### Step 7: Commit
```bash
git add -A
git commit -m "refactor: [Task XX] description"
```

---

## FULL TEST CHECKPOINTS

**Reminder:** AI runs unit tests. Ask user to run E2E tests.

### After Task 03 (FramingScreen) - MANDATORY
```bash
# AI runs: ALL frontend unit tests
cd src/frontend && npm test
```

Ask user to run:
```bash
# ALL E2E tests
cd src/frontend && npx playwright test
```

Manual checklist (ask user to verify):
- [ ] Open project from ProjectManager
- [ ] Load clip in Framing mode
- [ ] Edit crop keyframes
- [ ] Split segments, change speed
- [ ] Trim video
- [ ] Export to working video
- [ ] Switch to Overlay and back - state persists

### After Task 07 (Final Cleanup) - MANDATORY
```bash
# AI runs: ALL frontend unit tests
cd src/frontend && npm test
```

Ask user to run:
```bash
# ALL E2E tests
cd src/frontend && npx playwright test

# Backend tests (optional)
cd src/backend && pytest tests/ -v
```

Manual COMPLETE workflow (ask user to verify):
- [ ] 1. Project Manager - create project
- [ ] 2. Add clip, edit framing
- [ ] 3. Export framing
- [ ] 4. Add highlights in Overlay
- [ ] 5. Export final video
- [ ] 6. View in Gallery
- [ ] 7. Annotate mode - load game, mark clips
- [ ] 8. All mode switches work

---

## DEVIATION TRACKING LOG

**Update this after each task.**

```
┌─────────┬──────────┬────────┬───────────┬─────────────────────────────┐
│ Task    │ Expected │ Actual │ Deviation │ Reason                      │
├─────────┼──────────┼────────┼───────────┼─────────────────────────────┤
│ Start   │ 2181     │ 2181   │ 0         │ Baseline                    │
│ 01      │ 2181     │ 2180   │ -1        │ Infrastructure only         │
│ 02      │ ~1780    │ 1899   │ +119      │ Integration callbacks added │
│ 03      │ ~1280    │ 1876   │ +596      │ Video hooks kept for overlay│
│ 04      │ ~680     │ 1811   │ +1131     │ Legacy overlay hooks in App │
│ 05      │ ~580     │        │           │                             │
│ 06      │ ~530     │        │           │                             │
│ 07      │ ~150     │        │           │                             │
└─────────┴──────────┴────────┴───────────┴─────────────────────────────┘
```

**If deviation > 50 lines:** STOP. Analyze why:
- Task removed more/less than expected → update estimates
- Logic was missed → go back and remove it
- Logic incorrectly removed → restore it

---

## TARGET ARCHITECTURE

### Final App.jsx (~150 lines)
```jsx
function App() {
  const mode = useCurrentMode();

  return (
    <ProjectProvider>
      {mode === 'project-manager' && <ProjectsScreen />}
      {mode === 'annotate' && <AnnotateScreen />}
      {mode === 'framing' && <FramingScreen />}
      {mode === 'overlay' && <OverlayScreen />}

      <DownloadsPanel />
      <ConfirmationDialog />
    </ProjectProvider>
  );
}
```

### Each Screen Is Self-Contained
```jsx
function FramingScreen() {
  // Own hooks - NOT passed from App.jsx
  const { videoRef, videoUrl, ... } = useVideo();
  const { keyframes, ... } = useCrop(metadata);
  const { segments, ... } = useSegments();

  // Own state
  const [includeAudio, setIncludeAudio] = useState(true);

  // Own effects
  useEffect(() => { /* persistence */ }, []);

  return <FramingModeView ... />;
}
```

---

## SUCCESS METRICS

| Metric | Before | Target |
|--------|--------|--------|
| App.jsx lines | 2181 | ~150 |
| Props to FramingScreen | 50+ | 0 |
| Props to OverlayScreen | 60+ | 0 |
| Props to AnnotateScreen | 15+ | 0 |
| Hooks in App.jsx | 15+ | 2-3 |
| State variables in App.jsx | 20+ | 0 |

---

## FILE INDEX

| File | Description |
|------|-------------|
| [README.md](README.md) | This file - status, handoff, overview |
| [CODEBASE_CONTEXT.md](CODEBASE_CONTEXT.md) | Detailed codebase information |
| [TASK-01](TASK-01-create-app-navigation-store.md) | Create navigation store |
| [TASK-02](TASK-02-self-contained-projects-screen.md) | Self-contained ProjectsScreen |
| [TASK-03](TASK-03-self-contained-framing-screen.md) | Self-contained FramingScreen ⚠️ |
| [TASK-04](TASK-04-self-contained-overlay-screen.md) | Self-contained OverlayScreen |
| [TASK-05](TASK-05-finalize-annotate-screen.md) | Finalize AnnotateScreen |
| [TASK-06](TASK-06-extract-gallery-screen.md) | Extract GalleryScreen |
| [TASK-07](TASK-07-final-app-cleanup.md) | Final cleanup ⚠️ |

---

## ROLLBACK STRATEGY

Each task = separate commit. If issues:
1. `git revert <commit>`
2. Previous commits remain stable
3. Unit tests must pass before each commit
4. User confirms E2E tests pass before proceeding
