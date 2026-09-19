# T10450: Split the T10310 Frame button into Frame Now / Frame Later

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

User report (screenshot, main Annotate screen): once a play is selected but has no
clip yet, the play-selected CTA row (T10310) shows only [Edit Play] + [Frame Clip].
The user wants a third explicit option: create the clip now and go straight to
Framing ("Frame Now"), or create the clip and stay in Annotate to frame it later
("Frame Later"). A 5-star play's "Frame Later" button should throb to nudge the
user toward converting their best plays into clips. Once a play already has a
clip (project exists), the row should collapse back to just [Edit Play] + a
single Frame/stage button — the split only matters at the create decision.

## Solution

`AnnotateModeView.jsx`'s T10310 row split its single `handleFrameClip` into
`handleFrameNow` (create + navigate to Framing, the old behavior) and
`handleFrameLater` (create only, no navigate — same NO_PROJECT "create" seam
`clipStage.js` already documents, just not previously exposed on this row).
Render logic: NO_PROJECT play selected -> [Edit Play] row + [Frame Now]/[Frame
Later] row below it; play already has a project -> unchanged single
[Edit Play] + [stage label] row. `Frame Later` gets `motion-safe:animate-pulse`
when `region.rating === 5`.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` — the T10310 CTA row + handlers
- `src/frontend/src/config/displayNames.js` — new `ANNOTATE.FRAME_NOW`/`FRAME_LATER`/`FRAME_LATER_HINT`
- `src/frontend/src/modes/AnnotateModeView.frameClip.test.jsx` — updated/added tests

### Related Tasks
- Builds directly on T10310 (Overlay/main-screen play-selected CTA row) and reuses
  the NO_PROJECT create seam `clipStage.js` documents (T10240).

### Technical Notes
- No schema change, no new abstraction — reuses the existing
  `onFullscreenUpdateClip(id, { createProject: true })` seam; only the
  navigate-after-create decision changes per button.
- Concurrent-session note: this repo's shared main checkout had unrelated
  uncommitted WIP already claiming task id T10430 (a "Brilliant" 5-star badge
  icon) at the start of this task, so it was implemented under T10440 in a
  disposable worktree (`C:/tmp/master-wt-t10440`) rather than `git checkout -b`
  in the shared tree, per
  `[[project_concurrent_agents_shared_worktree]]`. At merge time, origin/master
  turned out to ALSO already have a different, unrelated T10440 task landed
  (Play progress badges undone-color fix) — a second, independent collision on
  the same id from another concurrent session. This task was renamed T10440 ->
  T10450 (file, branch, PLAN.md row, code comments) before merging. Lesson:
  checking the shared tree's uncommitted state at task start is not enough —
  re-check origin/master's task ids again right before merge, since another
  session can land a new id in between.

## Implementation

### Steps
1. [x] Add `ANNOTATE.FRAME_NOW`/`FRAME_LATER`/`FRAME_LATER_HINT` to `displayNames.js`
2. [x] Split `handleFrameClip` into `handleFrameNow`/`handleFrameLater` (+ shared `openExistingProjectStage`)
3. [x] Render 2-row CTA (Edit Play [+ stage button]) / (Frame Now + Frame Later) gated on `autoProjectId`
4. [x] Throb `Frame Later` via `motion-safe:animate-pulse` when `rating === 5`
5. [x] Update `AnnotateModeView.frameClip.test.jsx` for the new split + throb behavior

### Progress Log

**2026-09-18**: Implemented + tests updated in isolated worktree. 17/17 targeted
tests green (`AnnotateModeView.frameClip.test.jsx` + `.cta.test.jsx`), 2029/2030
related tests green (1 pre-existing unrelated flake in
`ProjectManager.homeTabDefaults.test.jsx`, confirmed passing in isolation).
Lint clean. Fresh Reviewer: 2 MAJOR (magic `5` instead of the existing
`playProgress.CLIP_NUDGE_RATING` constant; an em dash in the new
`FRAME_LATER_HINT` shipped copy) + 6 MINOR, 0 BLOCKING. Both MAJOR fixed, plus
3 MINORs addressed as cheap wins: hardened the double-create guard with a
synchronous `frameCreateInFlightRef` (matching the T9830/T10240 house
convention — state alone was not exploitable via real clicks but two buttons
now share one guard), renamed the stage button's testid
`annotate-frame-clip-cta` -> `annotate-stage-cta` (repo-wide grep confirmed
zero external consumers), added `// N43` register comments, and added a test
asserting both buttons disable while a create is in flight. 40/40 targeted
tests green post-fix, lint clean. Left as-is (reviewer flagged, judged not
worth it): Title Case "Frame Now"/"Frame Later" (matches the user's own
verbatim wording) and the collapsed stage button staying wired through
`handleFrameNow` rather than `openExistingProjectStage` directly (behavior-
identical either way).

## Acceptance Criteria

- [x] Project-less selected play shows [Edit Play] + [Frame Now] + [Frame Later]
- [x] Play with an existing clip/project shows only [Edit Play] + one stage button
- [x] Frame Now creates the clip (if needed) and opens Framing
- [x] Frame Later creates the clip without navigating
- [x] Frame Later throbs when the play is rated 5 stars
- [x] Tests pass, lint clean
