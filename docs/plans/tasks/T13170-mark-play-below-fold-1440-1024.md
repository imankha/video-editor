# T13170: Mark play is still cut off at the bottom of Annotate at 1440x900 and below the fold at 1024x768

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** S/M (frontend Annotate layout)
**Created:** 2026-10-25
**Updated:** 2026-10-25
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-25 ([RESULTS.md section 11](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only (`r3-*.png` under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk).

## Problem

T13020 (STAGING) brought Done (play editor), Share plays (review) and the Make highlight slots (after Done) fully on-screen at 1440 and 1024. Mark play, the control the first two Annotate guides name ("Tap Play to watch the game ... tap Mark play" and "See a great moment? Tap Mark play."), still is not:

- 1440x900: the tile spans y 769 to 991, so only its top 131 px show.
- 1024x768: it is below the fold and the guide shows "Scroll down to continue".

The same happens right after a game upload (r3-upload-failed-1440 shows the pill). So the Parent Usability Audit close ("the full journey at 1440 completes with no step that needs a hidden gesture") is still not met. Evidence: r3-annotate-watch-{1440,1024}, r3-annotate-playing-{1440,1024}.

## Solution

Fit the action-tile row (Mark play, Review plays, Share plays, Add footage) inside the first viewport at 1440x900 and 1024x768 in the watch and playing states, for example by capping the video height so the row stays visible.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` (stage and action tiles)
- `.claude/knowledge/annotate.md`, `.claude/knowledge/guidance.md`

### Related Tasks
- Residual of T13020; blocks the T12590 Parent Usability Audit close

## Acceptance Criteria

- [ ] At 1440x900 and 1024x768, Mark play is fully on-screen with no scroll in the watch and playing states (geometry test)
- [ ] No "Scroll down to continue" pill on those states at those sizes
