# T8520: Overlay is an offer, not a stage

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source)

## Problem

When a Focus export completes, the app auto-navigates into Overlay mode with no
explanation and no visible way out except "Add Overlay". The landing page's promised
journey (upload, mark plays, share) never mentions overlays; a first-time user reads
the screen as a mandatory stage and either does unasked work or stalls one screen
before the payoff (walkthrough 2026-09-02, cliff 4).

## Mechanism (verified in source)

Two cooperating pieces fire on framing-export completion:

1. `src/frontend/src/containers/ExportButtonContainer.jsx` - completion arrives via
   WebSocket AND HTTP-poll paths (guarded against double-fire by
   `overlayTransitionFiredRef`, line 185). Four sites call
   `onProceedToOverlay(...)` when `editorMode === EDITOR_MODES.FRAMING`
   (lines ~284, ~358, ~675, ~804). Failure path at line 818 sets
   'Export complete, but overlay transition failed'.
2. `src/frontend/src/screens/FocusScreen.jsx` - `handleProceedToOverlayInternal`
   (passed as the prop at line 1250) stages the working video (blob path or
   MVC/server path with `refreshProject()` around lines 997-1006), calls
   `setOverlayClipMetadata`, `setFramingChangedSinceExport(false)`, then at line
   1023-1025: `if (workingVideoSet) setEditorMode('overlay')` - THE auto-nav.

So the working-video STAGING is valuable and stays; only the final `setEditorMode`
line becomes conditional on user intent.

## What to build

### Step 1 - replace the silent switch with a completion choice

In `FocusScreen.jsx`, replace `setEditorMode('overlay')` (line 1025) with local state
`setShowExportCompleteChoice(true)` and render a small centered (non-fullscreen) card
over the Focus content:

- Title: "Your reel is exported"
- Body: "Add a spotlight overlay? Optional - it draws a glowing highlight around your
  athlete. Your reel is ready either way."
- Primary button: "Add Overlay" -> `setEditorMode('overlay')` (everything is already
  staged, identical to today's behavior)
- Secondary button (equal visual weight, ui-style-guide secondary variant):
  "Skip - my reel is ready" -> the DESTINATION IS OWNED BY T8530/T8400: navigate to
  the reel surface (until T8530 lands: open the Highlight Reels drawer or the Clips
  tab "Ready" position - call the same navigation the completion toast will use;
  coordinate on one shared helper, e.g. `navigateToFinishedReel(projectId)` exported
  from a shared util both tasks import).
- NOT dismissible by backdrop click (project rule: no backdrop close); an X maps to
  the Skip action.

Persist NOTHING. If the user navigates away mid-choice, the staged working video
remains in memory exactly as today (Overlay tab is enabled - ModeSwitcher's
`hasWorkingVideo` - so nothing is lost).

### Step 2 - keep every other path byte-identical

- The four ExportButtonContainer call sites and the double-fire guard: untouched.
- `handleProceedToOverlayInternal`'s staging (working video, clip metadata,
  refreshProject, setFramingChangedSinceExport): untouched.
- The Overlay screen itself, its "Add Overlay" export button, and its finish-button
  copy: untouched (T7700 reversed T7580's copy there per user request - do not
  relitigate).
- Re-entry: a user who Skipped can still open Overlay later via the tab (already
  enabled); confirm no regression in that path.

### Step 3 - copy + design pass

The card is new UI: one quick ui-designer pass on layout/copy before implementation
(spacing, button hierarchy, mobile width). Keep the strings above as the starting
proposal; final copy from the pass. No em dashes in shipped copy.

### Step 4 - tests

- Unit (FocusScreen or extracted hook): completion sets showExportCompleteChoice and
  does NOT change editorMode; "Add Overlay" -> editorMode 'overlay'; "Skip" -> the
  shared navigate helper called with projectId.
- The overlayTransitionFiredRef double-fire guard still holds (existing tests if any;
  otherwise add one around the choice appearing once).
- e2e: full path A (choice -> Add Overlay -> overlay screen), path B (choice -> Skip ->
  reel surface). Both at 1280px and 390x844; assert both buttons in-viewport (T8550).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FocusScreen.jsx` (997-1029, 1250)
- `src/frontend/src/containers/ExportButtonContainer.jsx` (185, 284, 358, 675, 804, 818) - read-only
- `src/frontend/src/components/shared/` - card/button primitives, ui-style-guide skill
- Shared `navigateToFinishedReel` helper - new, co-owned with T8530

### Related Tasks
- T8530 (auto-advance/publish) + T8400 (land on the reel) own the Skip destination -
  build the shared helper together; whichever lands second rebases
- T7700: Overlay finish-button copy decision stands
- ui-designer pass required before implementation (small)

## Acceptance Criteria

- [ ] No silent editorMode switch on export completion; the choice card appears instead
- [ ] "Add Overlay" reproduces today's overlay entry exactly (staged video, no refetch)
- [ ] "Skip - my reel is ready" reaches the reel surface in one tap
- [ ] No backdrop-close; X = Skip
- [ ] Overlay remains reachable later via the tab after skipping
- [ ] Unit + both e2e paths green at 1280px and 390x844
