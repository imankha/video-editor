---
domain: keyframes-framing
updated: 2026-07-12 (T4900 overlay render read path + extended-segment keyframes)
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

## Landmines & history
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
- **Overlay circle input = Pointer Events + select-then-manipulate on touch (T5390, 2026-07-18)**:
  `HighlightOverlay` is now `onPointerDown` + `setPointerCapture` (mouse+touch one path);
  move/up are handled ONCE on the root div via event bubbling from the captured element
  (no window listeners). Transient drag data lives in refs (`draggingRef`/`resizingRef`/
  `resizeHandleRef`/`dragStartRef`/`highlightStartRef`) so the first move after pointerdown
  has zero re-render lag. Interactive SVG elements carry `touch-action:none`. The delta/scale
  drag math is UNCHANGED (still hand-rolled, not `screenToVideo`) so desktop mouse is
  byte-identical. On a COARSE pointer (`useIsCoarsePointer` -> `(pointer: coarse)`) the model is
  select-then-manipulate: first tap selects (ephemeral view state, NEVER persisted -- a
  select-only tap fires no `onHighlightChange`/`onHighlightComplete`), which reveals >=44px
  handle hit circles (r=22) and a transparent full-container backdrop; the body then drags to
  move / handles to resize; a tap on the backdrop deselects. Selection is CONTROLLED by
  `OverlayModeView` (`isHighlightSelected` useState -> `isSelected`/`onSelectedChange`), single
  source of truth, so the mobileFs tap-nav wrapper YIELDS while selected: `onClick={togglePlay}`
  and the long-press `onTouch*` handlers are gated on `!isHighlightSelected` (pointer
  `stopPropagation` can NOT cancel those TOUCH handlers -- gating is required, the backdrop alone
  is insufficient). Test IDs: `highlight-body`/`highlight-handle-horizontal`/`-vertical`/
  `highlight-backdrop`. A `useEffect` deselects when the circle stops rendering (playhead leaves
  the region) so selection can't latch and wedge the tap-nav -- view-state reconciliation, NOT
  reactive persistence. **Sibling still mouse-only**: `PlayerDetectionOverlay` uses
  `onClick`/`onMouseEnter` (relies on synthesized click) -- same touch gap, not fixed by T5390.
  Coverage: Vitest `HighlightOverlay.touch.test.jsx` (9 cases); E2E
  `e2e/T5390-overlay-circle-touch.qa.spec.js` (honest-skips without an exported-reel fixture).
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
