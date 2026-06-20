# T3800: Shared Keyframe Persist Wrapper

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-06-20
**Updated:** 2026-06-20

## Problem

Crop ([FramingContainer.jsx](../../../src/frontend/src/containers/FramingContainer.jsx)) and
overlay ([OverlayScreen.jsx](../../../src/frontend/src/screens/OverlayScreen.jsx)) each
hand-roll the same "edit a keyframe" persistence sequence:

1. resolve which keyframe the edit targets (snap),
2. optimistically update the Zustand clip/region store,
3. fire the surgical backend action,
4. roll back store + hook on failure.

Because the sequence is duplicated, the **same bug appeared in both**: the persistence
layer sent the *raw* clicked frame/time while the display layer snapped, so the backend
appended a near-duplicate keyframe (overlapping-keyframe / lost-boundary bug). The
divergence fix (branch `fix/crop-keyframe-dup-snap`) patched both sites independently via
`resolveTargetFrame` (crop) and a `movedFromFrame` return (overlay) — but the duplicated
shape means the next person can reintroduce the mistake in either place.

## Solution

Extract a single keyframe-persistence helper/hook that makes the snap-vs-raw mistake
unrepresentable. It owns: identity resolution, optimistic store write, surgical backend
call, and rollback. Crop and overlay both consume it (passing their mode-specific
`actions` client + store updater). One code path, one place to get identity right.

This is a **DRY consolidation, not a behavior change** — land it only after the
`fix/crop-keyframe-dup-snap` fix is merged, and assert identical behavior via the existing
keyframe tests.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/FramingContainer.jsx` — `handleCropComplete`, `handlePasteCrop` (crop persist sites)
- `src/frontend/src/screens/OverlayScreen.jsx` — `wrappedAddHighlightRegionKeyframe` (overlay persist site)
- `src/frontend/src/utils/keyframeUtils.js` — `resolveTargetFrame` (the shared identity rule; reuse, don't duplicate)
- `src/frontend/src/api/framingActions.js` / `src/frontend/src/api/overlayActions.js` — surgical action clients
- New: a `useKeyframePersistence` hook or `persistKeyframeEdit()` helper

### Related Tasks
- Follows: keyframe-identity divergence fix on branch `fix/crop-keyframe-dup-snap` (crop + overlay persist sites, profile_db v015 heal)
- Related: T2000 (Overlapping Crop Keyframes — shallower restore-path cause, DONE), T3820 (reconcile snap directions)

### Technical Notes
- Crop keys keyframes by **frame** (exact-match backend); overlay keys by **time** (0.02s
  tolerance backend) and stores per-region. The wrapper must abstract the key type.
- Overlay's snap MOVES a keyframe; the wrapper must support emitting a `delete(oldKey)` +
  `add(newKey)` pair to mirror a move (see `movedFromFrame` handling added in the fix).
- Keep the gesture-based persistence rule (CLAUDE.md): no reactive writes; the wrapper is
  still called from gesture handlers only.

## Implementation

### Steps
1. [ ] Define the shared persist contract (resolve → optimistic store → surgical call → rollback), parameterized by key type + actions client.
2. [ ] Migrate crop `handleCropComplete` + `handlePasteCrop` onto it.
3. [ ] Migrate overlay `wrappedAddHighlightRegionKeyframe` onto it (including move → delete+add).
4. [ ] Delete the now-duplicated inline logic.
5. [ ] Confirm `keyframeController`, `useKeyframeController`, `CropLayer`, `useHighlightRegions` tests still pass.

## Acceptance Criteria
- [ ] One shared code path performs keyframe-edit persistence for both modes.
- [ ] No persist site computes a raw frame/time independent of the resolved identity.
- [ ] Existing keyframe unit tests pass unchanged (no behavior change).
