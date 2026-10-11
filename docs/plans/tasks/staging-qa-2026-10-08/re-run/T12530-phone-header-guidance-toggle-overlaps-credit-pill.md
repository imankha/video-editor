# T12530: Phone header: Guidance toggle overlaps credit pill, label hidden, credits tooltip wraps

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N16, N17, N22 (severity MED). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

At 320 the credit pill is overlapped by the Guidance toggle; at 390 and below the "Guidance" label is hidden so the control reads only "On"; the sticky header overlaps the tabs and the Continue card on scroll; the "You start with 88 free credits" tooltip wraps to 6 lines and covers the Games tab; "Game upload/ed Oct 11" breaks mid-word in the Continue card at 320.

Screenshots: rr-00-blank-games-320x568, rr-00-blank-games-390x844, rr-60, rr-62, rr-105-m390-after-done-for-now, sweep-home-games-320x568.

## Solution

Give the phone header a layout that fits at 320: "Guidance: On" or an info icon, a one-line tooltip anchored under the credit pill, no mid-word breaks.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/GuidanceToggle.jsx`
- `src/frontend/src/components/ProjectHeader.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12530:`

## Acceptance Criteria

- [ ] At 320, 360, 375 and 390 nothing in the header overlaps and the toggle says what it is
- [ ] The tooltip is one line or a short wrap that does not cover tabs
- [ ] No mid-word wrap

## Evidence screenshots

Kept in `screens/T12530/` (delete that folder when this task is archived):

- [rr-00-blank-games-320x568.jpg](screens/T12530/rr-00-blank-games-320x568.jpg)
- [rr-00-blank-games-390x844.jpg](screens/T12530/rr-00-blank-games-390x844.jpg)
- [rr-105-m390-after-done-for-now.jpg](screens/T12530/rr-105-m390-after-done-for-now.jpg)
- [rr-60-m390-home-with-game.jpg](screens/T12530/rr-60-m390-home-with-game.jpg)
- [rr-62-m390-home-after-modal.jpg](screens/T12530/rr-62-m390-home-after-modal.jpg)
- [sweep-home-games-320x568.jpg](screens/T12530/sweep-home-games-320x568.jpg)
