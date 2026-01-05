# App.jsx Refactoring Plan

## Goal
Split App.jsx (4088 lines) into focused, AI-context-optimized modules where each change requires reading only the relevant file (~400-900 lines instead of 4000+).

---

## Current State Analysis

### App.jsx Structure (4088 lines)
| Section | Lines | Content |
|---------|-------|---------|
| State declarations | 1-215 | Hooks, useState, useRef |
| Effects & data sync | 216-754 | WebSocket, derived state |
| Annotate handlers | 755-1340 | Game loading, clip creation |
| Clip/overlay handlers | 1341-1800 | Clip selection, highlights |
| Keyboard handlers | 1800-2320 | 3 useEffect blocks for keys |
| Crop/mode handlers | 2320-2900 | Crop complete, mode switch |
| Context & memos | 2900-3370 | AppStateProvider, computed values |
| JSX rendering | 3370-4088 | All UI components |

### Current Hooks (already consolidated)
- `useVideo` - Video playback state
- `useOverlayState` - Overlay mode state
- `useAnnotateState` - Annotate mode state
- `useClipManager` - Multi-clip management
- `useProjects` - Project management
- `useCrop` - Crop keyframe management
- `useSegments` - Segment/speed management
- `useHighlightRegions` - Highlight region management

### Current Zustand Stores
- `useEditorStore` - editorMode, modeSwitchDialog, selectedLayer (14 tests)
- `useExportStore` - exportProgress, exportingProject (15 tests)

---

## Target Architecture

```
src/frontend/src/
├── App.jsx                        (~200 lines)
│   └── Mode routing only, minimal orchestration
│
├── containers/
│   ├── FramingContainer.jsx       (~900 lines)
│   ├── OverlayContainer.jsx       (~700 lines)
│   └── AnnotateContainer.jsx      (~800 lines)
│
├── stores/
│   ├── index.js                   (barrel export)
│   ├── editorStore.js             ✅ EXISTS
│   ├── exportStore.js             ✅ EXISTS
│   ├── videoStore.js              🔄 TO CREATE
│   └── clipStore.js               🔄 TO CREATE
│
└── hooks/
    ├── useKeyboardShortcuts.js    (~350 lines)
    └── useExportWebSocket.js      (~100 lines)
```

---

## Implementation Plan

### Phase 1: Create Core Zustand Stores

#### Task 1.1: Convert useVideo → useVideoStore
**Status**: ✅ Complete

**Current**: `useVideo` hook in `hooks/useVideo.js`
- videoRef, videoFile, videoUrl, metadata
- isPlaying, currentTime, duration, isSeeking
- loadVideo, play, pause, seek, stepForward, stepBackward

**Target**: `useVideoStore` in `stores/videoStore.js`
- Same state and actions, but as Zustand store
- Components access directly without prop drilling
- Keep backward-compatible `useVideo` wrapper for gradual migration

**Files to modify**:
- Create: `stores/videoStore.js`
- Create: `stores/videoStore.test.js`
- Update: `stores/index.js`
- Update: `App.jsx` (use store instead of hook)

**Tests**: ~20 new tests expected

---

#### Task 1.2: Convert useClipManager → useClipStore
**Status**: ✅ Complete

**Current**: `useClipManager` hook
- clips, selectedClipId, selectedClip
- globalAspectRatio, globalTransition
- addClip, deleteClip, selectClip, reorderClips, updateClipData

**Target**: `useClipStore` in `stores/clipStore.js`

**Files to modify**:
- Create: `stores/clipStore.js`
- Create: `stores/clipStore.test.js`
- Update: `stores/index.js`
- Update: `App.jsx`

**Tests**: ~15 new tests expected

---

### Phase 2: Extract Utility Hooks

#### Task 2.1: Extract useKeyboardShortcuts
**Status**: ⬜ Pending

**Current**: 3 useEffect blocks in App.jsx (lines 2133-2315)
- Spacebar play/pause handler
- Ctrl+C/V copy/paste crop handler
- Arrow keys navigation handler

**Target**: `hooks/useKeyboardShortcuts.js`
- Single hook that sets up all keyboard handlers
- Mode-aware (different behavior per mode)
- Uses stores directly for state access

**Files to modify**:
- Create: `hooks/useKeyboardShortcuts.js`
- Create: `hooks/useKeyboardShortcuts.test.js`
- Update: `App.jsx` (remove 3 useEffect blocks, add single hook call)

**Tests**: ~10 new tests expected

---

#### Task 2.2: Extract useExportWebSocket
**Status**: ⬜ Pending

**Current**: WebSocket setup in App.jsx (lines 216-280)

**Target**: `hooks/useExportWebSocket.js`
- Handles WebSocket connection for export progress
- Updates exportStore directly

**Files to modify**:
- Create: `hooks/useExportWebSocket.js`
- Update: `App.jsx`

---

### Phase 3: Extract Mode Containers

#### Task 3.1: Extract AnnotateContainer
**Status**: ⬜ Pending

**Why first**: Most isolated mode, fewest dependencies on other modes

**Content to extract**:
- Annotate-specific handlers (lines 755-1340)
- Annotate-specific UI rendering
- Uses: useAnnotateState, useAnnotate, useGames

**Files to modify**:
- Create: `containers/AnnotateContainer.jsx`
- Update: `App.jsx`

---

#### Task 3.2: Extract OverlayContainer
**Status**: ⬜ Pending

**Content to extract**:
- Overlay-specific handlers
- Highlight management UI
- Player detection UI
- Uses: useOverlayState, useHighlightRegions, usePlayerDetection

**Files to modify**:
- Create: `containers/OverlayContainer.jsx`
- Update: `App.jsx`

---

#### Task 3.3: Extract FramingContainer
**Status**: ⬜ Pending

**Why last**: Most coupled, depends on crop/segment state

**Content to extract**:
- Crop handlers
- Segment handlers
- Trim handlers
- Framing UI
- Uses: useCrop, useSegments, videoStore, clipStore

**Files to modify**:
- Create: `containers/FramingContainer.jsx`
- Update: `App.jsx`

---

## Execution Checklist

- [x] 1.1 Create useVideoStore + tests → Run tests → Commit
- [x] 1.2 Create useClipStore + tests → Run tests → Commit
- [ ] 2.1 Extract useKeyboardShortcuts + tests → Run tests → Commit
- [ ] 2.2 Extract useExportWebSocket → Run tests → Commit
- [ ] 3.1 Extract AnnotateContainer → Run tests → Commit
- [ ] 3.2 Extract OverlayContainer → Run tests → Commit
- [ ] 3.3 Extract FramingContainer → Run tests → Commit

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| App.jsx lines | 4088 | ~200 |
| Lines to read for crop change | 4088 | ~900 (FramingContainer) |
| Lines to read for annotate change | 4088 | ~800 (AnnotateContainer) |
| Lines to read for keyboard change | 4088 | ~350 (useKeyboardShortcuts) |
| Total test count | 264 | ~320 |

---

## Rollback Strategy

Each task is a separate commit. If issues arise:
1. `git revert <commit>` for the problematic change
2. All previous commits remain stable
3. Tests must pass before each commit

---

## Current Progress

| Task | Status | Commit | Tests |
|------|--------|--------|-------|
| 1.1 useVideoStore | ✅ Complete | 78864e3 | 26 |
| 1.2 useClipStore | ✅ Complete | (pending) | 30 |
| 2.1 useKeyboardShortcuts | ⬜ Pending | - | - |
| 2.2 useExportWebSocket | ⬜ Pending | - | - |
| 3.1 AnnotateContainer | ⬜ Pending | - | - |
| 3.2 OverlayContainer | ⬜ Pending | - | - |
| 3.3 FramingContainer | ⬜ Pending | - | - |

---

## Handover Notes

If this refactoring is continued by another session:

1. **Read this file first** - It contains the complete plan
2. **Check Current Progress table** - See what's done
3. **Run all tests before starting** - Ensure clean state
4. **Follow the order** - Tasks are ordered by dependency
5. **Commit after each task** - Enables easy rollback
6. **Update this file** - Mark tasks complete, add commit hashes

### Key Files to Understand
- `src/frontend/src/App.jsx` - The file being split
- `src/frontend/src/stores/` - Zustand stores
- `src/frontend/src/hooks/useVideo.js` - Template for store conversion
- `src/frontend/src/hooks/useClipManager.js` - Template for store conversion

### Test Commands
```bash
# Frontend tests
cd src/frontend && npm test

# Backend tests
cd src/backend && .venv/Scripts/python.exe -m pytest

# All tests
# Frontend: 264+ tests, Backend: 272 tests
```
