# T12240: Guide placement: avoid-list, side candidates, docked fallback

**Status:** WIP
**Impact:** 8
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q5 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

placeCoach (instructions/placement.js:1-11) considers only top/bottom of its own anchor and never other controls; if neither side fits it returns null and the guide silently disappears. On Home > Games the anchor is the game card (EmptyTabGuide.jsx:93, side top) and the bubble lands in the 55px gap above it, on the 'Upload game' button (B1, qa-37). During the spotlight pick the pill avoids only the visible player detections (OverlayModeView.jsx:719), which are empty in the away phase, so it sits over the stage. The portal coach is z-[110], above modals (z-50) and players (z-[70]), so a stale bubble paints over a modal backdrop (qa-05).

## Solution

Add an obstacles list to placeCoach; candidate order right, below, left, above on desktop and below, above on phones; reject any candidate that intersects the anchor or any avoid rect. FloatingCoach collects rects of [data-guidance-avoid] elements plus the corner controls (T11950) and re-measures with the existing observers; tag the Upload game button data-guidance-avoid. If nothing fits dock to the tip bar instead of returning null (keep the scroll chevron for offscreen anchors). Every rule's avoid includes the primary CTA, the Guidance control and open toasts; the Focus frame, spotlight stage and Annotate timeline handles are avoid areas. Below 640px always the docked one-line tip bar in flow above the sticky action band. Use Z.* constants instead of z-[110]; hide the portal coach whenever a modal or player layer is open.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/placement.js`
- `src/frontend/src/components/instructions/FloatingCoach.jsx`
- `src/frontend/src/components/shared/EmptyTabGuide.jsx`
- `src/frontend/src/components/ProjectManager.jsx (Upload button attribute)`
- `src/frontend/src/components/instructions/guidance.test.jsx`

### Related Tasks

- Decision Q5. T11950 first (corner controls are avoided). Fixes B1.

### Test first (red before green)

Unit: placeCoach(target, card, viewport, 'top', [obstacleInTopSlot]) should return the bottom spot; today it ignores the obstacle.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12240:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] placeCoach never intersects anchor or avoid rects across 320/390/768/1280 viewports and returns 'dock' instead of null
- [ ] On Home > Games with one game the bubble's rect is disjoint from the Upload game button (Playwright)
- [ ] Existing placement tests still pass
- [ ] Relevant tests pass and lint is clean
