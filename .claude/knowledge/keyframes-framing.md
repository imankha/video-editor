---
domain: keyframes-framing
updated: 2026-07-21 (T5649 lever drags re-slice region detections; T5646 reset() must not null video-level videoDetections; T5644 region trim levers -> Pointer Events for mobile touch drag; re-add persistence root-caused to OverlayScreen stale-find)
---
# Keyframes & Framing — Domain Knowledge

## Scope
Crop keyframes, segments/trim, the Framing screen/mode, the shared keyframe controller, spline
interpolation, and the surgical persistence path for crop + highlight keyframes. Overlay highlight
keyframes are covered where they diverge from crop — they are the "one refactor behind" sibling
(see Keyframe System Unification epic).

## Entry points
- **Controller (pure)**: `src/frontend/src/controllers/keyframeController.js` — reducer + selectors,
  no React. State: `{machineState, keyframes[], isEndKeyframeExplicit, copiedData}` (L75-82).
  React wrapper: `src/frontend/src/hooks/useKeyframeController.js` (time↔frame conversion,
  `getKeyframesForExport`).
- **Identity SSOT**: `resolveTargetFrame` in `src/frontend/src/utils/keyframeUtils.js:87-90`
  (`FRAME_TOLERANCE = 10 = MIN_KEYFRAME_SPACING`, L67-68).
- **Crop hook**: `src/frontend/src/modes/framing/hooks/useCrop.js` (defaults, virtual trim, interpolation).
- **Screen/container**: `src/frontend/src/screens/FramingScreen.jsx`,
  `src/frontend/src/containers/FramingContainer.jsx` (gesture handlers, e.g. `handleCropComplete` L315-373).
- **Timeline layers**: `src/frontend/src/modes/framing/layers/CropLayer.jsx` (crop) vs
  `src/frontend/src/components/timeline/RegionLayer.jsx` (highlight — forked, stale rules).
- **Persistence helper**: `src/frontend/src/utils/persistKeyframeEdit.js` (T3800 single path);
  transport `src/frontend/src/api/framingActions.js`.
- **Spline math**: `src/frontend/src/utils/splineInterpolation.js`; backend mirror
  `src/backend/app/interpolation.py`.
- **Backend actions**: `POST /api/clips/projects/{project_id}/clips/{clip_id}/actions` →
  `framing_action` in `src/backend/app/routers/clips.py:326`. Overlay:
  `POST .../projects/{project_id}/overlay/actions` → `overlay_action` in
  `src/backend/app/routers/export/overlay.py:347`.
- **Store**: `src/frontend/src/stores/framingStore.js` — export dirty tracking is hash-based
  (`markExported`/`hasChangedSinceExport` L38-50).

## Data flow
```
gesture (drag/resize/delete) in FramingContainer
  → resolveTargetFrame(keyframes, rawFrame)          # snap identity FIRST
  → hook dispatch (optimistic) + store updateClipData
  → persistKeyframeEdit → framingActions.* (surgical POST, ONLY changed keyframe)
  → backend framing_action: read msgpack blob → mutate in memory → write back
```
- Crop keyframes live in `working_clips.crop_data` (msgpack, `src/backend/app/utils/encoding.py`):
  flat list of `{frame, x, y, width, height, origin}`. `None` when empty.
  Segments in `working_clips.segments_data`: `{boundaries[], segmentSpeeds{}, trimRange{}}`.
- Highlight keyframes live in `working_videos.highlights_data` (msgpack): region dicts, each with
  a `keyframes` list keyed by **time** (backend matches ±0.02s, overlay.py:339-344) — crop matches
  by **exact frame** (clips.py:318-323).
- Action names (framingActions.js): `add_crop_keyframe` `{frame,x,y,width,height,origin}`,
  `update_crop_keyframe`, `delete_crop_keyframe`, `move_crop_keyframe`, `split_segment`,
  `remove_segment_split`, `set_segment_speed`, `set_trim_range`, `clear_trim_range`.
  Responses may carry `refresh_required`/`new_clip_id`.
- Full-state save: `PUT /projects/{pid}/clips/{cid}` (clips.py:2001-2124) only on explicit export
  gesture. If clip was exported AND framing changed AND data differs → INSERT new working_clips
  version row (v+1, L2053-2098); else in-place UPDATE.
- Ratio changes: `POST /projects/{project_id}/aspect-ratio` (clips.py:562-648) is the refit writer —
  server-side center-preserving crop refit per clip (T3910). `useCrop.updateAspectRatio` deliberately
  does NOT rewrite keyframes locally (useCrop.js:265-268). Empty-crop clips stay empty; export
  defaults them.

## Invariants & rules
- **Flat list, no permanent boundaries** (permanent-frame model removed ~2026-06-21).
  `INITIALIZE` seeds ZERO keyframes (keyframeController.js:186-197); `ensurePermanentKeyframes` is
  now just a sort — endFrame arg ignored (L138-148); `REMOVE_KEYFRAME` protects nothing (L272-287);
  `SET_END_FRAME` is a no-op (L377-382). Any keyframe deletable, including the last one.
- **Empty list → default centered crop**: frontend `useCrop.js:293-307` (`?? defaultCropData`);
  backend export applies `default_crop_keyframes` when crop_data empty (`export/framing.py:565-573`,
  `export/multi_clip.py:2205-2217`); shapes mirrored: `DEFAULT_CROP_SIZES` in useCrop.js:17-20 ≡
  `src/backend/app/services/default_crop.py:12-15`. Keep these in sync.
- **Trim is virtual**: `segments_data.trimRange` never drops crop keyframes. CropLayer filters
  out-of-window keyframes for display only (CropLayer.jsx:49-60); useCrop end boundary is full
  duration (useCrop.js:188-199).
- **Keyframe identity: always resolve before persisting.** Display snaps to an existing keyframe
  within 10 frames; persistence MUST send the snapped frame, never the raw clicked frame, or the
  backend appends a near-duplicate. `resolveTargetFrame` is the SSOT; `persistKeyframeEdit` only
  accepts `resolution.targetKey` (no raw-key param) and mirrors snap-moves as del(old)+add(new)
  (persistKeyframeEdit.js:35-71).
- **Persistence is gesture-based and surgical.** No `useEffect` may write to store/API
  (project-wide ban, CLAUDE.md). Crop edits are awaited with rollback on failure; overlay edits are
  fire-and-forget (persistKeyframeEdit `awaited` flag).
- **Min spacing**: 10 frames (frontend `MIN_KEYFRAME_SPACING`, backend clips.py:315). Backend
  rejects too-close new keyframes (clips.py:392-399).
- **`'permanent'` origin still exists as a constant** (`src/frontend/src/constants/keyframeOrigins.js:8-12`)
  and CropLayer still reads it (L137/L142), but new crop keyframes are always `'user'`;
  `RESTORE_KEYFRAMES` normalizes origins to `'trim'|'user'` (controller L213-216). Treat
  `'permanent'` as legacy residue, not a live rule.
- **Delete gating**: CropLayer shows delete whenever `visibleKeyframes.length >= 1`
  (CropLayer.jsx:163-167) — every crop keyframe deletable. RegionLayer (highlight) still gates
  `!isPermanent && keyframes.length > 2` (RegionLayer.jsx:302) — that stale pre-flat-list rule IS
  the "can't delete first keyframe" bug, fixed by T4450.
- **Backend RMW pattern**: `_get_clip_framing_data` → mutate → `_save_clip_framing_data`
  (clips.py:267-309), in place, no version bump. Atomic only because there is no `await` between
  read and commit (audit B8 → T4360). Overlay same shape with `overlay_version+1`
  (overlay.py:379-393); its `expected_version` 409 check is commented out (overlay.py:384-391 → T4330).

## Overlay render read path (T4900)

`overlay.py` now has two canonical helpers for reading region bounds and filtering keyframes:

- **`_region_bounds(region)`** — tolerates BOTH key formats: camelCase `startTime`/`endTime`
  (written by surgical overlay actions / `overlay_action`) AND snake_case `start_time`/`end_time`
  (written by `highlight_transform.py` during framing export). Before T4900, the render path
  read `region['start_time']` directly → KeyError on action-written blobs.
- **`_keyframes_within_bounds(region, eps=0.04)`** — keeps keyframes inside the region's
  CURRENT (possibly extended) `[start, end]` bounds from `_region_bounds`. T4900 failure mode
  3: when the user extends a segment and adds keyframes past the original auto-boundary, the
  render path now honours the EXTENDED bound and keeps those keyframes. Before T4900, the
  inline filter used `region['start_time']`/`region['end_time']` hard-coded → any
  camelCase-written blob would KeyError; and even if it hadn't, the bounds were read before
  the extend action landed (persistence gap = the real failure mode in prod, not a render bug).
- **`_process_frames_to_ffmpeg`** uses both helpers for the region-active check and the
  keyframe filter. Do not inline them back to `region['start_time']`.
- **`_normalize_region_keys` also heals keyframe opacity keys (T5120, prod bug 32p).**
  Transform-restored highlight keyframes (`highlight_transform.py` raw_from_working /
  working_from_raw) carry only a single `opacity` and DROP `strokeOpacity`/`fillOpacity`.
  The spline helpers (`video_processing._spline_interpolate_highlight` `sp('strokeOpacity')`,
  `keyframe_interpolator._interpolate`) read those keys with BARE bracket access → KeyError
  mid-render → "Overlay processing failed: 'strokeOpacity'" toast. `_normalize_region_keys`
  now derives them from the `opacity` fallback (mirrors the sanctioned legacy branch
  overlay.py:998-999: stroke default 0.85, fill 0.05) at the SINGLE DB-read boundary, so
  every downstream spline consumer is fed complete keyframes. Do NOT sprinkle `.get()` into
  the spline helpers — normalize once at the boundary (same rule T4900 set for region keys).

**Persistence gap vs render bug:** In the 31p incident, failure mode 1 (actions never
reached the backend) was the primary cause — the DB held only the auto keyframe, so there was
nothing to render. Failure mode 3 (render clipping extended-segment keyframes) was ruled out
but sealed by the helper refactor as a defence-in-depth. The frontend `overlayActionStore`
failure-visibility fix is the correct fix for the primary cause (see persistence-sync.md).

## Spotlight entrance/exit reveal envelope (T5250)

The spotlight highlight used to POP on/off at a region's `[start, end]`. T5250 adds a
premium **reveal envelope** — a DERIVED, render-time visual layer (fade + slight
scale-up on entrance, ease-out; fade-out on exit, ease-in). It NEVER writes keyframes
(T350 corruption class avoided by construction) — it modulates only RENDERED
opacity/radii between the region bounds.

- **Shared spec, THREE mirrored copies** (crop/default-shape mirroring pattern — keep in
  sync or preview/export drift):
  - Frontend canonical: `src/frontend/src/utils/spotlightReveal.js`
    (`computeSpotlightReveal(t, start, end) -> {opacityFactor, radiusScale}`).
  - Backend canonical: `src/backend/app/services/spotlight_reveal.py`
    (`compute_spotlight_reveal(t, start, end) -> (opacity_factor, radius_scale)`).
  - Modal inline copy: `video_processing._spotlight_reveal` — inlined because the Modal
    image does NOT mount `app`, so it can't import the canonical module. Parity is pinned
    by `tests/test_spotlight_reveal.py::TestModalInlineParity`.
- **Constants**: entrance 0.35s, exit 0.25s, entrance start-scale 0.85 (radii bloom
  0.85→1.0). Each ramp is capped at `dur/2` so short regions still fade symmetrically.
  Easing: entrance ease-out quad `1-(1-p)^2`; exit ease-in quad `q^2` (q = remaining
  fraction). At exact region start/end opacity is 0 (invisible) → no pop. Mid-region both
  factors are 1.0 (no-op).
- **Application (identical in all render paths)**: `radiusX/radiusY *= radius_scale`
  applied to BASE radii BEFORE the ground transform; `opacity_factor` multiplies stroke,
  fill, dim vignette, AND outline blend so the WHOLE spotlight blooms together.
  - Frontend: `HighlightOverlay.jsx` takes a `reveal` prop (computed in `OverlayModeView`
    from the active region's `startTime/endTime` + `currentTime`). Applied DISPLAY-ONLY —
    the raw `currentHighlight` geometry the drag/resize commit reads is untouched, so
    editing never persists a scaled/faded value. (Editing exactly at a boundary shows the
    ramped display while committing true geometry — rare, harmless.)
  - Backend local path: `overlay._process_frames_to_ffmpeg` computes reveal from
    `_region_bounds(active_region)` + `current_time` and passes `reveal_opacity`/
    `reveal_scale` (new optional params, default 1.0) to
    `KeyframeInterpolator.render_highlight_on_frame`. `processor_local.py` render loop
    wired the same way. Modal path: `_render_highlight` computes it internally.
  - Applied AFTER `_normalize_region_keys` (T5120) — the envelope sits ON TOP of whatever
    the interpolator yields; no bare-key access added to the spline helpers.
- **Sibling render loops left as no-op** (default reveal 1.0): `frame_processor.py:186`
  and `ai_upscaler/__init__.py:883` are the framing+highlight combined passes using a flat
  highlight-keyframe model (no region `[start,end]` in scope) — reveal not wired there.
- **Modal caveat**: the `video_processing.py` change requires a Modal REDEPLOY before it
  takes effect in prod (separate user-gated step). Local/Fly render (containers, Modal
  off) already applies it via `_process_frames_to_ffmpeg`.
- Coverage: `spotlightReveal.test.js` (12) + `test_spotlight_reveal.py` (31, incl.
  Modal-inline parity). Glow/pulse was intentionally SKIPPED (hard to mirror 1:1 in
  ffmpeg; would jeopardise the preview==export bar).
- **Opt-in setting, default OFF (T5250 follow-up).** The reveal is NOT always-on — it's a
  per-project setting alongside the existing highlight_shape/stroke_width/fill_*/
  dim_strength tuning (same `working_videos` table row, same panel in `ExportButtonView`
  "Overlay Settings", same gesture-based surgical persist pattern: `wrappedSetX` in
  `OverlayScreen.jsx` → `dispatchOverlayAction` → `overlayActions.setRevealEnabled` →
  `overlay.py` `set_reveal_enabled` action → `UPDATE working_videos SET reveal_enabled`).
  Column `working_videos.reveal_enabled INTEGER DEFAULT 0` (migration
  `v028_reveal_enabled.py`, mirrors v005/v027's `PRAGMA table_info` idempotent-add
  pattern). Zustand `overlayStore.revealEnabled` (default `false`), restored from
  `GET /overlay-data`'s `reveal_enabled` field at BOTH restore call sites in
  `OverlayScreen.jsx`.
  - **The gate lives IN the shared spec function, not at each call site.**
    `computeSpotlightReveal`/`compute_spotlight_reveal`/`_spotlight_reveal` all take a 4th
    `enabled` param (default `true` — back-compat for direct unit-test calls); when
    `false` they return the identity `(1, 1)` immediately, before touching time/bounds —
    this is what makes "off" byte-identical to pre-T5250 rendering rather than a
    hidden/zeroed envelope. Frontend: `OverlayModeView`'s `spotlightReveal` useMemo passes
    `revealEnabled` through. Backend: `overlay._process_frames_to_ffmpeg` and
    `processor_local.apply_overlay` read `overlay_settings.get('reveal_enabled', False)`
    once before the frame loop; Modal's `_render_highlight` reads
    `settings.get('reveal_enabled', False)` (settings extraction was reordered to precede
    the reveal call). `overlay_settings.get(..., False)` means an old/un-migrated row (or
    any dict missing the key) defaults OFF automatically — no backfill needed.
  - Read path adds `wv.reveal_enabled` to both `overlay.py` SELECTs that build
    `overlay_settings` (the GET /overlay-data restore query and the render-endpoint query).

## Video-level player-detection store (T5600)

Player-detection "tracking squares" used to live ONLY inside each highlight region's
`detections` array in `working_videos.highlights_data`, so `delete_region` (`del
highlights[idx]`, overlay.py) destroyed a region's tracking along with its spotlight span.
Fixed by decoupling storage onto a new column: **`working_videos.detections_data`** (BLOB,
msgpack, `profile_db`, migration `v027`) holds a flat, whole-timeline payload
`{videoWidth, videoHeight, fps, detections:[{timestamp,frame,boxes}]}` — detection
timestamps are already absolute concatenated-timeline time
(`calculate_detection_timestamps`, multi_clip.py), so slicing by `[start,end]` needs no
per-clip remapping.

- **`region.detections` is now a read-time PROJECTION, never persisted per-region.**
  `GET /overlay-data` (overlay.py:~1593) decodes `detections_data`, then for every region
  sets `region['detections'] = slice_detections(vd, bounds)` and
  `videoWidth/videoHeight/fps` from the payload meta — `_region_bounds` (existing helper)
  supplies the bounds. This happens on EVERY read, so a region's detections always reflect
  the canonical store, never a stale embedded copy.
- **`create_region`/`delete_region` (overlay.py) are UNCHANGED** — they only ever touch
  `highlights_data`. That is the whole point: decoupling the store means delete/create need
  no detection-specific logic to "protect tracking".
- **Shared hoist/slice logic**: `app/services/video_detections.py` —
  `hoist_video_detections(regions)` (union of all regions' embedded `detections`, dedup by
  `(round(timestamp,2), frame)`, meta from the first region carrying
  videoWidth/videoHeight/fps, `None` if nothing to hoist) and `slice_detections(vd, start,
  end, eps=0.04)`. Used by BOTH the v027 migration backfill and the `/overlay-data`
  read-time fallback (when `detections_data` is NULL — un-migrated row, or a row the
  migration couldn't backfill) — one implementation, two callers, never persisted from the
  read-time fallback path.
- **Frontend mirror**: `sliceDetections` in `useHighlightRegions.js` (T5600) — keep it in
  sync with the Python `slice_detections`. The hook holds the flat payload in state
  (`videoDetections`, set via `setVideoDetections` from the `/overlay-data` response) and
  `addRegion` slices it locally so a newly created region shows tracking squares instantly,
  without waiting for a reload. `restoreRegions` is UNCHANGED — the backend already delivers
  `saved.detections` as the projected slice.
- **Lever drags RE-SLICE detections (T5649, 2026-07-21).** `moveRegionStart`/`moveRegionEnd`
  used to return `{...region, startTime/endTime, keyframes}` and OMIT `detections`, so the
  slice computed once in `addRegion` stayed FROZEN as the levers moved. Symptom: after a
  delete+re-add, dragging the BEGIN lever to 0 never showed the frame-0 "initial tracker box"
  because the region kept its old `[3,5]` slice and never pulled in the `timestamp:0`
  detection. Fix: both handlers now also return
  `detections: sliceDetections(videoDetections, snappedStart/startTime, endTime/snappedEnd)`
  (start handler slices to the CLAMPED/overlap-guarded `snappedStart`, not the requested time)
  and carry `videoDetections` in their dep arrays. Memory-only render state — detections are a
  read-time projection (never persisted per-region), so this touches NO persistence; the
  wrapped handler (`OverlayScreen.jsx:~675`) still POSTs only start/end. start/end clamps,
  `MIN_REGION_DURATION` maxStart, and prev/next overlap guards are untouched. Coverage:
  `useHighlightRegions.detections.test.js` (T5649 block, 5 cases) — begin-lever-to-0 pulls in
  frame-0, end shrink drops out-of-range, end grow pulls in, overlap-clamp regression, null
  payload; negative control confirmed the 3 re-slice tests FAIL on the frozen-slice source.
- **`videoDetections` is VIDEO-level; `reset()` must NOT null it (T5646, FIXED 2026-07-21).**
  The hold's lifecycle: set ONCE per load from `/overlay-data` (`setVideoDetections`),
  replaced only on the next load, and sliced (never mutated) by `addRegion`. Landmine that
  shipped: `useHighlightRegions.reset()` used to also `setVideoDetections(null)` — but
  `reset()` clears *region* state, and the fresh-export effect in `OverlayScreen.jsx`
  (~L500) does `setHighlightVideoDetections(payload)` → `resetHighlightRegions()` →
  `restoreHighlightRegions(...)`, so the reset wiped the payload it had just held. Net:
  `videoDetections=null`, and a later **delete→re-add** sliced null → region with
  `detections:[]`, `videoWidth/Height/fps:null` → no `DetectionMarkerLayer` markers
  (desktop "couldn't get the first tracking frame") and no `PlayerDetectionOverlay` boxes
  (mobile). Only the fresh-export (framing→overlay) session hit it — the plain-reload load
  effect (~L578) never calls `reset()`, and initial regions keep their boxes because their
  `detections` are pre-sliced server-side into `highlights_data` (`overlay.py:~1690`), not
  from the hook hold. **Fix = drop `setVideoDetections(null)` from `reset()`** (chosen over
  physically reordering the OverlayScreen set, because `reset()` also nulls `duration`, so it
  can't be hoisted ahead of the else-branch `addHighlightRegion(0)` which early-returns on
  null duration; and video-level detections simply aren't per-region reset state). Backend
  unchanged — the read path already re-slices `detections_data` onto every region each load,
  which is why a full reload was always fine. Coverage:
  `useHighlightRegions.persistence.test.js` (T5646 block) reproduces the fresh-export
  ordering (`setVideoDetections`→`reset`→`restore`) and asserts the payload survives + re-add
  slices non-empty detections; negative control (re-add the null) fails those two while the
  plain-reload regression test stays green.
- **Export producer**: `run_player_detection_for_highlights` (multi_clip.py) now returns
  `(regions, video_detections)` instead of just `regions` — the flat payload is the union of
  all per-clip `clip_detections` already built for the (unchanged, additive) region blobs.
  All three internal early-return/fallback paths return an empty `_empty_video_detections()`
  payload alongside `generate_default_highlight_regions(...)`. Only the Modal/local-YOLO
  producer at multi_clip.py's primary INSERT site (~1427) was wired to persist
  `detections_data`; the sibling local-file export path (`run_local_detection_on_video_file`,
  second INSERT ~1739) was deliberately left untouched (design: minimal/additive diff, no
  characterization net on the export path) — that path's rows rely on the `/overlay-data`
  read-time hoist fallback until a follow-up wires it too.

## Landmines & history
- **Region trim levers are Pointer Events, not mouse (T5644, 2026-07-21).**
  `RegionLayer.jsx` highlight-mode begin/end levers (the region start/end trim
  handles) used `onMouseDown` + `document` `mousemove`/`mouseup`. On a phone, touch
  only synthesizes compat mouse events AFTER touchend (never during a drag), so the
  lever never moved on mobile. Fix: `onPointerDown` + `setPointerCapture` + `window`
  `pointermove`/`pointerup`/`pointercancel` (mouse+touch+pen, one path), each handle
  carries `touch-action: none` (Tailwind `touch-none`) so the browser doesn't hijack
  the drag for timeline scroll/page zoom, and the drag filters on the owning
  `pointerId` (ignores a 2nd finger). Coarse pointers (`useIsCoarsePointer`) get a
  >=44px lever hit-target (fine stays 32px); the missing `lever-handle` class was
  also added so `handleTrackClick`'s existing `.lever-handle` add-region guard works.
  Desktop mouse path is behaviourally unchanged. **QA landmine reconfirmed:** a CDP
  `Input.dispatchTouchEvent` drag in chromium does NOT fire the old `onMouseDown`
  path (no continuous compat-mouse during a CDP touch drag), so the real-browser spec
  genuinely discriminates the bug — proven by a negative control (old handlers -> the
  two touch tests FAIL, mouse tests pass). Coverage: Vitest
  `RegionLayer.touch.test.jsx` (5, jsdom pointer wiring) + REAL-browser
  `e2e/T5644-region-lever-touch.qa.spec.js` (coarse touch via CDP + fine mouse)
  driving dev-only `regiondiag.html` + `src/regiondiag/main.jsx` (NOT a vite build
  input) that mounts the REAL RegionLayer + REAL useHighlightRegions. **Vite in-mem
  cache landmine (again): HMR did NOT invalidate on a WSL fs edit and orphaned vite
  PIDs kept serving stale transforms on :5173** — for a real negative control you
  MUST kill ALL vite PIDs (`/proc/*/cmdline` grep for `vite`), `rm -rf
  node_modules/.vite`, start ONE, and `curl /src/.../RegionLayer.jsx` to confirm the
  handler you expect is served before trusting the result.
- **Re-added region not persisting = stale `.find()` in OverlayScreen, NOT the hook
  (T5644, FIXED 2026-07-21).** Symptom: delete a region -> re-add -> reload ->
  `[Overlay Data] project=31: 0 regions`. Root cause: `wrappedAddHighlightRegion`
  (`OverlayScreen.jsx:~621`) does `const regionId = addHighlightRegion(clickTime);
  const region = highlightRegions.find(r => r.id === regionId);` — but
  `highlightRegions` is React state captured at render, and `addRegion`'s
  `setRegions` is async, so within the same synchronous gesture the new region is NOT
  yet in `highlightRegions`. `find` returns `undefined`, the `if (region)` block is
  skipped, and the surgical `overlayActions.createRegion` POST NEVER fires (delete's
  POST does, so backend nets 0). This affects EVERY interactive add, not just re-add;
  it went unnoticed because normal flow persists regions via framing-export
  (`highlight_transform`) or the full-state export PUT — the surgical create only
  matters for persistence-without-export, which is exactly the reported flow. The
  hook (`useHighlightRegions.addRegion`) is CORRECT — it returns the id and updates
  state; the bug is the caller reading async state. **Fix applied (T5644):**
  `addRegion` (useHighlightRegions.js) now RETURNS the new region object (was: the id
  string); `wrappedAddHighlightRegion` (OverlayScreen.jsx) dispatches from it directly
  `const newRegion = addHighlightRegion(clickTime); if (newRegion && canSyncActions)
  dispatchOverlayAction('createRegion', () => overlayActions.createRegion(projectId,
  newRegion.startTime, newRegion.endTime, newRegion.id));` — no stale `.find`, no
  reactive effect (pure gesture->surgical POST). No existing test depended on
  `addRegion`'s string return (they read `result.current.regions`), so the return-type
  change was safe. Coverage: `useHighlightRegions.persistence.test.js` (return contract
  + delete/re-add gesture fires create_region with the re-added region's own numeric
  bounds + fresh id).
- **Mobile editor layout invariant (T4880).** The editor shell (`App.jsx`, the non-Annotate
  branch) uses `h-dvh` — NEVER `h-screen`/`100vh` inside the editor tree — so the
  `flex-1 overflow-auto` content pane maps to iOS Safari's *visible* viewport (100vh spills
  behind the dynamic toolbar and clips the bottom). On mobile (`useIsMobile()`, <1024px or
  touch+no-hover) the editor defaults to the **inline scrollable** layout, NOT a fullscreen
  video takeover. History: commit 10494193 made `mobileFs = isMobile` (always `fixed inset-0`
  fullscreen); the below-timeline controls — Framing `ExportButtonSection` (Export/Proceed)
  and Overlay `OverlayExportButtonSection` (settings + the "Add Spotlight" primary button,
  which IS the overlay export button: `ExportButtonView` renders `isFramingMode ? 'Export' :
  'Add Spotlight'`) — are gated `!mobileFs`, so they rendered nowhere on a phone and the
  framing→overlay→export flow was impossible. Fix: `mobileFs = isMobile && mobileExpanded`
  (view-local `useState`, default false); fullscreen video is opt-in via a `Maximize` button,
  and the in-fullscreen back button collapses to inline (Home lives in the header). A dvh fix
  ALONE can't help here — controls that aren't rendered can't be scrolled to. Playwright
  emulation reproduces the layout but NOT the vh/dvh iOS-toolbar behavior; that needs a real
  device. `ModeSwitcher` buttons carry `data-testid="mode-{id}"`.
- **T4774 "post-video settle gap" is a measurement artifact (profiled, DROP).** The T4770
  ledger's `framing/overlay:videoReady → settled ≈ 1.5s` is the walkthrough's own
  `waitForTimeout(1500)`, not main-thread work. A CDP CPU profile + longtask observer
  (CDP profiler, retained on branch `feature/T4774-editor-mainthread-gap`) shows **~0ms main-thread busy and 0 long
  tasks after `videoReady`**; the main thread is 81–84% idle across the leg and the screen
  (video element, crop reticule, highlight regions) is committed ~500ms *before* first frame.
  Framing/overlay hydration is NOT a first-paint cost center. Don't defer/idle it or add a fake
  progress state — the pre-`videoReady` load wait is already covered by `VideoLoadingOverlay`.
  Evidence: `qa/T4774/REPORT.md`.
- **T350 keyframe origin corruption**: reactive `useEffect` persistence wrote runtime fixups back
  to the DB, compounding per load. Origin of the gesture-only persistence rule. Never watch hook
  state to persist.
- **Keyframe identity divergence (fixed ~2026-06-20)**: display snapped edits but persistence sent
  raw frame/time → near-duplicate crop/highlight keyframes accumulated. Fix: `resolveTargetFrame`
  everywhere + heal migration
  `src/backend/app/migrations/profile_db/v014_collapse_duplicate_keyframes.py` (idempotent collapse;
  crop gap 10 frames, highlight gap 5/30 s; preserves first+last; only heals clusters >2).
- **T4020 shadow versions (fixed, deployed 2026-06-26)**: a redundant post-export full-state save
  persisted empty crop + default segments as a NEW working_clips version, shadowing the real one.
  Full-state saves only on explicit gesture.
- **First crop drag dropped = VideoLoadingOverlay ate it, NOT a CropOverlay listener race
  (T5380b, 2026-07-19).** The reported bug: the FIRST crop-adjust drag after opening a Framing
  draft moves nothing (movedX=0); every later drag works. T5380's first fix assumed a listener
  race (down→move before an isDragging-gated `useEffect` attached the window listeners) and
  refactored CropOverlay to refs + synchronous attach. That was a MISDIAGNOSIS — the events
  never reach CropOverlay at all. REAL cause: while the video is still buffering
  (`isVideoElementLoading` true), `VideoPlayer` renders the DETAILED `VideoLoadingOverlay`
  (`src/frontend/src/components/shared/VideoLoadingOverlay.jsx`) — an `absolute inset-0 z-40`
  element that (unlike its `simple`-mode sibling) was MISSING `pointer-events-none`. The crop/
  highlight reticule renders off `videoMetadata` (before buffering finishes), so during that
  window the z-40 overlay sits ON TOP of the reticule and swallows the first mousedown; once
  buffering ends the overlay unmounts and later drags land. Fix = add `pointer-events-none` to
  the detailed overlay (dim+spinner still paints; input passes through), matching simple mode.
  Covers Overlay-mode highlight drags too (same VideoPlayer). **Why it never reproduced in a
  component test (jsdom OR real-browser Playwright):** the drop needs the real buffering state
  (`isVideoElementLoading`), not the CropOverlay component — an isolated CropOverlay/useCrop/
  VideoPlayer harness passes the first drag pre- AND post-T5380-fix. Repro requires VideoPlayer
  with `isVideoElementLoading` set. Standing proof: real-chromium `e2e/T5380b-cropoverlay-first-drag.qa.spec.js`
  drives a dev-only harness (`src/frontend/cropdiag.html` + `src/cropdiag/main.jsx`, NOT a vite
  build input) and asserts the first drag moves WITH the loading overlay up; it FAILS pre-fix.
  T5380's CropOverlay ref-refactor was left in place (harmless hardening, not the cause).
- **Video→screen transform unified (T4550, ~2026-07-17)**: the aspect-fit letterbox + zoom/pan
  math (`videoDisplayRect`, `videoToScreen`, `screenToVideo`, `round3`) was copied 3x, each in a
  different bug state. Now one hook `src/frontend/src/hooks/useVideoDisplayRect.js`
  (`useVideoDisplayRect(videoRef, videoMetadata, {zoom,panOffset,isFullscreen}) -> {rect,
  videoToScreen, screenToVideo}`) with BOTH fixes: `useLayoutEffect` first-paint + double-rAF
  fullscreen settle with both frame ids cancelled. Pure `computeVideoDisplayRect`/
  `videoToScreenRect`/`screenToVideoRect` are exported + unit-tested. CropOverlay, HighlightOverlay,
  PlayerDetectionOverlay all consume it (their local copies deleted). `videoToScreen` returns
  `{x,y,width,height}`; Highlight maps width/height→radiusX/radiusY at its call site. Drag handlers
  still hand-roll the inverse (`delta/scaleX`); `screenToVideo` is available if they migrate.
- **Overlay circle input = Pointer Events; edit levers gated on the tracking layer (T5450,
  2026-07-19, SUPERSEDES T5390's select-then-manipulate)**:
  `HighlightOverlay` is `onPointerDown` + `setPointerCapture` (mouse+touch one path); move/up
  are handled ONCE on the root div via event bubbling from the captured element (no window
  listeners). Transient drag data lives in refs (`draggingRef`/`resizingRef`/`resizeHandleRef`/
  `dragStartRef`/`highlightStartRef`) so the first move after pointerdown has zero re-render lag.
  The delta/scale drag math is UNCHANGED (still hand-rolled, not `screenToVideo`) so desktop
  mouse is byte-identical. **Interaction model is now a single `editable` prop (= `!showPlayerBoxes`),
  consistent on mobile + desktop — NO tap-to-select, NO deselect backdrop.** When `editable`
  (player-tracking layer OFF) the circle shows its levers: rim resize handles PLUS a **center
  4-arrow move grip** (lucide `Move` in an HTML `<div>` over the circle center, `data-testid=
  "highlight-move-grip"`; it starts a body drag via the shared `beginDrag`, and its captured
  pointer events bubble to the root div's move/up handlers). The ellipse body also drags to move
  while editable. When NOT editable the circle is DISPLAY-ONLY: body renders with
  `pointer-events-none`, no handles, no grip — so the video's tap-nav passes through. On a COARSE
  pointer (`useIsCoarsePointer` -> `(pointer: coarse)`) the handle hit circles are >=44px (r=22)
  and the grip is 44px (desktop grip 32px, handle 7px). `editable` is threaded from
  `OverlayContainer` (`showPlayerBoxes` state, the "Hide/Show player boxes" toggle) through
  `OverlayScreen`/`OverlayModeView`. The mobileFs tap-nav wrapper YIELDS while editable:
  `onClick={togglePlay}` + the long-press `onTouch*` handlers are gated on `!editable` (pointer
  `stopPropagation` can NOT cancel those TOUCH handlers — gating is required). Test IDs:
  `highlight-body`/`highlight-handle-horizontal`/`-vertical`/`highlight-move-grip`. **Sibling
  still mouse-only**: `PlayerDetectionOverlay` uses `onClick`/`onMouseEnter` — same touch gap,
  untouched here. Coverage: Vitest `HighlightOverlay.touch.test.jsx` (editable model, 10 cases);
  REAL-browser `e2e/T5450-overlay-circle-and-loop.qa.spec.js` (coarse + fine chromium) driving a
  dev-only harness (`overlaydiag.html` + `src/overlaydiag/main.jsx`, NOT a vite build input) that
  mounts the REAL `HighlightOverlay` + REAL `OverlayContainer` hook against a real ffmpeg-generated
  `<video>` — proves lever gating, grip-move, handle-resize, tap-nav yield, >=44px, and the loop
  play/pause toggle. jsdom is insufficient here (T5390's first attempt passed jsdom, failed on
  real touch).
- **Manual override now has TWO entry paths + a discoverability hint (T5610, 2026-07-20,
  EVOLVES T5450 — additive, not a revert of T5390)**: the spotlight is editable when
  `editable = !showPlayerBoxes || circleEditActive`. Path 1 (T5570 power user): hide the
  tracking layer. Path 2 (T5610 discoverable): TAP INSIDE THE CIRCLE with tracking still ON —
  tracking boxes stay visible underneath. `circleEditActive` is EPHEMERAL view state owned
  LOCAL to `OverlayModeView.jsx` (like `editable` already was) — NEVER persisted, no reactive
  write; it is an editing affordance, not reel data. `HighlightOverlay` gets an `onCircleTap`
  prop, wired ONLY in the tracking-ON regime (`showPlayerBoxes ? handleCircleTap : undefined`);
  when absent the drag path is byte-identical to T5450. **Tap-vs-drag**: a pointerdown→up that
  moves < `TAP_SLOP` (6 screen px, tracked in `tapRef`) is a TAP (→ `onCircleTap`, enter/exit);
  past the slop it moves/resizes as before. Hit-priority: inside-circle tap wins (a display-only
  transparent `highlight-enter-hit` ellipse covers only the interior; the `onClick` `stopClick`
  swallows the synthetic click so it never reaches the video tap-nav wrapper); outside the circle
  still reaches player boxes / tap-nav. **Exits**: tap-inside-again, tap OUTSIDE (mobileFs
  `onClick` → `handleVideoAreaTap` exits when `circleEditActive`), play start, or spotlight no
  longer visible (both via ephemeral view-state `useEffect` resets — NOT persistence). The
  mobileFs tap-nav/long-press guard is UNCHANGED — just driven off the WIDENED `editable`
  (`!editable`). **Hint** (`OverrideHint.jsx`): subtle non-interactive (`pointer-events-none`)
  pill in the dimmed area (bottom-center, `z-[5]` below handles), copy names BOTH paths
  (`Tap the spotlight to adjust it — or hide tracking to edit freely`; mobile shortens to
  `Tap the spotlight to adjust`). Shows only while tracking ON + a region visible + not yet
  overridden this session; fades out (300ms) + stays gone once `overrideUsed` latches on the
  first override (either path). `overrideUsed`/`circleEditActive` are `useState` in
  OverlayModeView — no store, no `useHighlightRegions`/`OverlayScreen` change (T5600 owned those
  in parallel). Test IDs: `highlight-enter-hit`, `override-hint`. Coverage: Vitest
  `HighlightOverlay.override.test.jsx` (7, tap/drag hit-priority + enter/exit) + `OverrideHint.test.jsx`
  (4, show/fade); REAL-browser `e2e/T5610-manual-override.qa.spec.js` (coarse + fine chromium)
  driving dev-only `overlaydiag-t5610.html` + `src/overlaydiag-t5610/main.jsx` (NOT a vite build
  input). **LANDMINE that ate ~an hour: a dev harness that does NOT pass a stable `panOffset`
  to `HighlightOverlay` sends a fresh `{x:0,y:0}` each render → `useVideoDisplayRect`'s layout
  effect re-runs → `setRect` → infinite "Maximum update depth" loop.** Pass module-const
  `ZOOM`/`PAN_OFFSET` (as OverlayModeView passes stable props). Second gotcha: multiple orphaned
  `vite` dev processes served STALE transforms on :5173 (in-memory cache survives `rm -rf
  node_modules/.vite`); kill ALL `node .../vite` PIDs and start ONE. Verify freshness by curling
  `/src/.../main.jsx` for an identifier you just added before trusting a browser repro.
  **T5643 (2026-07-21) moved + re-gated the hint**: `OverrideHint` now sits at
  `top-14 right-4` (was `bottom-3` centered) — directly under the "N players detected"
  badge rendered by `PlayerDetectionOverlay` (`top-4 right-4` inside `.video-container`).
  Both containers share the same top-left origin (no padding/margin between OverlayModeView's
  outer `relative` wrapper -> `VideoPlayer`'s `video-player-container` -> its inner
  `video-container`), so identical `right-4` + a `top` offset below the badge's height
  lines them up without OverrideHint needing to know about PlayerDetectionOverlay.
  `showOverrideHint` gained a 4th AND-condition: `selectedHighlightKeyframeIndex === null`
  (index 0 is a valid selection — falsy but selected, so check `=== null` not `!x`).
  `selectedHighlightKeyframeIndex` is computed in `OverlayScreen.jsx` from playhead
  proximity to a highlight keyframe (`findKeyframeIndexNearFrame`, not a click-to-select)
  and was already threaded into `OverlayModeView.jsx` as a prop — no new prop plumbing
  needed. Coverage: `OverrideHint.test.jsx` pins the placement classes + the
  visible=false contract; the gate itself (computed in OverlayModeView, a 4-way boolean
  AND) is proven end-to-end by a NEW dev-only harness `overlaydiag-t5643.html` +
  `src/overlaydiag-t5643/main.jsx` (mounts the REAL `PlayerDetectionOverlay` + REAL
  `OverrideHint` in production-faithful nesting) and `e2e/T5643-move-spotlight-hint.qa.spec.js`.
  **Built a NEW harness instead of reusing `overlaydiag-t5610.html`** to avoid touching a
  fixture another task's regression suite depends on — same pattern, different file.
- **Overlay spotlight loop playback (T5370, 2026-07-19)**: primary "Play spotlight"
  loops the span of ALL highlight regions `[min(startTime), max(endTime)]`; secondary
  "Play full" plays straight through. The loop is enforced by
  `src/frontend/src/modes/overlay/hooks/useSpotlightLoop.js` — a reactive effect that
  calls `seek(span.start)` once `currentTime >= span.end - LOOP_EPS` (0.03s) in loop
  mode. **`seek()` is ephemeral PLAYBACK control, NOT a store/DB write — this is not a
  T350-class persistence violation** (the banned pattern is a `useEffect` writing editing
  state; watching `currentTime` to wrap the playhead touches no persistent data).
  `spotlightPlayMode` (`'loop'|'full'`, default `'loop'`) is EPHEMERAL view state owned by
  `OverlayContainer`, never persisted/restored, reset to `'loop'` on clip change
  (`effectiveOverlayVideoUrl`). `spotlightSpan` is a `useMemo` over `highlightRegions`
  (single source, no duplicated state); null with zero regions → primary = plain
  Play/Pause, no secondary, no pill. **`useVideo` stays mode-agnostic** — no loop logic
  there; it's shared by Annotate/Framing. The overlay hook is the only new playback
  behavior. `Controls` got OPTIONAL props `isLooping` (loop accent+`Repeat` glyph on the
  primary) + `secondaryPlay` ({onClick,title,active} ghost button); **byte-identical when
  omitted** (HTML-equality pinned by `Controls.test.jsx`). "Back to spotlight" pill
  (`aria-label="Back to spotlight"`) renders in `OverlayModeView` over the lower video
  area when `isPastSpotlight` (`currentTime > span.end + LOOP_EPS`); its onClick
  `stopPropagation`s so the mobileFs tap-nav wrapper doesn't also toggle play. Coverage:
  Vitest `useSpotlightLoop.test.js` (8 cases) + `Controls.test.js[x]`; E2E
  `e2e/T5370-spotlight-loop-playback.qa.spec.js` (honest-skips without an exported-reel
  fixture, like T5390/T4550).
  **T5450 fix: `handlePlaySpotlight` is now a TRUE play/pause toggle** (OverlayContainer):
  if `!videoRef.current.paused` -> `togglePlay()` (PAUSE) and return; else set loop mode,
  seek to `spotlightSpan.start` ONLY if `currentTime` is outside `[start, end)`, then
  `togglePlay()` (play). The earlier bug only called `togglePlay()` when paused, so pressing
  while looping never paused. Zero regions -> plain play/pause (unchanged). Real-browser proof
  in `e2e/T5450-overlay-circle-and-loop.qa.spec.js` (loop wraps at span end; press-while-playing
  pauses).
- **Spline fork (live bug → T4250)**: `interpolateCropSpline` (splineInterpolation.js:116-154,
  fields x/y/width/height) and `interpolateHighlightSpline` (L163-206) are near-identical copies;
  `interpolateGenericSpline` (L217-255) was built to replace both but is UNUSED. The highlight copy
  interpolates only legacy `opacity` and DROPS `strokeOpacity`/`fillOpacity` → they snap to
  `?? 0.85`/`0.05` defaults between keyframes (flicker), masked at HighlightOverlay.jsx:423.
  `color` never interpolates — carried from the earlier keyframe (L193, L204).
- **Highlight (overlay) is a parallel implementation**
  (`src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`): region-scoped model (each region
  ≥2 keyframes; first/last computed as 'permanent' by position, L82-91), hardcoded `framerate = 30`
  (L40), min spacing 5 vs crop's 10, hand-rolled resolveTargetFrame clone inline (L527-539), refuses
  to delete first/last (L590-611), keyed by frame internally but persisted by time. T4460
  (design-gated) migrates it onto the controller; T3820's opposite snap directions (crop keeps old
  frame / overlay moves to clicked frame) get decided there.
- **Backend crop geometry fallback** (clips.py:401-408): `x or 0, width or 640...` fabricates
  geometry into the DB — flagged by audit A10 → T4280 sweep. Don't imitate.
- **Backend interpolation divergence**: `interpolation.interpolate_crop` is Catmull-Rom
  (interpolation.py:51-87) but `generate_crop_filter` builds a LINEAR FFmpeg expression (L188-195).
  Plus 4 Catmull-Rom copies across local/Modal paths → T4420.
- **fps `|| 30` fallback landscape**: FramingScreen.jsx:219/541/623, useClipManager.js:46,
  projectDataStore.js:402, FramingContainer.jsx:238, overlay chain OverlayContainer.jsx:162/196/250;
  `videoUtils.timeToFrame/frameToTime` default 30. One canonical source is T4540 (audit C7).
- **getFilteredKeyframesForExport duplicated verbatim**: FramingContainer.jsx:862-896 (the wired
  one) ≡ FramingScreen.jsx:750-784 (audit D7).
- **FramingContainer hand-mirrors** hook→store per gesture at 8 sites (~L352-835) to dodge React
  batch ordering → T4470 (audit D1).

## Active/upcoming work
- **T4220**: `remove_segment_split` wipes ALL segment speeds (clips.py ~483-497, literal "for now
  just clear speeds") — re-index instead; align useSegments.js.
- **T4230**: projects.py catch-all writes NULL over crop_data on rescale decode hiccup; rename PUT
  reverts aspect_ratio (no refit).
- **T4250**: replace both spline specializations with `interpolateGenericSpline`; fixes
  strokeOpacity/fillOpacity snapping; characterization tests pin crop behavior.
- **Keyframe System Unification epic (STRICT order)**:
  - **T4440** dead-code sweep (dead OverlayTimeline/HighlightLayer/components-Timeline,
    useHighlight, framingStore corpses).
  - **T4450** shared KeyframeTrack — unify delete gating to the flat-list rule; the gating change
    is the single intended diff.
  - **T4460** overlay onto keyframe controller (**Stage 2 design gate**): region-scoped tracks;
    snap direction/window decision (T3820); payload-parity tests per gesture — persistence
    semantics are the T350-class risk.
- **T4330** (Durability epic): unified action client — per-entity FIFO (actions are
  fire-and-forget; network reordering + whole-blob RMW = last-arrival wins), version threading,
  implement the commented-out 409.
- **T4400**: backend-authoritative export (`mark-exported`) — kills the client full-state PUT
  clobber class (T4020, two tabs).
