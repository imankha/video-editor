# T12640: Overlay spotlight guide: no shade or Got it, sits inside the tiny video, off-screen on phones, and two guides stack

**Status:** STAGING
**Impact:** 8
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity HIGH). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

The spotlight pick walk (and the "Spotlight set" step) renders as an inline guide, so T12580's shade and Got it never apply to it. Observed 2026-10-12:

- 1440x900: the guide card sits inside the portrait video (about 180 px wide), wraps "Click your athlete" into a 6-line column, truncates "Moment 1 of 4" and covers the athlete the user must click; the "Spotlight set" step wraps to 12 lines ([t1-overlay-m2-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-overlay-m2-1440.jpg), [t1-overlay-done-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-overlay-done-1440.jpg)).
- 1024x768: the Overlay video is about 100 px wide and the guide is cut off inside it ([o1-1024](../../ux/2026-10-11-guide-coverage-sweep/screens/o1-1024.jpg)).
- 320, 360, 375, 390 wide: the guide is at y=673 to 797, below the viewport and under the action band, so on a phone the walk is invisible ([o1-390](../../ux/2026-10-11-guide-coverage-sweep/screens/o1-390.jpg)). This is T12460 (guidance never appears on phones) still open for Overlay.
- Text tab: "Make the text your own..." floats over the Generate highlight with spotlight button while the stale "Spotlight set" guide is still in the DOM, so two guides are live at once ([t1-overlay-text-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-overlay-text-1440.jpg)).
- 768x1024 is fine (guide above the athletes, video large).

## Solution

Mount the pick-walk guide as a FloatingCoach step (shade once per rule, Got it, docked on phones) anchored to the video stage with the dialog on the side away from the athletes; keep one guide at a time (the text tip replaces the "Spotlight set" step). Fix the Overlay video minimum size at 1024x768.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/components/instructions/Guide.jsx`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12640:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
