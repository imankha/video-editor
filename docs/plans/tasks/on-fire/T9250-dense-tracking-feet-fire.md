# T9250: Dense tracking for feet fire + scorch footprints

**Status:** TODO
**Impact:** 5
**Complexity:** 7
**Created:** 2026-09-08
**Updated:** 2026-09-08

Epic 5/6 of [On Fire](EPIC.md). See EPIC.md section A (motion source options) for why v1 uses the interpolated ellipse and this task upgrades it.

## Problem

With the v1 motion source the flame follows the spotlight ellipse, whose position between user keyframes is a spline. With two keyframes that is a straight line: the trail cannot react to a cut, a stutter-step, or a stop, and there is no true feet position for scorch footprints. Detection data today is 4 frames per clip in the first 2 s, so nothing exists to improve on.

## Solution

1. **Dense track on the fire region span only.** New Modal function `track_region_modal` on `yolo_image`: decode the WORKING video frames in `[start, end]` (every frame, or every 2nd when the span exceeds 15 s), run Ultralytics `model.track(persist=True, tracker="bytetrack.yaml", classes=[0])` (built into the already-installed `ultralytics`, no new dependency), and return per-frame `{frame, track_id, bbox}` for all persons.
2. **Pick the athlete's track.** Backend chooses the track whose boxes have the highest mean IoU with the user's interpolated ellipse over the span (the user's keyframes are the ground truth of "who"). Ties or IoU below 0.3 fall back to the spline for that frame.
3. **Feet + smoothing.** Feet point = bbox bottom-center, smoothed with a 1-euro filter (mirrored in the placement spec so preview and export agree); gaps shorter than 0.5 s are bridged by the spline (T2160's gap-bridging rule).
4. **Storage.** The dense track is DERIVED at export time and cached in a new msgpack key `heat_tracks` on the region dict (frame-indexed feet points only, ~24 bytes per frame). It is a render input, not user state; a framing re-export invalidates it (the carry-forward marks it stale). No migration.
5. **Preview.** The frontend reads `heat_tracks` from `/overlay-data` when present and feeds it to `heatPlacements`; when absent it uses the spline exactly as v1, so preview never blocks on a Modal call.
6. **Footprints.** `heat_placements` gains `scorch` placements: a fading ember decal dropped at the feet point every 0.25 s while `fire`, lifetime 1.5 s. Parity test extended.
7. **Credits.** Dense tracking is GPU time; add its estimated cost to the T5790 export estimate and charge it on the backend with the same calculator.

## Context

### Relevant Files
- `src/backend/app/modal_functions/video_processing.py` (new `track_region_modal`, inline 1-euro filter)
- `src/backend/app/modal_client.py`, `src/backend/app/routers/export/multi_clip.py` (export finalize call site next to `run_player_detection_for_highlights`)
- `src/backend/app/services/heat_tracks.py` (new: track selection, smoothing, gap bridge)
- `src/backend/app/services/highlight_carry.py` (stale-mark on re-export)
- `src/frontend/src/utils/heatPlacements.js`, `src/frontend/src/hooks/useHighlightRegions.js`
- `src/backend/tests/test_heat_tracks.py` (new)

### Related Tasks
- Depends on: T9230; shares design with T2160 (re-acquisition + gap bridging) and T2220 (multi-player tracking). If either lands first, consume its track store instead of adding `heat_tracks`.
- Blocks: T9260

### Technical Notes
- Budget: YOLOv8x at imgsz 640 on a T4 is roughly 30 ms/frame; a 10 s region is ~300 frames, ~10 s GPU. Batch all fire regions of a reel in one call. The 300 s cap of `detect_players_batch_modal` is the reference; give the new function its own timeout.
- Keep the person-only class filter here; ball detection is T9260's spike, not a side effect of this task.
- Never run this on the raw game video: the working video is already cropped and upscaled around the athlete, so the person is large and centered.

## Acceptance Criteria

- [ ] Fire regions get a dense feet track at export; the trail visibly reacts to a direction change within 3 frames
- [ ] Track selection picks the athlete the user keyframed (IoU test against a synthetic multi-person fixture)
- [ ] Gaps under 0.5 s bridge through the spline with no flicker
- [ ] Preview without a track equals v1 behavior; with a track equals export (parity test extended)
- [ ] Credit estimate and backend charge include the tracking cost and agree
- [ ] Modal deploy verified on staging, then prod (user gate)
