# T8480: Focus unlocks the moment a reel exists (bug)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source)

## Problem

Walkthrough 2026-09-02: after saving a clip with the reel switch ON and seeing the
"Reel created!" toast, the Focus and Overlay tabs stayed DISABLED in Annotate. The only
explanation anywhere is a hover-only tooltip, invisible to every touch user. The persona
had to wander Home and find the continue card to unlock Focus.

User decision 2026-09-03: this is a bug. If a reel has been created, Focus must be
enabled and working. Add a toast: "Reel started, click Focus to complete".

## Mechanism (verified in source)

- `src/frontend/src/components/shared/ModeSwitcher.jsx`:
  - Focus (id 'framing') is `available: hasProject` (line 59); Overlay needs
    `hasProject && (hasWorkingVideo || hasOverlayVideo)` (line 67).
  - `hasProject = hasProjectProp ?? !!selectedProject` where `selectedProject` comes
    from `useAppState()` (lines 39-42).
  - The ONLY explanation is the native `title` attribute (lines 104-114):
    'Select a reel first' for both tabs, 'Export from Focus first to enable Overlay
    mode' when a project is selected. Native titles need hover -> unreachable on touch.
- The selected project lives in `src/frontend/src/stores/projectsStore.js`:
  `selectedProjectId` (line 27), `selectProject(projectId)` (line 125) - async: sets
  the id, fetches, populates `selectedProject`. `ProjectContext.jsx` bridges it to
  `useAppState()`.
- Reel creation happens in `src/frontend/src/containers/AnnotateContainer.jsx`: the
  save/update responses carry `result.project_created` + `result.project_id` at three
  sites (~line 920-926, ~1007-1013, ~1042-1048). Each currently does
  `setAutoProjectId(...)`, a toast, and `fetchProjects({ force: true })` - but NEVER
  `selectProject(result.project_id)`. That is the whole bug: the project exists but
  is not selected, so ModeSwitcher's `hasProject` stays false.
- How the Home continue card unlocks Focus (the mechanism to reuse): find the card's
  onClick in `ProjectManager.jsx` (renders at ~1098; it navigates to /focus for a
  draft) - it runs `selectProject(projectId)` (or the onSelectProject callback chain
  that ends there) before/while navigating. Confirm the exact call while implementing.

## What to build

### Step 1 - select on creation

At each of the three `result.project_created` sites in AnnotateContainer.jsx, add:

```js
useProjectsStore.getState().selectProject(result.project_id);
```

(or the hook-bound `selectProject` if AnnotateContainer already subscribes). This is
part of the same user gesture (the Save click), memory-only selection state - no new
backend write, fully compliant with gesture-based persistence.

CAUTION - verify two things before landing:
1. Selecting a project while staying in Annotate must not yank the user out of the
   Annotate screen or reload the annotate video. Read what reacts to
   `selectedProjectId` changing (grep subscribers of selectedProject/selectedProjectId)
   and confirm Annotate mode is inert to it. If something navigates on selection,
   gate that on the current editor mode instead of skipping selection.
2. `selectProject` fetches the project; the freshly created project must be fetchable
   immediately (it is - the backend created it synchronously in the save request).

### Step 2 - the toast

Replace the three creation toasts with one shared helper in AnnotateContainer:

```js
toast.success('Reel started, click Focus to complete', {
  duration: 6000,
  onClick: () => setEditorMode('framing'),   // same mode-switch the tabs use
});
```

- Exact copy per user decision: "Reel started, click Focus to complete".
- Check the toast component (`src/frontend/src/components/shared/` toast) supports an
  onClick/action; if not, add an `action: { label: 'Open Focus', onClick }` affordance
  to it (small, reusable - RecapPlayerModal and others can adopt later).
- `setEditorMode('framing')` is how FocusScreen navigates modes (see
  FocusScreen.jsx:1025 using setEditorMode('overlay')); grep editorStore for the
  setter's exact name + import path.

### Step 3 - touch-visible disabled explanations

In ModeSwitcher.jsx, keep the `title` for desktop but add a visible affordance for
disabled tabs on tap: a disabled tab tap (currently a no-op - the onClick guards on
`isAvailable`, line 92) fires a small toast with the same text the title carries
('Select a reel first' / 'Export from Focus first to enable Overlay mode'). This is
3 lines in the onClick: `if (!isAvailable) { toast.info(titleText); return; }`.
No layout change, works at every width.

### Step 4 - tests

- Unit (AnnotateContainer or a focused hook test): creation response -> selectProject
  called with project_id; toast fired with the exact copy.
- ModeSwitcher.test: disabled-tab tap fires the info toast (add file if none exists).
- e2e (extend the annotate save spec): save with reel on -> Focus tab enabled
  (`[data-testid="mode-framing"]` not disabled) -> tap toast -> URL /focus with the
  new project loaded. Run at 390x844 as well.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/AnnotateContainer.jsx` (~920, ~1007, ~1042)
- `src/frontend/src/stores/projectsStore.js` (selectProject, line 125)
- `src/frontend/src/components/shared/ModeSwitcher.jsx` (lines 39-42, 59, 67, 92, 104-114)
- `src/frontend/src/stores/editorStore.js` (mode setter)
- `src/frontend/src/components/shared/` toast component (action support)
- `src/frontend/src/components/ProjectManager.jsx` (~1098) - reference mechanism only

### Related Tasks
- T8470 owns status strings + drawer; this task owns selection + toast + tab
  enablement. Same post-save moment - coordinate copy (T8470 Part B defers to this).
- If selection-side-effect audit (Step 1 caution) reveals a tangle, stop and escalate
  to the expert agent per the model policy rather than patching around it.

## Acceptance Criteria

- [ ] Immediately after reel creation from Annotate, the Focus tab is enabled with the
      new reel selected - zero additional gestures
- [ ] Toast reads exactly "Reel started, click Focus to complete" and opens Focus on tap
- [ ] Tapping a disabled tab explains itself (toast) - no title-only explanations left
- [ ] Annotate screen does not navigate away or reload its video on auto-selection
- [ ] Unit + e2e green, including 390x844
