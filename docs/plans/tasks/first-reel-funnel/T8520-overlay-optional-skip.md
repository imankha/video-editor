# T8520: Overlay is an offer, not a stage

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

On Focus-export completion the app auto-navigates into Overlay mode with no explanation.
The only forward CTA is "Add Overlay"; there is no visible skip. The landing page's
promised journey (upload, mark plays, share) never mentions overlays, so a first-time
user reads this as a mandatory stage and either engages with a feature they did not ask
for or stalls one screen before the payoff. This is one of the extra gestures inflating
the promised 3 steps to a real 8 (walkthrough 2026-09-02).

## Solution

- On export completion, present an explicit choice instead of a silent mode switch:
  "Your reel is exported and ready to share." with primary "Add a highlight overlay?"
  framing Overlay as optional, and a co-equal "Skip, my reel is ready" action that goes
  straight to the reel (coordinates with T8530/T8400 landing).
- If the user enters Overlay, nothing else changes; the feature itself is fine
  (pre-created region + sensible defaults stay).
- Copy history constraint: T7700 reversed T7580's "Create Reel" label on the Overlay
  finish button per user request. Do not relitigate that; this task changes the
  TRANSITION INTO Overlay, not the finish button.

## Context

### Relevant Files (REQUIRED)
- Export-completion navigation (locate: FocusScreen.jsx / export completion handler that routes to /overlay)
- `src/frontend/src/screens/OverlayScreen.jsx` or equivalent mode host
- `src/frontend/src/stores/exportStore.js` - completion event

### Related Tasks
- T8530 (auto-advance) + T8400 (land on the reel) define where "Skip" goes; coordinate
- ui-designer pass for the choice surface (small, non-modal if possible)

## Implementation

### Steps
1. [ ] Locate the auto-nav; replace with the offer (or land on the reel with an Overlay upsell, per ui-designer)
2. [ ] "Skip, my reel is ready" routes to the reel surface
3. [ ] e2e: both paths (overlay taken, overlay skipped) reach a shareable reel
4. [ ] 390x844 pass

## Acceptance Criteria

- [ ] No silent auto-navigation into Overlay after export
- [ ] A visible skip path exists and reaches the reel in one tap
- [ ] Overlay finish-button copy untouched (T7700 stands)
