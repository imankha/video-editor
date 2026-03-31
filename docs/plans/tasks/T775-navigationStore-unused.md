# T775: Delete navigationStore — Duplicate State and Dead Routing Code

**Status:** DONE
**Impact:** 4
**Complexity:** 3
**Created:** 2026-03-29
**Updated:** 2026-03-30

## Problem

`navigationStore.js` (`useNavigationStore`) duplicates state that already lives in other stores, violating `state-dup-never` and `state-owner-single` from our coding standards.

### Two violations

**1. Duplicate routing state:** `navigationStore.mode` shadows `editorStore.editorMode`. App.jsx renders screens based on `editorMode` — `navigationStore.mode` is written but **never read for routing decisions**. The `navigate()` function updates the wrong store, so buttons wired to it (e.g., OverlayScreen's "Switch to Framing") silently do nothing.

**2. Duplicate project ID:** `navigationStore.projectId` duplicates `projectsStore.selectedProjectId`. Both track "which project is selected." `useProjectLoader` sets `navigationStore.projectId`, while `ProjectsScreen` sets `projectsStore.selectedProjectId` — they happen to stay in sync, but it's the fragile "sync code between stores" pattern that `state-dup-detect` warns about.

### Evidence

- **App.jsx** renders screens via `editorMode === EDITOR_MODES.FRAMING`, `.OVERLAY`, etc. (lines ~502-514). It never reads `navigationStore.mode`.
- **`handleModeChange`** in App.jsx calls `setEditorMode()`, not `navigate()`.
- **OverlayScreen** calls `navigate('framing')` on button click (line 842) — this updates `navigationStore.mode` but NOT `editorMode`, so the screen doesn't actually change. This is a **live bug**.
- **Store Ownership Map** (state-management skill) already flags this: `selectedProject | editorStore | navigationStore` — navigationStore should NOT own it.
- `goBack()` and `history` are never called from any UI component.

### What navigationStore contains

| Field | Actively used? | Duplicated in |
|-------|---------------|---------------|
| `mode` | Written, never read for routing | `editorStore.editorMode` |
| `previousMode` | Never read outside store | — |
| `history` | Never read outside store | — |
| `projectId` | Read by ProjectContext, FramingScreen, useProjectLoader | `projectsStore.selectedProjectId` |
| `navigate()` | Called from 3 places, but doesn't change screens | `editorStore.setEditorMode()` |
| `setProjectId()` | Called from useProjectLoader | `projectsStore.selectProject()` |
| `reset()` | Called from profileStore on profile switch | — |

## Solution

**Delete navigationStore entirely.** Replace all usages:

- **`navigationStore.projectId`** → read from `projectsStore.selectedProjectId`
- **`navigate(mode)`** → call `editorStore.setEditorMode(mode)` (through App.jsx's `handleModeChange` where unsaved-changes dialogs are needed, or directly for simple cases)
- **`setProjectId(id)`** → remove (redundant — `projectsStore.selectProject()` already sets it)
- **`reset()`** → remove call from profileStore (projectsStore.reset() already clears selectedProjectId)

### Files to change

| File | What to change |
|------|---------------|
| `stores/navigationStore.js` | **DELETE** |
| `stores/navigationStore.test.js` | **DELETE** |
| `stores/index.js` | Remove `useNavigationStore`, `useCurrentMode`, `useProjectId`, `useNavigate` re-exports |
| `contexts/ProjectContext.jsx` | Read `projectId` from `projectsStore.selectedProjectId` instead of `navigationStore.projectId` |
| `hooks/useProjectLoader.js` | Remove `setProjectId` and `navigate` calls (both redundant — caller already handles these via projectsStore and editorStore) |
| `screens/OverlayScreen.jsx` | Replace `navigate('framing')` → `setEditorMode(EDITOR_MODES.FRAMING)` in `handleSwitchToFraming`; replace `navigate('project-manager')` → `setEditorMode(EDITOR_MODES.PROJECT_MANAGER)` in `handleBackToProjects`. Import `useEditorStore` + `EDITOR_MODES` instead of `useNavigationStore`. |
| `screens/FramingScreen.jsx` | Replace `useNavigationStore.getState().projectId` → `useProjectsStore.getState().selectedProjectId` (line ~765, stale export guard) |
| `screens/ProjectsScreen.jsx` | Remove `navigate` import and usage (it's imported but the grep showed no actual `navigate()` calls beyond the import) |
| `stores/profileStore.js` | Remove `useNavigationStore.getState().reset()` call (line ~212) — `projectsStore.reset()` already clears project state |

### Key risk: ProjectContext reactivity

`ProjectContext.jsx` currently does `useNavigationStore(state => state.projectId)` to reactively fetch project data when the project changes. Switching to `useProjectsStore(state => state.selectedProjectId)` should behave identically — both are Zustand selectors that trigger re-renders on change, and both values are already kept in sync. But **verify** that project data still loads correctly after the switch.

### Key risk: OverlayScreen mode switching

`handleSwitchToFraming` currently calls `navigate('framing')` which is **already broken** (doesn't change screens). Replacing with `setEditorMode` will **fix** this. However, App.jsx's `handleModeChange` has unsaved-changes dialog logic for mode switches from overlay. Check whether OverlayScreen should call `handleModeChange` (passed as prop) instead of `setEditorMode` directly, to preserve the dialog flow.

### Not in scope

- The `useProjectLoader` hook has other responsibilities (loading clips, metadata, working video). Only remove the navigationStore-specific calls (`setProjectId`, `navigate`). Don't refactor the rest of the hook.
- Don't consolidate `projectsStore.selectedProjectId` into `editorStore`. That's a larger refactor with cross-store write implications. The goal here is removing the duplicate, not reorganizing ownership.

## Acceptance Criteria

- [ ] `navigationStore.js` and `navigationStore.test.js` deleted
- [ ] No imports of `useNavigationStore`, `useCurrentMode`, `useProjectId`, or `useNavigate` anywhere in codebase
- [ ] `ProjectContext` reads project ID from `projectsStore.selectedProjectId`
- [ ] OverlayScreen "Switch to Framing" button actually changes the screen (currently broken)
- [ ] Project loading still works: click project → FramingScreen loads with correct project data
- [ ] Profile switch still resets all state correctly
- [ ] Frontend builds with no errors (`npm run build`)
- [ ] All unit tests pass (`npm test`)
