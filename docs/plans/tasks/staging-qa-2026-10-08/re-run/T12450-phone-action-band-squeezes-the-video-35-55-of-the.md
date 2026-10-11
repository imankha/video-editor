# T12450: Phone action band squeezes the video (35-55% of the screen)

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N3 (severity HIGH). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

At 390x844 the Focus band is about 340 px tall and the video about 270 px; at 320x568 the Focus video is about 70 px and Overlay about 120 px, exactly where the user must drag the frame or tap the athlete. On the "Your highlight is ready" panel at 390 the finished video is about 100 px high so the payoff can barely be watched, and the "Finish without spotlight" label runs to the card edges with a cut subtitle ("Only you can see it unt...").

Screenshots: rr-79, rr-80, rr-81, rr-84-m390-focus-ready, sweep-focus-320x568, sweep-overlay-320x568.

## Solution

On phones collapse the band to one full-width primary CTA, move secondary tiles into a sheet or a compact row, and keep the finished video at least half the screen on the ready panel. Same band component as T12440; do T12440 first.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/focus/FramingActionRow.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/modes/FramingModeView.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12450:`

## Acceptance Criteria

- [ ] At 320x568, 360x740, 375x667 and 390x844 the Focus video is at least 40% of the viewport height and Overlay at least 35%
- [ ] Ready-panel video is at least half the screen at 390
- [ ] Finish without spotlight label and subtitle are not truncated
- [ ] Primary CTA remains first

## Evidence screenshots

Kept in `screens/T12450/` (delete that folder when this task is archived):

- [rr-79-m390-focus-after-drag.jpg](screens/T12450/rr-79-m390-focus-after-drag.jpg)
- [rr-80-m390-focus-after-play.jpg](screens/T12450/rr-80-m390-focus-after-play.jpg)
- [rr-81-m390-focus-scrolled.jpg](screens/T12450/rr-81-m390-focus-scrolled.jpg)
- [rr-84-m390-focus-ready.jpg](screens/T12450/rr-84-m390-focus-ready.jpg)
- [sweep-focus-320x568.jpg](screens/T12450/sweep-focus-320x568.jpg)
- [sweep-overlay-320x568.jpg](screens/T12450/sweep-overlay-320x568.jpg)
