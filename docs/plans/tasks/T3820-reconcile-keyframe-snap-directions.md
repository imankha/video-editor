# T3820: Reconcile Keyframe Snap Directions (Crop vs Overlay)

**Status:** TODO
**Impact:** 4
**Complexity:** 4
**Created:** 2026-06-20
**Updated:** 2026-06-20

## Problem

Crop and overlay resolve "I edited a keyframe near an existing one" in **opposite**
directions, and with **different snap windows**:

| | Snap rule | Window |
|---|---|---|
| Crop ([keyframeController.js](../../../src/frontend/src/controllers/keyframeController.js)) | KEEP the existing keyframe's frame, update its data | `FRAME_TOLERANCE` = 10 frames |
| Overlay ([useHighlightRegions.js](../../../src/frontend/src/modes/overlay/hooks/useHighlightRegions.js)) | MOVE the existing keyframe onto the clicked frame | `MIN_KEYFRAME_DISTANCE_FRAMES` = 5 frames |

Two different behaviors for the same gesture is an inconsistent UX (in crop the diamond
stays put; in overlay it jumps to the playhead) and a maintenance hazard — the
keyframe-identity divergence bug was harder to reason about precisely because the two
modes disagree on what "snap" means. The differing windows (10 vs 5) compound it.

## Solution

**Product decision required first**, then unify. Likely the user's mental model is
"the keyframe lands where the playhead is" (overlay's move-to-clicked behavior), since the
edit happens at the current frame — but this needs a UX call, because crop's keep-old
behavior is long-standing and front-trim/boundary logic depends on stable boundary frames.

Pick one direction + one window, apply to both modes, and update the shared
`resolveTargetFrame` / snap helpers accordingly. This is **not a pure refactor** — it
changes observable editing behavior for at least one mode, so it needs test + manual-QA
coverage.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/controllers/keyframeController.js` — crop snap (`ADD_KEYFRAME`, `resolveTargetFrame` usage)
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` — overlay snap (`addOrUpdateKeyframe`, `MIN_KEYFRAME_DISTANCE_FRAMES`)
- `src/frontend/src/utils/keyframeUtils.js` — `FRAME_TOLERANCE` / `resolveTargetFrame` (shared identity rule)
- Tests: `keyframeController.test.js`, `useHighlightRegions.test.js`, `keyframeUtils.test.js`

### Related Tasks
- Surfaced by the keyframe-identity divergence fix (branch `fix/crop-keyframe-dup-snap`)
- Pairs well with T3800 (shared persist wrapper) — do the wrapper first so the behavior
  lives in one place, then change direction once.

### Technical Notes
- Crop boundary/trim code (`ensurePermanentKeyframes`, front-trim virtual `trimRange`)
  assumes the permanent boundary frames at 0 and end are stable. If crop switches to
  move-to-clicked, verify boundary keyframes are excluded from the move (you must never
  drag frame 0 or the end boundary off its position).
- Whatever window is chosen, `MIN_KEYFRAME_SPACING` (the dedup/spacing invariant and the
  v014 heal threshold) must stay consistent with it.

## Implementation

### Steps
1. [ ] Get the UX decision: keep-old vs move-to-clicked; single snap window value.
2. [ ] Apply the chosen rule in `resolveTargetFrame` + both consumers.
3. [ ] Guard permanent boundaries against being moved (if move-to-clicked is chosen).
4. [ ] Update unit tests to the unified behavior; add manual-QA steps for both modes.

## Acceptance Criteria
- [ ] Crop and overlay snap identically (same direction + window).
- [ ] Permanent boundary keyframes cannot be displaced by an edit.
- [ ] Unit tests reflect the unified behavior and pass.
