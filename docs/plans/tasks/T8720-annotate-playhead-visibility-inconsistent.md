# T8720: Playhead disappears/behaves inconsistently in Annotate's add/edit-play mode

**Status:** STAGING (merged to master 2026-09-04, PR #332)
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-04

## Problem

User feedback (2026-09-04), live-testing Annotate's add/edit-play flow: "when im in
add/edit a play mode, i want to always see the playhead, it seems to disappear when
stopped sometimes and act differently if i stop and play with buttons versus space bar.
it feels finicky."

Two distinct symptoms reported:
1. The playhead marker sometimes disappears when playback is stopped (should always be
   visible while editing a play).
2. Playhead/playback behavior differs depending on whether the user uses the on-screen
   button controls vs the spacebar keyboard shortcut to stop/start — these should be
   equivalent, not two different code paths with different visible results.

Symptom 2 strongly suggests two separate handlers (a button `onClick` and a keydown
listener) that don't fully converge on the same state update — needs live reproduction
and comparison of both code paths before fixing either.

## Solution (needs investigation — root cause not yet known)

Reproduce both symptoms live first (real browser, not assumption), isolate: does the
spacebar handler and the button handler both funnel through the same play/pause
state-setting function, or are there two divergent implementations? Fix at the single
source once found — do not patch each symptom independently if they share one root cause.

## Context

### Relevant Files (anticipated — confirm via Code Expert; playhead-related code spans
several files, narrow down which one owns the actual bug)
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx`
- `src/frontend/src/modes/annotate/components/ClipScrubRegion.jsx`
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (the
  add/edit-play panel itself, see screenshot context — "Editing: Play 1")
- Keyboard shortcut handling (spacebar play/pause) — locate the keydown listener,
  confirm whether it shares a code path with the button's `onClick`

## Acceptance Criteria

- [ ] Playhead remains visible at all times while in add/edit-play mode, including when
      stopped
- [ ] Stopping/starting playback via the button controls and via spacebar produce
      IDENTICAL visible playhead behavior (same code path, verified not just visually
      similar)
- [ ] Regression test covering both trigger paths (button + spacebar) asserting the same
      resulting state
