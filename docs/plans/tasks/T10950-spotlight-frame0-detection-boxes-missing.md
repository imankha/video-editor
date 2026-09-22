# T10950: Spotlight can show zero player-tracking boxes at a clip's opening frame

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

Reported live on prod by imankh@gmail.com (project `VID_20260905_094101`): after exporting from
Framing, scrubbing to the start of the clip in Spotlight shows no green player-detection boxes,
even though boxes appear correctly a fraction of a second later (confirmed in the user's
screenshot — "7 players detected", boxes visible at ~0.65s).

**Root cause (confirmed by code read, not yet by live data — see Investigation below):**
Player detection is NOT run every frame. `run_player_detection_for_highlights`
(`src/backend/app/routers/export/multi_clip.py:833`) samples exactly **4 points per highlight
region**, spaced across the first 2 seconds (0%, 33%, 66%, 100% via
`calculate_detection_timestamps`, line 786). The editor only renders boxes when the scrubber is
within **±2 frames** of one of those 4 sampled points (`OverlayContainer.jsx`'s
`regionDetectionData` memo, line 290, `DETECTION_FRAME_THRESHOLD = 2` at line 347) — there is no
interpolation between samples and no fallback when a sample comes back empty.

If YOLO finds zero confident person boxes at the literal first sample (nominally frame 0,
`math.ceil`'d to land at-or-after the clip boundary — multi_clip.py:817), the user sees nothing at
the clip's start even though the region has real detections a few frames later. Frame 0 is already
a known weak frame for vision tasks in this codebase — `poster.py` has an explicit "avoid frame 0"
rule for the same underlying reason (motion blur / clip-cut artifacts right at the boundary). T9250
(`tasks/on-fire/T9250-dense-tracking-feet-fire.md`) separately documents today's 4-samples-per-2s
scheme as a known-sparse baseline pending future dense tracking.

## Investigation notes (2026-09-21)

Traced the live prod project to confirm export health, not to inspect the actual detection
payload — the project had already been **published** by the time it was checked
(`projects.archived_at = 2026-09-22 01:04:58`), and publishing intentionally deletes the
`working_videos` row (`project_archive.py` — by design, not related to this bug: the rendered
output already lives in `final_videos`). So the exact detection blob that was live when the user
saw the gap is gone; this task is filed on the code-level mechanism, not a captured repro payload.
Both export jobs for the project (`framing` @ 00:56:30, `overlay` @ 01:04:38) completed cleanly
with no errors — this is not a failed-export or data-loss issue.

## Solution (proposed, not yet designed in detail)

**Recommended:** frontend-only fallback in `OverlayContainer.jsx`'s `regionDetectionData` memo —
when no sample is within the ±2 frame threshold (or the nearest one has zero boxes), fall back to
the closest sample *in the current region that actually has boxes*, instead of showing nothing.
Guarantees a user scrubbing anywhere inside a region with at least one successful detection always
has something to click, without any backend/GPU cost change.

Alternative considered: sample 2-3 extra detection points near the very start of each region
(backend, small extra GPU cost per export) to reduce the odds of the first sample whiffing in the
first place. Left as an option, not the default — the frontend fallback is strictly cheaper and
fixes the symptom regardless of which sample misses.

## Context

### Relevant Files
- `src/frontend/src/containers/OverlayContainer.jsx` — `regionDetectionData` useMemo (~line 290),
  the frame-matching + ±2 frame threshold gate
- `src/backend/app/routers/export/multi_clip.py` — `calculate_detection_timestamps` (line 786),
  `run_player_detection_for_highlights` (line 833) — sampling scheme, not expected to change for
  the recommended fix
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` — pure render of whatever
  `detections` prop it's given, no change expected

### Related Tasks
- [T10870](T10870-surface-detection-fallback-message.md) — adjacent but distinct: surfaces the
  *project-wide zero-detections* fallback message (centered default box, no players found at all).
  This task is about a *partial* miss (one sample in an otherwise-successful region), and proposes
  filling the gap with a real nearby detection rather than messaging around an empty one.
- Related future work: T9250 (dense per-frame tracking) would make this moot for fire regions, but
  is separately scoped and far larger (Modal `model.track`, new storage) — not a prerequisite.

### Technical Notes
No schema change. No new abstraction — extends the existing closest-match search already in
`regionDetectionData` to track a second candidate (closest sample *with* boxes) and use it as a
fallback. See the reverted draft in commit history of this session for a concrete sketch of the
diff shape (tracks `closestWithBoxes`/`closestWithBoxesDistance` alongside the existing
`closestDetection`/`closestFrameDistance`, and falls back to it when the exact-proximity match is
absent or itself empty).

## Implementation

### Steps
1. [ ] Confirm approach with user at classification time (frontend fallback vs. more backend samples)
2. [ ] Implement the fallback in `regionDetectionData`
3. [ ] Add a focused test case (region with a whiffed first sample + a later sample with boxes ->
   boxes shown at frame 0)
4. [ ] Manual check in Spotlight on a real multi-detection region

### Progress Log

**2026-09-21**: Filed from a live prod bug report + code investigation. User chose not to
implement immediately; task filed for later pickup.

## Acceptance Criteria

- [ ] Scrubbing to a sample point with zero detections, inside a region that has at least one
  other sample with detections, shows the nearest available boxes instead of nothing
- [ ] No change in behavior when the exact-proximity match already has boxes (existing behavior
  preserved)
- [ ] Tests pass
