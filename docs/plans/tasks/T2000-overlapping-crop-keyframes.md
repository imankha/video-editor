# T2000: Overlapping Crop Keyframes on Framing Timeline

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-04-29
**Updated:** 2026-04-29

## Problem

Two crop keyframe diamonds overlap at the start of the framing timeline (see screenshot). This should not be possible — keyframes at the same or nearly identical frame positions produce ambiguous crop state and confuse the user.

### Screenshot

![Overlapping keyframes](overlapping-crop-keyframes.png)

The red-circled area on the crop (second) timeline row shows two diamond keyframes stacked on top of each other at the beginning of the clip.

## Log Evidence

Console logs show repeated `useCrop` restore errors indicating frame range mismatches between saved keyframes and the current clip bounds:

```
[useCrop] Restore: saved keyframes end at frame 410 but clip endFrame=301
  (trimEnd=10.046, duration=undefined, fps=30)

[useCrop] Restore: saved keyframes end at frame 217 but clip endFrame=249
  (trimEnd=8.285, duration=20, fps=30)

[useCrop] Restore: saved keyframes end at frame 410 but clip endFrame=599
  (trimEnd=undefined, duration=20, fps=29.97)

[useCrop] Restore: saved keyframes end at frame 599 but clip endFrame=195
  (trimEnd=6.513, duration=20, fps=29.97)
```

The errors fire from `useCrop.js:187` during `commitHookEffectListMount` (React layout effect).

Actions leading up to the overlap originate from:
- `CropOverlay.jsx:332` (adding a crop keyframe via drag)
- `SegmentLayer.jsx:96` (adding via segment layer click)
- `framingActions.js:29` / `framingActions.js:61` / `framingActions.js:111` (surgical action dispatches)

## Likely Root Cause

### Updated Analysis (2026-04-29 — T2000 diagnostic logging)

`ensurePermanentKeyframes` is NOT producing duplicate frames (no `console.error` fired). The function correctly deduplicates. The real issue is **multiple restore calls with different `endFrame` values**, creating a phantom 4th keyframe:

**Observed restore sequence (from diagnostic logs):**

| Call | Source | endFrame | fps | Result |
|------|--------|----------|-----|--------|
| 1st | Unknown (before useCrop) | 600 | 30 | 4 kf: 0, 71, 229→user, **600**(permanent) |
| 2nd | useCrop (trimRange available) | 229 | 30 | 3 kf: 0, 71, 229(permanent) ✓ |
| 3rd | useCrop (trimRange MISSING) | 599 | 29.97 | 4 kf: 0, 71, 229→user, **599**(permanent) |

**Root cause:** The `useCrop` useLayoutEffect depends on `[savedKeyframes, framerate, restoreKeyframes, videoMetadata, trimRange]`. When `framerate` changes (30 → 29.97 as video metadata arrives), the effect re-fires. But `trimRange` is not yet populated during that render cycle, so `effectiveDuration` falls back to `videoMetadata.duration` (full 20s video) instead of the trim boundary (7.634s). This creates a permanent keyframe at frame 599 — a ghost boundary the user never placed.

The saved keyframes have frame 229 as the last permanent (the trim boundary). When `endFrame=599`, `ensurePermanentKeyframes` correctly:
1. Demotes frame 229 from `permanent` to `user` (it's no longer the last)
2. Adds a new permanent at frame 599 (reconstituted from frame 229's data)

The "overlapping" diamond in the screenshot is likely this phantom permanent keyframe at 599/600 sitting at the end of the timeline.

### Fix Direction — Separation of Concerns

The current `RESTORE_KEYFRAMES` handler conflates two operations:
1. **Loading** saved keyframes (what the user actually saved)
2. **Adjusting boundaries** to match the current trim/duration

These should be separate actions. The saved keyframes already encode their own boundaries — the last permanent keyframe's frame IS the authoritative endFrame at save time. The restore handler should trust that, not recompute endFrame from external state that may be inconsistent.

**Current (broken) flow:**
```
useCrop effect fires → computes endFrame from trimRange ?? duration → passes endFrame + keyframes to RESTORE_KEYFRAMES
                        ↑ trimRange may not be populated yet, so endFrame is wrong
```

**Proposed flow — two-phase restore:**
```
Phase 1: RESTORE_KEYFRAMES(keyframes, framerate)
  → Load keyframes exactly as saved
  → Derive endFrame from the last permanent keyframe's frame (it's already correct)
  → No dependency on trimRange or videoMetadata.duration

Phase 2: SET_END_FRAME(endFrame)  [already exists]
  → Called separately when trim range becomes known / changes
  → Adjusts boundaries (filters beyond endFrame, adds permanent at new endFrame)
  → This handler already does exactly the right thing
```

**Why this is robust:** Phase 1 never needs external state — the keyframes carry their own truth. Phase 2 handles boundary adjustments as a separate concern, and it already exists (`SET_END_FRAME` in the reducer). The `useCrop` effect just needs to stop passing `endFrame` to restore and let `SET_END_FRAME` handle boundary changes independently.

**What changes:**
1. `RESTORE_KEYFRAMES` reducer: derive endFrame from keyframes' last permanent frame instead of `action.payload.endFrame`
2. `useCrop` restore effect: stop computing endFrame, stop depending on `trimRange` and `videoMetadata` — only depends on `savedKeyframes` and `framerate`
3. Boundary adjustment: already handled by `FramingContainer`'s `setCropEndFrame` calls which dispatch `SET_END_FRAME` when trim changes — no new code needed
4. Remove the `endFrame` parameter from `actions.restoreKeyframes()` and `useKeyframeController.restoreKeyframes()`

### Original Analysis (pre-logging)

`ensurePermanentKeyframes` (in keyframeController.js) adds boundary keyframes at frame 0 and endFrame on every restore. When saved keyframes already include a frame-0 keyframe (or one very close to it), the restore creates a duplicate. The frame range mismatch errors suggest the clip's trim range changed between save and restore, so the "permanent" boundary keyframes are recalculated at different positions than what was saved — but the saved ones aren't removed.

Additionally, `T1400` (Framing Keyframe Dedup) added `MIN_KEYFRAME_SPACING` snap logic, but it may not apply during the restore path in `useCrop`, only during user gestures.

## Context

### Relevant Files
- `src/frontend/src/controllers/keyframeController.js` — `ensurePermanentKeyframes` (line 151), `RESTORE_KEYFRAMES` reducer (line 258)
- `src/frontend/src/modes/framing/hooks/useCrop.js` — Keyframe restore useLayoutEffect (line 168), fallback to `videoMetadata.duration` when `trimRange` missing (line 181)
- `src/frontend/src/hooks/useKeyframeController.js` — `restoreKeyframes` dispatch (line 88)
- `src/frontend/src/containers/FramingContainer.jsx` — `setCropEndFrame` calls that also invoke `ensurePermanentKeyframes` via `SET_END_FRAME`
- `src/frontend/src/modes/framing/components/CropOverlay.jsx` — Crop keyframe add gesture (line 332)
- `src/frontend/src/modes/framing/components/SegmentLayer.jsx` — Segment layer keyframe click (line 96)
- `src/frontend/src/modes/framing/framingActions.js` — Surgical action dispatch to backend

### Related Tasks
- T1400 (Framing Keyframe Dedup) — Added MIN_KEYFRAME_SPACING snap, but may not cover restore path
- T1660 (Framing Gesture Persistence) — Audit of framing gesture fire-and-forget; related persistence path

### Technical Notes
- `ensurePermanentKeyframes` does NOT produce duplicate frames — dedup logic works correctly
- The bug is a **race condition**: `trimRange` is not available when `framerate` change re-triggers the restore effect
- FPS varies between clips (30 vs 29.97), causing the effect to re-fire when metadata arrives
- The first RESTORE_KEYFRAMES call (endFrame=600) fires BEFORE useCrop's restore — source unknown, may be from initial mount or another code path
- Diagnostic logging (prefixed `[T2000]`) is in keyframeController.js and useCrop.js — remove after fix

## Acceptance Criteria

- [ ] No two crop keyframes can exist at the same frame position
- [ ] `ensurePermanentKeyframes` deduplicates against existing saved keyframes on restore
- [ ] Frame range mismatches during restore are handled without creating orphan keyframes
- [ ] MIN_KEYFRAME_SPACING applies uniformly to both gesture and restore paths
