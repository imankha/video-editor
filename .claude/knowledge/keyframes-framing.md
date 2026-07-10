---
domain: keyframes-framing
updated: 2026-07-03 (initial version, workflow setup)
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

## Landmines & history
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
