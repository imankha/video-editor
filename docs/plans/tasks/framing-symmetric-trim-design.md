# Design: Symmetric Virtual Trim for Framing

> **UPDATE (2026-06-21): Pivoted to the simpler flat-list model.** After Phase 2,
> we concluded the permanent start/end keyframe concept added complexity the
> interpolation clamp already covers. We DROPPED permanent boundaries entirely:
> crop keyframes are now a flat list (1 kf = constant crop, 0 = default), trim
> stays virtual, and any keyframe is freely deletable. This **replaces Phases 3 & 4**
> (no backend permanents, no re-extend migration needed — existing 'permanent'
> keyframes load as ordinary keyframes). The original "minimum 2 keyframes" bug is
> dissolved rather than guarded. Highlights (Overlay) remain a follow-up.

**Status:** Phase 2 + flat-list pivot implemented
**Origin:** Follow-up to the keyframe-delete fix (commit 730a0362). User asked to make
trim handling symmetric between start/end and consistent across frontend/backend, including
N-level "trim over trim".

## Problem

Start and end boundaries are modeled by two different mechanisms:

- **Start** = fixed at frame 0. Trim is purely virtual (`trimRange.start` filters display).
  Frame 0 permanent is never moved or dropped.
- **End** = "the last keyframe" (mutable). End-trim DROPS keyframes beyond the new end
  (`SET_END_FRAME` filters `frame <= endFrame`), moves the end permanent to `trimRange.end`,
  and deletes user keyframes in the trimmed range from the backend.

Consequences:
1. End-trims orphan old permanent keyframes in the backend (cruft; masked on load by
   `SET_END_FRAME`; load-order fragile; cleaned only on next full export).
2. Detrim is lossy — crop keyframes in a trimmed region are deleted, so detrim restores the
   range but not the animation.
3. **Export correctness currently DEPENDS on the destructive model.** Backend/Modal
   interpolates over ALL persisted keyframes and clamps to first/last
   (`_interpolate_crop`, video_processing.py). Because end-trim drops out-of-range
   keyframes, the clamp lands on the right value. A latent bug already exists: any keyframe
   beyond `trim_end` becomes the clamp ceiling and corrupts the animation.

## Target model

Both boundaries are **fixed absolute frames**: `0` (start) and `totalFrames = round(fullDuration * fps)`
(end), where `fullDuration` is the UNTRIMMED clip duration. Trim is **purely virtual on both
sides**: `trimRange = {start, end}` only marks the visible/exported window. Keyframes are NEVER
dropped or deleted on trim/detrim.

Result: both permanents always exist, trim/detrim is non-destructive and symmetric, detrim is
lossless, the backend stops accumulating orphans, and the backend can own both permanents.

## Findings that shape the plan

- **Display:** `CropLayer.jsx` already filters keyframes by `trimRange` (start side confirmed;
  end-side filter to verify). Timeline x-axis maps via `visualDuration`/`sourceTimeToVisualTime`,
  not the last keyframe — compatible. Interpolation (`splineInterpolation.js`) clamps to
  first/last and does not assume last == boundary — compatible.
- **Blocker:** `useCrop.js:193-206` effect sets endFrame to `round(trimRange.end * fps)` on trim
  and the model assumes `keyframes[last].frame === endFrame`.
- **Export:** frontend `saveCurrentClipState` sends all keyframes + `trimRange`; backend
  `routers/export/framing.py` + `multi_clip.py` convert frame->time for all keyframes; Modal
  `video_processing.py` loops the trim frame range and interpolates over all keyframes with
  clamp-to-boundary. **No keyframe clipping anywhere.**

## Plan (sequenced; each phase independently shippable)

### Phase 1 — Export-side trim clipping — **NOT NEEDED (verified)**
Re-investigation of the actual render path showed the export is ALREADY compatible with virtual
trim, so no export changes are required:
- Modal (`video_processing.py:2587-2598`) loops the trim frame-range `range(start_frame, end_frame)`
  and computes `frame_time = frame_num / fps` — **clip-absolute, 0-based**.
- Keyframes (`framing.py:561`) are `time = frame / framerate` — **also clip-absolute, 0-based**.
- `_get_trim_range` returns trim in the **same** clip-relative space.
- Both the editor (`useKeyframeController.interpolate` over full `state.keyframes`) and Modal
  (`_interpolate_crop` over all sorted keyframes) interpolate the SAME absolute keyframes the
  SAME way. Trim just selects the frame range. Keyframes outside the window only influence the
  Catmull-Rom tangent near the boundary — identically in editor and export.
- The earlier "export bug" claim was an arithmetic slip (frame numbers compared to seconds).

Conclusion: virtual trim keeps editor and export consistent by construction. The production
Modal/export path does NOT need changes. Verify with a real end-to-end export after Phase 2.

### Phase 2 — Make trim virtual in the frontend model
- End permanent fixed at `totalFrames = round(fullDuration * fps)` (full duration), never moved.
- `useCrop.js:193-206`: derive endFrame from FULL duration, not `trimRange.end`.
- `SET_END_FRAME`: stop dropping keyframes `> endFrame` on trim; only used to establish the end
  permanent at totalFrames once duration is known.
- `handleTrimSegment` / `handleDetrimStart` / `handleDetrimEnd`: remove all keyframe surgery
  (no `deleteKeyframesInRange`, no `setCropEndFrame`, no `boundaryKfToAdd`, no
  `deleteCropKeyframe`). They only toggle the range and persist `setTrimRange` /
  `clearTrimRange`. (Large simplification.)
- Verify `CropLayer` filters BOTH sides by `trimRange` (add end-side filter if missing).
- Tests: trim/detrim N levels on both sides is non-destructive; keyframes survive a
  trim->detrim round trip; reducer + container tests.

### Phase 3 — Backend ensures both permanents
- Backend guarantees permanents at frame 0 and `totalFrames`. Requires `fullDuration * fps`:
  extend the action query (`_get_clip_framing_data`) to fetch fps + duration (join already used
  elsewhere in clips.py).
- Backend no longer receives keyframe-surgery gestures from trim (Phase 2 removed them).
- Tests: backend keeps a clean full-range keyframe set across trim actions.

### Phase 4 — Heal existing data
- Existing clips have end permanents at the trimmed end + possible orphans. New load logic
  (`ensurePermanentKeyframes` with totalFrames) self-heals for display/edit; persisted data is
  corrected on next save/export.
- Optional `profile_db` migration to re-extend end permanents to `totalFrames` and drop orphans
  (mirrors the v014 heal). Deleted user keyframes in old trimmed regions are unrecoverable
  (acceptable for legacy data).

## Decisions needed
1. **Export clipping location:** backend render (recommended — single source, covers all export
   paths, keeps persisted data full) vs frontend pre-export.
2. **Existing data:** load-time self-heal only (recommended to start) vs add a profile_db
   migration now.
3. **Rollout:** ship Phase 1 first and verify exports, then Phase 2-4 (recommended) vs implement
   all phases then test together.

## Risk
High — touches the production render/Modal path and the core editing model. Mitigated by
sequencing (Phase 1 is a safe, standalone correctness fix) and tests at each phase.
