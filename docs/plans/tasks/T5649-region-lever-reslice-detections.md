# T5649 — Dragging a region lever doesn't re-slice detections (frame-0 tracker box never shows)

**Tier:** M · Frontend. **Model:** Opus. Follows T5600 (detections decoupled) / T5644 / T5646.

## Symptom
Mobile Overlay: after delete + re-add of a region, the levers drag fine, but dragging the BEGIN
lever to include time 0 never shows the "initial tracker box" (the frame-0 player detection).

## Root cause (verified — NOT a lever/clamp problem)
The begin lever CAN reach 0 and `startTime` DOES become 0 (`moveRegionStart` uses `minStart = 0`,
`useHighlightRegions.js:409`; the pixel→time map yields exactly 0). The real defect: a region's
`detections` slice is computed ONCE in `addRegion` (`useHighlightRegions.js:364`
`sliceDetections(videoDetections, start, end)`) and then **frozen**. `moveRegionStart` (~L432–436)
and `moveRegionEnd` (~L471–475) return `{...region, startTime/endTime, keyframes}` and OMIT
`detections`, so the slice is never recomputed when a lever moves. Drag start from 3→0 and the
region keeps its old `[3,5]` slice — the `timestamp:0` detection is never pulled in, so the
tracker box (rendered from `region.detections`, consumed at `OverlayScreen.jsx:286` + the detection
marker/overlay layers) never appears.

## Fix (single file: `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`)
Re-slice detections inside both move handlers using the in-scope `videoDetections`:
- `moveRegionStart` return (~L432): add
  `detections: sliceDetections(videoDetections, snappedStart, region.endTime),` and add
  `videoDetections` to its dependency array (~L438, currently `[framerate]`).
- `moveRegionEnd` return (~L471): mirror —
  `detections: sliceDetections(videoDetections, region.startTime, snappedEnd),` + add
  `videoDetections` to its deps (~L477).
Touch ONLY `detections`; leave `startTime/endTime`, `MIN_REGION_DURATION` (maxStart), and the
prev/next-region overlap guards untouched. No backend change (detections are never persisted
per-region; the wrapped handler `OverlayScreen.jsx:675` persists only start/end, which is correct).

## Acceptance criteria
- Dragging the begin lever to 0 re-slices detections so the region includes the frame-0 detection →
  the initial tracker box appears (desktop markers + mobile boxes).
- Dragging either lever generally updates the region's detections to match the new [start,end].
- End-lever + overlap guards + min-duration cap unchanged (regression).

## QA (mandatory)
- Unit test the gap the T5600 suite missed: after `moveRegionStart`/`moveRegionEnd`, `region.detections`
  equals `sliceDetections(videoDetections, newStart, newEnd)` (e.g. start 3→0 pulls in the
  timestamp-0 detection; end shrink drops out-of-range detections). Add to
  `useHighlightRegions.detections.test.js` (or persistence.test.js). Negative control encouraged.
- No backend in container → give a precise manual staging test (Overlay: re-add region, drag begin
  lever to 0, confirm initial tracker box appears). Map criteria to evidence. Update
  `.claude/knowledge/keyframes-framing.md` (detection-slice recompute on lever move).
Own ONLY `useHighlightRegions.js` (+ its tests). Explicit `git add`. **Commit + report — do NOT push.**
