# T11980: Spotlight walk: taps inside the circle and the 'Go to frame N' disagreement

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 1: Bugs](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q13 (see [decision register](../README.md#decision-register)). Implement the option the user ruled; the text below states the recommended option.

## Problem

(a) With player boxes on, HighlightOverlay.jsx:544-556 puts a transparent tap target over the whole circle. A tap that misses a dashed player box toggles a hidden 'adjust the spotlight' edit mode (OverlayModeView.jsx:543 circleEditActive), writes no keyframe, so the walk does not advance and repeated taps toggle edit on and off. The user sees nothing happen (qa-25). (b) The guide's 'away' state means 'no parked detection' (useGuidedAthletePick.js:242-247), cleared by any play or by drifting more than 2 frames (OverlayContainer.jsx:332-355; drift uses highlightRegionsFramerate while the parked frame uses the region's own fps). The sidebar's '(now)' (OverlaySpotlightPanel.jsx:120-132) only means 'step being tracked'. So the sidebar says 'Frame 3 (now)' while the bubble says 'Go to frame 3'. (a) is certain from code; for (b) which event cleared the parked detection in the observed run is not proven (the [DetectionSeek] CLEAR clickedDetection console lines would show it); the fix covers both triggers.

## Solution

(b) Pass currentTime into the hook and derive parked vs away from the playhead's distance to the tracked marker using that marker's own fps, not from clickedDetection alone; sidebar shows '(now)' only when parked, otherwise '(next)'. (a) Per decision Q13: recommended is that during the walk, while the current moment is unpicked, a tap inside the circle moves the spotlight to the tapped point and counts as the pick (same addHighlightRegionKeyframe + scheduleGuidedAdvance path as handleHighlightComplete). The alternative keeps the toggle but shows an explicit 'Adjusting spotlight: drag it onto your player, tap outside to finish' hint. Run the discriminating log first: on a frame-3 away state log pickedIndex and clickedDetection in handleHighlightComplete (OverlayContainer.jsx:589) for a click inside the ellipse; -1 and null confirms.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/overlay/hooks/useGuidedAthletePick.js`
- `src/frontend/src/containers/OverlayContainer.jsx`
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/components/settings/OverlaySpotlightPanel.jsx`
- `harness: t11570walkdiag/`

### Related Tasks

- Decision Q13. T12280 (spotlight guide copy) follows.

### Test first (red before green)

Hook test: tracked index 2, clickedDetection null, currentTime at marker 3, expect phase 'parked' (today 'away'). Component test: walk active, pointerdown/up inside the circle away from any box, expect a keyframe add (today only onCircleTap).

### Technical Notes

Knowledge doc keyframes-framing.md. Timing/state interplay: escalate to the expert agent if the first fix attempt fails.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T11980:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] With the playhead within tolerance of the tracked marker the guide never says 'Go to frame N' (parked state)
- [ ] A tap inside the circle on an unpicked moment either picks or shows an explicit hint; never silent
- [ ] Box taps inside the circle still pick
- [ ] No reactive persistence added: picks persist only through the existing gesture path
- [ ] Relevant tests pass and lint is clean
