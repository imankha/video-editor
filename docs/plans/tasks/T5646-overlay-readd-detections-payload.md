# T5646 — Re-added overlay region loses tracking boxes (video-level detections nulled)

**Tier:** M · Frontend. **Model:** Opus. Follows T5644 (which made re-add persist) + T5600 (detections decoupled).

## Symptom
In Overlay, after DELETE + RE-ADD of a highlight region, the player tracking boxes don't appear.
Desktop: "couldn't get the first tracking frame" (no clickable detection marker to seed the
tracking keyframe). Mobile: "no player tracking boxes" on the video. Only in the fresh-export
(framing→overlay) session; a plain reload works.

## Root cause (verified — do NOT re-investigate from scratch)
In `src/frontend/src/screens/OverlayScreen.jsx`, the "Fresh export detected" effect (~lines
494–527) runs in the WRONG order:
- **~L501** `setHighlightVideoDetections(data.detections_data || null)` — sets the flat
  video-level payload.
- **~L511** `resetHighlightRegions()` → the hook's `reset()`
  (`src/frontend/src/modes/overlay/hooks/useHighlightRegions.js:154–160`) calls
  `setVideoDetections(null)` (**useHighlightRegions.js:159**), wiping the payload just set.
- **~L513** `restoreHighlightRegions(...)` — initial regions still show boxes because their
  `detections` were pre-sliced by the BACKEND into `highlights_data` (`overlay.py:~1690`), not
  from the frontend hold.

Net: `videoDetections` ends up `null`. On a later delete→re-add, `addRegion`
(`useHighlightRegions.js:357`) calls `sliceDetections(videoDetections, …)` which short-circuits
to `[]` when the payload is null (`useHighlightRegions.js:39`) → region created with
`detections:[]`, `videoWidth/videoHeight/fps:null` → no markers (DetectionMarkerLayer) and no
on-video boxes (PlayerDetectionOverlay via OverlayContainer `regionDetectionData`).

## Fix
Primary (small, low-risk): in the fresh-export effect, **set the detection payload AFTER
`resetHighlightRegions()`** — i.e. move `setHighlightVideoDetections(data.detections_data ||
null)` to run after L511 and before `restoreHighlightRegions` (L513) AND before the fallback
`addHighlightRegion(0)` (~L526, which also slices `videoDetections`).

More robust (do this too, or instead, with justification): `reset()` in useHighlightRegions.js
nulls `videoDetections` — but that's VIDEO-level state, not per-region. Either drop
`setVideoDetections(null)` from `reset()`, or add a region-only reset variant for the
"clear regions before restore" caller so video-level detections can't be clobbered by any future
caller. Pick one; explain the choice.

Do NOT change the backend — the read-path already re-slices `detections_data` onto every region
(`overlay.py:1688–1694`), which is why a full reload is fine.

## Acceptance criteria
- After delete→re-add of a region in a fresh-export overlay session, the new region has non-empty
  `detections` (sliced from the video-level payload) → detection markers appear (desktop) and
  on-video player boxes appear (mobile).
- The "first tracking frame" marker at the region start is clickable/seekable again.
- Plain-reload path still works (regression). Initial regions still show boxes.

## QA (mandatory)
Unit-test the ordering/behavior: after the fresh-export load sequence, `videoDetections` is
non-null and `addRegion` produces a region with sliced detections (extend
`useHighlightRegions.persistence.test.js` or add a load-ordering test). If the container has no
backend for a full loginAsRealUser drive, say so and give a precise manual staging test
(delete→re-add→boxes appear). Map every acceptance criterion to evidence. Update
`.claude/knowledge/keyframes-framing.md` (detection-slice hold lifecycle).
Own ONLY `OverlayScreen.jsx` + `useHighlightRegions.js` (+ their tests). Explicit `git add`.
