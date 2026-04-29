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

`ensurePermanentKeyframes` (in useCrop) adds boundary keyframes at frame 0 and endFrame on every restore. When saved keyframes already include a frame-0 keyframe (or one very close to it), the restore creates a duplicate. The frame range mismatch errors suggest the clip's trim range changed between save and restore, so the "permanent" boundary keyframes are recalculated at different positions than what was saved — but the saved ones aren't removed.

Additionally, `T1400` (Framing Keyframe Dedup) added `MIN_KEYFRAME_SPACING` snap logic, but it may not apply during the restore path in `useCrop`, only during user gestures.

## Context

### Relevant Files
- `src/frontend/src/hooks/useCrop.js` — Keyframe restore logic (line 187), `ensurePermanentKeyframes`
- `src/frontend/src/modes/framing/components/CropOverlay.jsx` — Crop keyframe add gesture (line 332)
- `src/frontend/src/modes/framing/components/SegmentLayer.jsx` — Segment layer keyframe click (line 96)
- `src/frontend/src/modes/framing/framingActions.js` — Surgical action dispatch to backend
- `src/frontend/src/containers/FramingContainer.jsx` — Framing orchestration

### Related Tasks
- T1400 (Framing Keyframe Dedup) — Added MIN_KEYFRAME_SPACING snap, but may not cover restore path
- T1660 (Framing Gesture Persistence) — Audit of framing gesture fire-and-forget; related persistence path

### Technical Notes
- The restore errors show `duration=undefined` in one case, suggesting the clip metadata may not be fully loaded when useCrop's layout effect runs
- FPS varies between clips (30 vs 29.97), so frame calculations may produce fractional positions that don't dedup properly
- The overlap appears at the clip start boundary, consistent with `ensurePermanentKeyframes` duplicating a frame-0 keyframe

## Acceptance Criteria

- [ ] No two crop keyframes can exist at the same frame position
- [ ] `ensurePermanentKeyframes` deduplicates against existing saved keyframes on restore
- [ ] Frame range mismatches during restore are handled without creating orphan keyframes
- [ ] MIN_KEYFRAME_SPACING applies uniformly to both gesture and restore paths
