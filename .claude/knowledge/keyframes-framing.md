---
domain: keyframes-framing
updated: 2026-08-23 (T4355: closes T4350's multi-clip gap -- the SAME single-clip raw<->working transform pair (`transform_all_regions_to_raw`/`_to_working`, both UNCHANGED, still single-clip/concat-offset-unaware) is now composed PER-CLIP by `highlight_carry._transform_multi_clip`: attribute each concatenated-timeline region to its OLD clip via a half-open offset bucket (`_attribute_clip_index`, boundary-exact -> the later clip) -> shift into that clip's local OLD timeline (straddling regions clamp to the clip's OLD span end, same clamp-not-guess spirit as the transform's own partial-trim clamp) -> run the transform pair against `clips[i]` -> re-offset into the clip's NEW position. Clip identity is POSITIONAL ONLY (no stable id in the snapshot) so a reorder safely drops+flags rather than risking a wrong-clip landing. New `concat_offsets` helper (`routers/export/multi_clip.py`) computes the per-clip cumulative offsets (dissolve-aware); a landmine caught in review before merge: the "can't derive OLD offsets" fallback must gate on the CURRENT export's own transition, not the old snapshot's key-presence alone, or every legacy multi-clip project resets on its next cut re-export. See export-pipeline.md § Highlight carry-forward for the full decision matrix); 2026-08-23 (T4350: the raw<->working highlight transforms (`highlight_transform.transform_all_regions_to_raw`/`_to_working`) gained a SECOND production consumer besides overlay.py's read path -- `services/highlight_carry.resolve_carried_highlights` composes them OLD-working->raw->NEW-working to CARRY a user's overlay-edited highlights across a framing re-export (was silently discarded). Feeds the transform FRAME-based crop (from the stored `crop_data`, NOT the render's time-based form -- `interpolate_crop_at_frame` keys on `kf['frame']`) + canonicalized segments (T4340 gotcha) + per-side `video_dims`, framerate=30.0. Split: framing unchanged -> verbatim fast-path; single-clip change -> transform+drop-out-of-range (`dropped:N`); multi-clip change -> loud `multiclip_reset` (no per-clip attribution yet, follow-up T4355); no old framing snapshot -> verbatim + `legacy_uncertain`. Unmappable-region signal surfaces as an export-complete toast + a persistent Overlay banner (`highlight_carry_note`). Full detail in export-pipeline.md § Highlight carry-forward); 2026-08-17 (T7180 / prod bug 44p: overlay region key-format mismatch — update_region wrote camelCase startTime/endTime and never removed a pre-existing snake_case pair, so a lever drag on an auto-generated region silently never reached the render path, which prefers snake_case when present; fix canonicalizes all region writers on snake_case; see Overlay render read path §); 2026-07-30 (T6190 Focus does NOT fetch games/clips on mount — bootstrap-hydrated games + one-clip-fetch-owner-per-entry-gesture invariant, invalidateClips on leave-annotate + downloads re-edit, dead clipsLoadedAt removed, ConnectionStatus hoisted above the home/editor split; see Invariants §; 2026-07-28 T6170 rotation dead-zone ROTATION_EPSILON=1e-6: a denormal rotation defeated the `!thetaDeg` clamp zero-check and pinned the crop box — read guard + write-side snap-to-0 in clampRotation + backend twin mirrored; see Rotation/horizon straighten §; 2026-07-27 T6140 FIXED the removeBoundaryDuplicates first-keyframe self-drop + reported the cosmetic-dedupe-reaches-persistence hazard; T6050 re-pinned keyframe-integrity.spec.js to the flat-list model + surfaced the self-drop landmine; T6060 overlay dev-harness video-playback readiness contract: /tmp + Range-aware page.route + readyState>=3 ready-signal, helpers/videoRoute.js; T6110 real-account video readiness contract: waitForRealVideoReady verdict + openLoadableOverlayDraft dangling-ref probe, helpers/overlayDraft.js, folds onto T6060; T6100 video-stage hydration measured on staging: T4550/T5676 are test-placeholder races + staging dangling-ref data, NOT a product defect; T5790 export-button credit-cost estimate)
---
# Keyframes & Focus — Domain Knowledge

> **T7700 rename (2026-08-25):** the "Focus" mode/screen is now called **Focus** in all UI copy,
> component/file names (`FocusScreen`, `FocusContainer`, `FocusModeView`, `modes/focus/`,
> `stores/focusStore.js`, `api/focusActions.js`), and the route (`/framing` → `/focus`, with a legacy
> redirect). **INTERNAL/PERSISTED `framing` identifiers were intentionally KEPT**: the `EDITOR_MODES.FRAMING`
> key + its value `'framing'`, `projects.current_mode='framing'`, `export_jobs.export_type='framing'`,
> `working_clips.framing_version`, the `framing_action`/`_get_clip_framing_data` backend names, the
> `framingChangedSinceExport` store field, and the `framing_opened`/`framing_exported` analytics keys.
> So "Focus" = UI name, "framing" = wire/DB identifier; both are correct in their layer. This doc's
> filename stays `keyframes-framing.md` (its scope also covers Overlay highlight keyframes).

## Scope
Crop keyframes, segments/trim, the Focus screen/mode, the shared keyframe controller, spline
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
- **Crop hook**: `src/frontend/src/modes/focus/hooks/useCrop.js` (defaults, virtual trim, interpolation).
- **Screen/container**: `src/frontend/src/screens/FocusScreen.jsx`,
  `src/frontend/src/containers/FocusContainer.jsx` (gesture handlers, e.g. `handleCropComplete` L315-373).
- **Timeline layers**: `src/frontend/src/modes/focus/layers/CropLayer.jsx` (crop) vs
  `src/frontend/src/components/timeline/RegionLayer.jsx` (highlight — forked, stale rules).
- **Persistence helper**: `src/frontend/src/utils/persistKeyframeEdit.js` (T3800 single path);
  transport `src/frontend/src/api/focusActions.js`.
- **Spline math**: `src/frontend/src/utils/splineInterpolation.js`; backend mirror
  `src/backend/app/interpolation.py`.
- **Backend actions**: `POST /api/clips/projects/{project_id}/clips/{clip_id}/actions` →
  `framing_action` in `src/backend/app/routers/clips.py:326`. Overlay:
  `POST .../projects/{project_id}/overlay/actions` → `overlay_action` in
  `src/backend/app/routers/export/overlay.py:347`.
- **Store**: `src/frontend/src/stores/focusStore.js` — export dirty tracking is hash-based
  (`markExported`/`hasChangedSinceExport` L38-50).

## Data flow
```
gesture (drag/resize/delete) in FocusContainer
  → resolveTargetFrame(keyframes, rawFrame)          # snap identity FIRST
  → hook dispatch (optimistic) + store updateClipData
  → persistKeyframeEdit → focusActions.* (surgical POST, ONLY changed keyframe)
  → backend framing_action: read msgpack blob → mutate in memory → write back
```
- Crop keyframes live in `working_clips.crop_data` (msgpack, `src/backend/app/utils/encoding.py`):
  flat list of `{frame, x, y, width, height, origin}`. `None` when empty.
  Segments in `working_clips.segments_data`: `{boundaries[], segmentSpeeds{}, trimRange{}}`.
- Highlight keyframes live in `working_videos.highlights_data` (msgpack): region dicts, each with
  a `keyframes` list keyed by **time** (backend matches ±0.02s, overlay.py:339-344) — crop matches
  by **exact frame** (clips.py:318-323).
- Action names (focusActions.js): `add_crop_keyframe` `{frame,x,y,width,height,origin}`,
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

## Effective (output) duration — the ONE cost calculator (T5780)

`src/frontend/src/utils/effectiveDuration.js` (extracted from `ExportButtonContainer.jsx`
in commit d702efcd) is the SINGLE calculator for post-trim/post-speed output length.
`calculateEffectiveDuration(clip)` = Σ over segments of `(end-start)/speed`, clipped to
`trimRange` (0.5x doubles that segment's output); `sumEffectiveDurations(clips)` sums it
across clips and **fails closed** (returns `null` if ANY clip's duration is NaN, so the UI
HIDES rather than showing a guess — same no-fabricated-numbers rule as the poster). Consumed
by `ExportButtonContainer`, `useProjectLoader`, and the Focus indicator; T5790 will turn the
project total into a credit estimate, and the backend charge must use the same model.

- **Data-format tolerance:** reads `clip.segments` (frontend live `{boundaries, segmentSpeeds,
  trimRange}`) OR `clip.segments_data` (saved blob, same frontend shape — see Data flow) OR the
  DB `{segments:[{start,end,speed}], trim_start/trim_end}` array form. Give it whichever the clip
  carries; `duration` is only a fallback end-bound (unused when `boundaries`/`trimRange` present).
- **Live-vs-saved segment source (THE subtlety):** the SELECTED clip's saved `segments` is STALE
  while editing — its live speed/trim lives in the `useSegments` hook. `FocusContainer`'s
  `clipsWithCurrentState` already injects the hook state as frontend-format `segments` onto the
  selected clip (line ~225) and leaves every OTHER clip with its saved `segments_data`. So feeding
  `clipsWithCurrentState` to the calculator gives a LIVE selected-clip number + SAVED others in one
  pass. The two derived memos (`selectedClipEffectiveDuration`, `projectEffectiveDuration`,
  `FocusContainer.jsx` ~L272-296) are PURE render-time derivations — **no new state, no store
  field, no persistence** (T350 doctrine); the chip ticks the instant a speed/trim gesture updates
  the hook, with no save/export.
- **`duration` in Focus is the CLIP length, not the source game.** `useVideo.duration` (threaded
  as the container/view `duration` prop) is already the ~clip-length value the playback timer and
  the existing duration readout show — NOT the raw `<video>.duration`, which is the full
  concatenated source game (~88min). A 5.1s clip correctly reads `Output: 0:05`. (On first load
  there is a sub-second transient where the chip shows the source length before the clip's saved
  segment state restores; it self-corrects — do not "fix" it with a guard.)
- **View (`FocusModeView.OutputLengthChip`):** presentational chip near the duration readout;
  emphasized (blue) only when output differs from source length (slow-mo present), else subtle gray.
  A `Total` chip renders near the export area only for multi-clip projects (redundant for one clip).
  The playback timer is deliberately UNCHANGED — it shows source-timeline position; only the chip
  reflects output length. Reuses `formatTimeSimple` from `components/shared/clipConstants` (floors).
- Coverage: Vitest `src/utils/effectiveDuration.test.js` (15: 6s+3s@0.5x→9s, trim, multi-clip
  sum→23, live-over-saved precedence, DB-array format, fail-closed NaN) + real-browser
  `e2e/T5780-framing-effective-duration.qa.spec.js` (live speed tick, trim drop, source-timeline
  readout unchanged, responsive 375/desktop; asserts the chip against the segment track's OWN
  reported visual durations, so it's clip-duration-agnostic).

### Export-button credit estimate (T5790)

The Focus Export button shows a live credit-cost estimate under it (`~9 credits · balance 42`,
`ExportButtonView` `data-testid="export-credit-estimate"`). Derived at render — NO new state
(no-redundant-state / T350). `estimateExportCredits(clips)` (exported from `ExportButtonContainer.jsx`)
= `sumEffectiveDurations(clips)` → `creditStore.getRequiredCredits` (`Math.ceil` of output seconds,
`creditStore.js:58`) — the SAME calculator + rounding the click-time credit check in `handleExport`
uses, so the button number NEVER disagrees with the insufficient-credits modal or the backend charge
(EPIC.md "one cost calculator"). The container's `clips` prop is `clipsWithCurrentState` (live
selected-clip segments + saved others), so the estimate ticks the instant a speed/trim/split/clip-count
gesture lands — no save/export.
- **Focus ONLY.** Gated on `isFramingMode` in both container (returns null otherwise) and view
  (line hidden). Overlay export runs no per-second credit check → button byte-identical.
- **Fail-closed (no fabricated number):** unknown/NaN/≤0 effective duration → `estimateExportCredits`
  returns null → line hidden (logs a warn, mirroring `handleExport`'s fail-closed path). Also hidden
  while exporting.
- **Warning, not a gate:** `insufficientForEstimate = estimatedCredits > creditBalance` styles the
  line amber (`AlertCircle` + "add credits to export") so the user learns BEFORE clicking; the click
  still runs the authoritative refresh-balance → 402 → buy-credits flow. Balance stays on existing
  gestures (mount/export/purchase) — the estimate does NOT poll/`fetchCredits` on edits.
- Coverage: Vitest `src/containers/ExportButtonContainer.test.js` (`estimateExportCredits`: 6s+3s@0.5x
  →9 == modal required, trim reduces, Math.ceil, multi-clip sum→23, fail-closed null, empty/null) +
  `src/components/ExportButtonView.test.jsx` (line shown/singularized/amber-warning/hidden-when-null/
  hidden-while-exporting/absent-in-Overlay) + real-browser
  `e2e/T5790-export-credit-cost-estimate.qa.spec.js` (estimate == ceil(track total), live tick on
  speed/trim, amber warning at balance 0, click-time modal "required" == button number via a stubbed
  `/api/credits` zero-balance so no real render fires, responsive 375/desktop).

## Invariants & rules
- **Registering the mounted `saveCurrentClipState` MUST be stable, never keyed on the handler
  identity (T6190, 2026-07-31 regression fix).** `FocusScreen` subscribes to the WHOLE
  `focusStore` (selector-less `useFocusStore()`, FocusScreen.jsx:59-66). The effect that
  exposes `saveCurrentClipState` to `updateFlush.js` used to `set()` the store keyed on
  `[framingSaveCurrentClipState]` — but that handler's identity churns nearly every render (a
  `useCrop` keyframe dispatch regenerates `getKeyframesForExport` while clips/metadata settle on
  the annotate→framing entry). So each write re-rendered the whole-store subscriber, which
  re-created the handler, which re-fired the effect: an unbounded setState loop ("Maximum update
  depth exceeded"), crash stack `clearSaveCurrentClipState`→`forceStoreRerender`→
  `checkForNestedUpdates`. `activeSaveCurrentClipState` is read ONLY imperatively
  (`useFocusStore.getState()` in updateFlush.js), never subscribed, so registration has no
  reason to be reactive. **Fix:** `focusStore.useRegisterActiveSaveHandler(fn)` holds the latest
  handler in a ref and registers a STABLE wrapper once per mount (empty-deps effect). The
  loop-HAZARD (whole-store sub + reactive registration) predates T6190 and is byte-identical on
  master; T6190's `invalidateClips` firing during the transition (settling clips/metadata
  mid-mount) was the TRIGGER that first activated it. Pinned by
  `stores/focusStore.registration.test.jsx` (the pre-fix reactive pattern throws Maximum-update-
  depth; the stable hook does not) + the console-error guard in the T6190 QA spec criterion 4.
  Do NOT re-key this registration on the handler identity, and prefer selector-scoped focusStore
  reads on this screen.
- **Focus does NOT fetch games or clips on mount (T6190, 2026-07-30) — do not re-add a
  "just to be safe" mount refetch.** `FocusScreen` used to fire, on mount, an unconditional
  `fetchGames()` and a `fetchClips(projectId)` (with a WRONG comment claiming the latter deduped
  against `useProjectLoader`'s call — the two were SEQUENTIAL, so the in-flight latch was already
  null by mount → a real duplicate GET). Both were pure waste on the project-open critical path
  (they landed in the same window as `playback-url`, the request that gates video). **Now:**
  - **Games** come from the `/api/bootstrap`-hydrated `gamesDataStore` (`App.jsx setFromBootstrap`);
    Focus reads `useReadyGames()` for the one thing it needs (the selected clip's game display
    name) and never fetches. The dedupe at `gamesDataStore.js` only covers an *in-flight* fetch, so
    a mount `fetchGames()` after bootstrap settled always went out — that's why it read as
    "reloading the drafts view".
  - **Clips** have exactly ONE owner PER ENTRY GESTURE (not a catch-all mount effect):
    Drafts-tile→editor = `useProjectLoader.loadProject` (fetches); annotate→framing/overlay =
    `projectDataStore.invalidateClips` fired from `App.jsx handleModeChange` (the leave-annotate
    gesture — reads the project id via `useProjectsStore.getState()`, NOT the closure, because
    `AnnotateScreen` calls `selectProject()` synchronously right before `onModeChange`);
    Downloads/My-Reels "re-edit reel"→framing = `invalidateClips` in the `onOpenProject` handler
    (that path does `reset()` then `setEditorMode(FRAMING)` with NO `loadProject`, so it MUST own
    its fetch — the removed mount effect used to be its sole clip loader). Overlay↔framing keeps the
    already-loaded clips (never reset). `invalidateClips` mirrors `gamesDataStore.invalidateGames`
    (gesture-driven force-refetch, drops the in-flight latch first) — invalidation is a gesture,
    never a reactive `useEffect`.
  - Dead state removed: `projectDataStore.clipsLoadedAt` was written at 3 sites and read nowhere —
    **deleted** (no TTL was needed; the gesture-invalidation covers the annotate-edit case a TTL
    was the fallback for).
  - `<ConnectionStatus />` is the stable FIRST child of a top-level Fragment in BOTH the home and
    editor returns of `App.jsx`, so React preserves it by position across the home↔editor branch
    split (it does NOT remount) — its one-shot `/api/health` fires once at boot, never on
    project-open. Renders `null` while connected (no chrome on Drafts). Verified on the wire: a pure
    SPA home→editor transition fires 0 health (only boot fires it; dev StrictMode doubles it, prod=1).
- **Overlay-data has ONE owner per entry (T6250, 2026-08-27) — do not re-seed `clipMetadata` on
  project-open.** `OverlayScreen` has two `overlay-data` fetch effects: **Effect A** (~L596, "fresh
  export detected") whose trigger is `projectDataStore.clipMetadata` being truthy, and **Effect B**
  (~L720, "plain load", guard `syncState==='idle' && duration && !clipMetadata`). `clipMetadata` is a
  gesture flag meaning "a framing export just produced a new working video" — its ONLY store reader is
  OverlayScreen, and its ONLY legitimate writer is the export gesture (`FocusScreen.jsx:983` /
  `ExportButtonContainer`). **The bug:** `useProjectLoader.loadProject` also wrote it on EVERY
  project-open, so a plain Drafts→Framing→Overlay navigation (or a direct Drafts→Overlay open) left
  `clipMetadata` set with nothing to clear it, and Effect A ("fresh export") misfired alongside Effect
  B → `overlay-data` fetched by two owners (HAR: x3 = A StrictMode-doubled + B once; `outdated-clips`
  x2 is its single owner's StrictMode double, one caller `OverlayScreen.jsx:183`, prod=1). **Fix =
  delete the `setClipMetadata` store seed in `useProjectLoader.js`** (the local `buildClipMetadata`
  value is kept for the return payload + `onWorkingVideoLoaded`). Now: genuine fresh export → Effect A
  owns (B's `!clipMetadata` guard blocks it); every plain open / Framing→Overlay nav / direct
  Drafts→Overlay → Effect B owns (its `duration` comes from the working video `loadProject` sets before
  OverlayScreen mounts). Same "one owner per entry gesture" rule as T6190's clips fetch. Do NOT collapse
  the duplicate with a cache/in-flight latch (the two owners are genuinely concurrent, ~1-9ms apart) and
  do NOT re-introduce a load-time `clipMetadata` seed. Pinned by the T6250 test in
  `e2e/T6190-project-open-fetches.qa.spec.js` (overlay-data owner-count ≤ the single-owner
  outdated-clips baseline, StrictMode-agnostic; + the "Maximum update depth" render-loop guard).
- **Flat list, no permanent boundaries** (permanent-frame model removed ~2026-06-21).
  `INITIALIZE` seeds ZERO keyframes (keyframeController.js:186-197); `ensurePermanentKeyframes` is
  now just a sort — endFrame arg ignored (L138-148); `REMOVE_KEYFRAME` protects nothing (L272-287);
  `SET_END_FRAME` is a no-op (L377-382). Any keyframe deletable, including the last one.
- **Standing integrity guard: `e2e/keyframe-integrity.spec.js` (re-pinned by T6050).** Runs the
  real Vite-served controller+utils in-browser (self-skips on a deployed target — a "pass" on
  staging means it SKIPPED; run locally with the dev stack). It pins the flat-list invariants:
  (INV-1) RESTORE round-trips exactly — no manufactured frame-0 boundary, crop data + count
  preserved; (INV-1b, T6140) a distinct first keyframe at frame 1..29 round-trips (does NOT
  self-drop); (INV-2) origins normalized to `user`/`trim` on restore (`permanent` is legacy
  residue); (INV-3) `removeBoundaryDuplicates` collapses ONLY a keyframe spatially identical to
  the adjacent boundary — a DISTINCT near-edge keyframe survives (dedup is identity-based, never
  proximity-based); (INV-4) empty list is legal (INITIALIZE seeds zero, empty RESTORE is a no-op);
  (INV-5) any keyframe deletable incl. the first + the last remaining; (INV-6) min-spacing +
  snap-to-update; (INV-7) `resolveTargetFrame` is the identity SSOT and the reducer agrees (a near
  edit snaps, no near-duplicate — the v014 divergence class); (INV-8) a full lifecycle keeps
  `validateInvariants` clean and trim cleanup drops only `trim`-origin keyframes. The old T340
  permanent-boundary assertions (`g1a_frame0===0`, `origin==='permanent'`, reconstitution) are
  RETIRED with that model; the disposition is documented inline at the top of the spec.
- **`removeBoundaryDuplicates` self-drop — FIXED (T6140, 2026-07-27).** The cosmetic edge-dedup
  (keyframeController.js:158-171) was asymmetric: the END branch is naturally self-excluding
  (`kf.frame < endKf.frame` is false for `endKf`), but the START branch guarded only with
  `kf.frame > 0`. So when `keyframes[0].frame ∈ 1..29`, the first keyframe compared against ITSELF
  (`hasSameSpatialData(kf, kf)` trivially true) and SILENTLY DROPPED ITSELF on restore — real crop
  data loss, since persisted crop keyframes have no frame-0 guarantee (useCrop.js:194-207 restores
  verbatim; flat-list first keyframe is wherever the user first moved the box). **Fix:** the start
  branch now guards `kf.frame > startKf.frame` (symmetric with the end branch) — a first keyframe at
  1..29 with no other duplicate round-trips; a GENUINE neighbour duplicate (a distinct keyframe next
  to the boundary with identical spatial data) still collapses cosmetically. `hasSameSpatialData` has
  no other call site, so this was the only self-comparison. Guarded by controller unit tests
  (keyframeController.test.js RESTORE_KEYFRAMES: "self-comparison guard" first + last cases) and
  `keyframe-integrity.spec.js` **INV-1b** (T6140 widened it into the now-safe range — a distinct
  first keyframe at frame 5 round-trips). INV-1 still uses first-frame 35 for the no-frame-0 proof.
- **PERSISTENCE HAZARD — the cosmetic dedupe CAN reach the DB (reported by T6140, NOT fixed).**
  `removeBoundaryDuplicates` is a display-level runtime fixup that runs on RESTORE
  (keyframeController.js:218) and mutates the restored list stored in controller `state.keyframes`.
  That is exactly the list `getKeyframesForExport`/`saveCurrentClipState` read: on an export click,
  `FocusContainer.saveCurrentClipState` (FocusContainer.jsx:318,324) sends `keyframes` (the
  post-dedupe list) as `cropKeyframes` in the full-state PUT `/clips/{id}` → the collapsed keyframe
  is written back permanently. This VIOLATES CLAUDE.md § *Runtime fixups are memory-only*: a cosmetic
  correction reaches persistence. It is gesture-triggered (export click), not the reactive-useEffect
  loop of T350, so it does not compound on every load — but it IS the same FAMILY: a memory-only
  fixup becoming saved data, and because dedupe re-runs on every restore, each load→export cycle can
  drop another genuine edge duplicate. The T6140 fix removes the SELF-drop, so no unique data is lost
  anymore; the remaining hazard is the (intended) neighbour-duplicate collapse becoming permanent.
  Left for a follow-up: either keep the dedupe display-only (don't apply it to `state.keyframes` on
  restore) or exclude the restore fixup from the export read path.
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
- **reel_source_start_time/end_time refresh (T8070)** — every export-completion write site that
  produces reel artifacts also refreshes a per-clip staleness snapshot on `raw_clips`, so the
  annotate Reel control can tell whether the produced reel still reflects the clip's CURRENT
  boundaries. Focus: `export_framing` (framing.py) and multi-clip `upsert_working_video`
  (export_finalize.py). Overlay: both `final_videos` INSERT sites — the shared finalizer
  `_finalize_overlay_export` (overlay.py, inside its existing transaction) and the inline
  `export_final` path (overlay.py) — each does its own column-guarded
  `UPDATE raw_clips SET reel_source_start_time = start_time, reel_source_end_time = end_time`
  before commit, copying the row's own current values verbatim (no arithmetic — required for the
  exact `===` comparison on read). `export_overlay_only` does NOT write `final_videos` (raw
  FileResponse only) so it is NOT a refresh site. Full mechanism, invariants (INV-1..INV-6), and
  the annotate-side comparison: `.claude/knowledge/annotate.md` § `reel_source_*` and
  `docs/plans/tasks/T8070-design.md`.
- **Backend RMW pattern**: `_get_clip_framing_data` → mutate → `_save_clip_framing_data`
  (clips.py:267-309), in place. Atomic only because there is no `await` between read and commit
  (audit B8 → T4360). Overlay same shape with `overlay_version+1` (overlay.py:379-393).
  **T4330 (DONE):** both endpoints now bump a mutation counter and enforce `expected_version` ->
  409 (`{success:false, error:"version_conflict", current_version, message}`), checked once
  immediately after the read, still with no `await` before the commit. Focus's counter is a
  NEW column, `working_clips.framing_version` (profile_db migration v044) — the pre-existing
  `working_clips.version` is the EXPORT version-row counter (one row per exported version) and is
  NOT reusable as a CAS counter. `_get_clip_framing_data` returns `framing_version=None` when the
  column is absent (deploy->migrate window, guarded by `column_exists`); a `None` counter or a
  `None` `expected_version` both skip the check/bump silently, never a 500. The check covers
  EVERY framing write path uniformly, including the `set_rotation` branch — which keeps its own,
  unrelated, pre-existing `column_exists(cursor, "working_clips", "rotation")` 503 guard (v029)
  untouched, ahead of the new check. All action POSTs (both endpoints) now route through the
  shared `api/actionClient.js` (per-entity FIFO promise chain + version threading + 409 ->
  `src/frontend/src/utils/actionConflictPrompt.js`'s refresh toast, full `window.location.reload()`,
  no auto-rebase) — see persistence-sync.md invariant 8 for the transport-level contract.
  **Bug, FIXED 2026-08-24 (found live-testing T4355, unrelated to that branch — the bug is in
  T4330 itself):** Overlay's `GET /overlay-data` seeded the frontend's conflict-check baseline
  from `working_videos.version` (the EXPORT row-counter — bumps once per re-export, INSERT-new-row
  model) instead of `overlay_version` (the mutation counter `overlay_action`'s 409-check actually
  compares `expected_version` against, `overlay.py:443`). Two different columns on the same table,
  easy to conflate by name. After any re-export where the row-counter climbed past 0 (virtually
  always, 2nd+ export), the FIRST overlay edit always failed the version check — a guaranteed
  false "edited elsewhere" with no concurrent writer at all. Focus's `framing_version` counter
  does not have this split (its GET and its 409-check read the same column), so this was
  Overlay-only. Fixed: `get_overlay_data` now selects+returns `overlay_version` under the
  `version` key. Regression: `test_overlay_actions.py::TestOverlayActionVersionConflict::
  test_overlay_data_get_seeds_overlay_version_not_export_row_version`.

## Overlay render read path (T4900)

`overlay.py` now has two canonical helpers for reading region bounds and filtering keyframes:

- **`_region_bounds(region)`** — tolerates BOTH key formats: camelCase `startTime`/`endTime`
  AND snake_case `start_time`/`end_time`. Before T4900, the render path read
  `region['start_time']` directly → KeyError on action-written blobs. **Since T7180, every
  writer (surgical `update_region`/`create_region` AND `highlight_transform.py`) produces
  canonical snake_case** — the camelCase tolerance is now READ-side back-compat for
  pre-T7180 rows, not a live write-format split. `_region_bounds` prefers snake_case WHEN
  PRESENT (`region.get('start_time', region.get('startTime', 0))`), which is exactly what
  made T7180 (prod bug 44p) possible: `update_region` used to write ONLY camelCase and never
  removed a pre-existing snake_case pair, so a lever drag on an auto-generated region (which
  starts life with snake_case bounds) updated a key nothing read — the render path and a
  fresh page load kept using the ORIGINAL auto-placed bounds forever, silently dropping every
  keyframe the user placed outside them, with the export completing 200/success. Fix:
  `update_region`/`create_region` now write snake_case and `.pop()` any stale camelCase pair.
  **If you ever add a new region write site, it MUST write snake_case and pop camelCase, or
  this bug class reopens.**
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
premium **reveal envelope** — a DERIVED, render-time visual layer (fade + contract
focus-pull on entrance, ease-out; fade-out on exit, ease-in). It NEVER writes keyframes
(T350 corruption class avoided by construction) — it modulates only RENDERED
opacity/radii between the region bounds. **ALWAYS-ON: standard behavior, no setting/gate**
(the opt-in toggle was removed — reveal is unconditional so preview always == export).

- **Shared spec, THREE mirrored copies** (crop/default-shape mirroring pattern — keep in
  sync or preview/export drift). All take exactly `(t, start, end)` — no `enabled` param:
  - Frontend canonical: `src/frontend/src/utils/spotlightReveal.js`
    (`computeSpotlightReveal(t, start, end) -> {opacityFactor, radiusScale}`).
  - Backend canonical: `src/backend/app/services/spotlight_reveal.py`
    (`compute_spotlight_reveal(t, start, end) -> (opacity_factor, radius_scale)`).
  - Modal inline copy: `video_processing._spotlight_reveal` — inlined because the Modal
    image does NOT mount `app`, so it can't import the canonical module. Parity is pinned
    by `tests/test_spotlight_reveal.py::TestModalInlineParity`.
- **Constants**: entrance 0.35s, exit 0.25s, entrance start-scale **1.35** — the ring
  appears ~35% LARGER and CONTRACTS to 1.0 (focus-pull, `START + (1-START)*e` interpolates
  big→fitting since START>1). Each ramp is capped at `dur/2` so short regions still fade
  symmetrically. Easing: entrance opacity is ease-out **cubic** `1-(1-p)^3` (leads) while
  the radius contracts on ease-out **quad** `1-(1-p)^2` (trails) — so the big ring reads
  bold at near-full opacity before it tightens. Exit ease-in quad `q^2` (q = remaining
  fraction), no scale change. At exact region start opacity is 0 (invisible, scale 1.35) →
  no pop; at region end opacity 0, scale 1. Mid-region both factors are 1.0 (no-op).
- **Application (identical in all render paths)**: `radiusX/radiusY *= radius_scale`
  applied to BASE radii BEFORE the ground transform; `opacity_factor` multiplies stroke,
  fill, dim vignette, AND outline blend so the WHOLE spotlight animates together.
  - Frontend: `HighlightOverlay.jsx` takes a `reveal` prop (computed UNCONDITIONALLY in
    `OverlayModeView`'s `spotlightReveal` useMemo from the active region's
    `startTime/endTime` + `currentTime`). Applied DISPLAY-ONLY — the raw `currentHighlight`
    geometry the drag/resize commit reads is untouched, so editing never persists a
    scaled/faded value. (Editing exactly at a boundary shows the ramped display while
    committing true geometry — rare, harmless.)
  - Backend local path: `overlay._process_frames_to_ffmpeg` computes reveal from
    `_region_bounds(active_region)` + `current_time` and passes `reveal_opacity`/
    `reveal_scale` (optional params, default 1.0) to
    `KeyframeInterpolator.render_highlight_on_frame`. `processor_local.py` render loop
    wired the same way. Modal path: `_render_highlight` computes it internally. No
    settings/flag read — always applied.
  - Applied AFTER `_normalize_region_keys` (T5120) — the envelope sits ON TOP of whatever
    the interpolator yields; no bare-key access added to the spline helpers.
- **Sibling render loops left as no-op** (default reveal 1.0): `frame_processor.py:186`
  and `ai_upscaler/__init__.py:883` are the framing+highlight combined passes using a flat
  highlight-keyframe model (no region `[start,end]` in scope) — reveal not wired there.
- **Modal caveat**: the `video_processing.py` change requires a Modal REDEPLOY before it
  takes effect in prod (separate user-gated step). Local/Fly render (containers, Modal
  off) already applies it via `_process_frames_to_ffmpeg`.
- **No schema/setting.** T5250 adds NO `working_videos` column and NO profile_db migration
  (the earlier `reveal_enabled` column + v030 migration were removed when reveal became
  standard). No `overlayStore.revealEnabled`, no `set_reveal_enabled` action, no toggle in
  `ExportButtonView`. profile_db migration head on this branch is **v027**.
- Coverage: `spotlightReveal.test.js` + `test_spotlight_reveal.py` (incl. Modal-inline
  parity — `TestModalInlineParity`). Glow/pulse was intentionally SKIPPED (hard to mirror
  1:1 in ffmpeg; would jeopardise the preview==export bar).

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

## Rotation / horizon straighten (T5640, 2026-07-22)

Per-clip content rotation to level tilted footage. **Single scalar per clip, NOT
keyframed** — camera tilt is constant for a recording.

- **Column:** `working_clips.rotation REAL DEFAULT 0` (profile_db **v029**;
  `database.py` fresh DDL + `v029_working_clips_rotation.py`). DEGREES, positive =
  content rotated **counter-clockwise**. Returned on `WorkingClipResponse`
  (`clips.py` GET `/projects/{id}/clips` selects `wc.rotation`); read client-side
  via `clipRotation(clip)` selector (`Number(clip?.rotation)||0`). **If you add a
  new clip-read query, SELECT `wc.rotation` or the angle silently drops to 0 on
  reload** — that's exactly the gap that was almost shipped.
- **Coordinate model = Option (a), the load-bearing invariant:** crop coords live
  in the **rotated frame space**; every render is
  `crop_{x,y,w,h}(rotate_θ_aboutCenter_sameWH(frame))`. Rotation is about the
  frame center with output kept at source **W×H**, which preserves the crop
  coordinate box → **θ=0 is byte-identical to pre-T5640 (NO crop-keyframe
  migration).** Pinned by `tests/test_t5640_rotation_export.py`.
- **Sign convention (drift is THE failure mode — do not eyeball):** cv2
  `getRotationMatrix2D(center, angle=θ)` (CCW+); ffmpeg
  `rotate=a=-radians(θ):ow=iw:oh=ih:c=black` BEFORE crop; CSS preview
  `transform: rotate(-θdeg)`. The real-browser QA pins the CSS sign — it was NOT
  browser-verified at implementation time.
- **The ONE render primitive:** `video_processing.rotate_then_crop(frame,
  rotation_deg, x,y,w,h)` (θ=0 → plain slice fast path). Applied at all 4 cv2
  sites in `video_processing.py` (`process_framing_ai`/`_l4`/`_chunk` take a
  `rotation` param; `process_clips_ai` reads `clip_data['rotation']` per clip).
  **Live prod render = Modal `process_clips_ai`.** The **local** render path
  (MODAL_ENABLED=false / dev container) is `AIVideoUpscaler` →
  `ai_upscaler/frame_processor.py extract_frame_with_crop`, which rotates the full
  frame via `self.rotation` (set from `process_video_with_upscale(rotation=…)`,
  threaded from `clip_pipeline` `ctx.clip_data['rotation']`) — **the design's site
  list omitted this path; it must rotate too or preview↔local-export diverge.**
  ffmpeg `/crop` endpoint (`framing.py`) prepends the rotate filter (secondary /
  legacy — no live caller found; `/upscale` doesn't exist despite the docstring).
- **Threading:** `ClipExportData.rotation` → `_export_clips` `clips_data` /
  Modal `normalized_clips_data` / local pipeline. `/render` + multi-clip DB-resolve
  SELECTs carry `wc.rotation`.
- **Safe-area clamp (no black corners):** closed-form inscribed
  `rotatedRectWithMaxArea(W,H,θ) ∩ aspect r`, centered. **CLIENT is SSOT** (runs at
  gesture time, persists clamped crops); Python mirror
  `services/rotation_safe_area.py` exists ONLY for the char test — **export TRUSTS
  the stored crop, never re-clamps** ("correct data, not workarounds"). JS SSOT
  `utils/rotationSafeArea.js` (`clampCropToSafeArea`, `rotatedFrameCorners`,
  `MAX_ROT=20`). Clamp runs on set-rotation (ALL keyframes) and on crop-drag while
  θ≠0 (`useCrop.clampCropForCurrentRotation`, θ=0 passthrough).
- **Rotation dead-zone `ROTATION_EPSILON=1e-6` (T6170, 2026-07-28) — the θ≈0 test is
  a MAGNITUDE band, never `!theta`.** `rotation` is trig/float-arithmetic output, so
  a "zero" angle can be a denormal: the dial nudge sums 0.1° steps and
  `0.1+0.1+0.1-0.1-0.1-0.1 === 2.7755575615628914e-17`. A denormal is TRUTHY, so the
  old `if (!thetaDeg)` fast path in `clampCropToSafeArea` let the clamp RUN and pin the
  crop box (staging proj 31: `crop.x` 660 forced to 656.25, so every drag past 656.25
  snapped back — only that clip, because 37/54 stored exact `0.0`). **BOTH halves shipped:**
  (1) READ guard — `clampCropToSafeArea` (JS + Python twin) passes through when
  `!thetaDeg || |thetaDeg| < ROTATION_EPSILON`; `!thetaDeg` kept as leading term so
  null/undefined/NaN passthrough is unchanged (`Math.abs(NaN)<eps` is false / Python
  `abs(None)` would raise, so the short-circuit is load-bearing). (2) WRITE side —
  `clampRotation` (`utils/straighten.js`, the SINGLE chokepoint every committed
  rotation flows through: `useCrop.setRotation`→`clampRotation`→surgical `set_rotation`,
  plus the `useCrop.js:75/85` load-time seed) snaps `|deg|<ROTATION_EPSILON` to exactly
  `0`, so garbage never reaches the DB and a nudged-back dial reads a true `0` (fixes
  `CropOverlay.jsx:408` `rotation!==0` reset + reset-button `disabled`). **Epsilon
  justification:** finest intentional step is 0.1° (nudge/slider) → 1e-6 is 100,000×
  smaller (can't swallow a real adjustment; ~3e-5 px corner shift on 1920px vs ~3.3 px
  for 0.1°), and FP accumulation residue stays <1e-11 even for pathological holds → 1e-6
  clears it by ≥5 orders. **Backend twin `rotation_safe_area.py` MIRRORED** (same guard +
  const): grep-proven it has NO render/export caller (only `test_t5640_rotation_export.py`),
  so the change is behaviorally inert for render — done to honor the documented
  keep-in-sync contract so a future wiring can't reintroduce the denormal. **Existing DB
  rows still carry residue** (load-time snap is read-only, no write-back; export trusts
  stored crop so render is unaffected) — a one-off heal audit is warranted but NOT authored
  here (no migration; supervisor runs any audit). Coverage: `rotationSafeArea.test.js` +
  `straighten.test.js` (denormal passthrough/snap with the measured value, + real-0.1°
  still clamps) and `test_t5640_rotation_export.py` (Py parity, +2). Do NOT change the crop
  drag math — the drag was correct; the clamp's zero-test was the bug.
- **Preview:** `CropOverlay` CSS-rotates the **`<video>` element** imperatively via
  `videoRef.current.style.transform` (NOT a `VideoPlayer` prop — VideoPlayer is
  mode-agnostic/shared; zoom/pan is a `transform` on the WRAPPER div, so rotating
  the inner `<video>` composes and does not clobber it). Reticle stays
  **axis-aligned** — `useVideoDisplayRect` (T4550 SSOT) is **NOT forked**; crop
  drag math unchanged. Out-of-bounds DIM mask (`rgba(0,0,0,0.55)`, SVG mask hole
  from `rotatedFrameCorners`, `pointer-events:none`).
- **Persistence:** ONE surgical `set_rotation` action (`framing_action` direct
  `UPDATE working_clips SET rotation` — does NOT route through
  `_save_clip_framing_data`; in place, no version bump). Straighten drag-end /
  dial commit / nudge / reset each fire exactly one `handleSetRotation`
  (optimistic + rollback, mirrors `handleCropComplete`), plus a surgical
  `update_crop_keyframe` per clamp-moved keyframe. **No reactive useEffect.**
  Full-state PUT `WorkingClipUpdate.rotation` versions like crop (rotation ∈
  `is_framing_change`/`data_actually_changed`, carried forward on version-INSERT);
  `saveCurrentClipState` currently does NOT resend rotation (surgical action is the
  persistence path; version-INSERT carries the DB value forward regardless).
- **Straighten tool:** Pointer Events + `touch-action:none` + `setPointerCapture` +
  `pointerId` (real-browser rule, T5644/T5450). `correctionAngle(p0,p1)` =
  `-(atan2(dy,dx) reduced mod 90 into (−45,45])` → levels a horizon OR a vertical
  (goalpost). `utils/straighten.js`.
- **Straighten controls HIDDEN by default (T5641, 2026-07-22):** the line-drag
  capture layer + fine dial in `CropOverlay` are gated on a `straightenVisible`
  prop. Owner = `FocusModeView` `useState(false)` — EPHEMERAL view state, never
  persisted (no-persisted-view-state rule; precedent T5610 `circleEditActive`).
  Toggled by a "Straighten" button rendered INLINE with `<ZoomControls>` in the
  desktop controls bar (`ml-auto` header, `hidden lg:flex` → desktop-only, same as
  zoom; the rotation EFFECT still applies on mobile, just no editing UI there).
  **Load-bearing split: only the CONTROLS toggle — the CSS-rotate `useLayoutEffect`
  and the OOB dim mask are UNGATED**, so a set angle keeps rotating the `<video>`
  while the tool is hidden (`displayRotation = liveRotation ?? rotation`; hidden →
  no gesture → `liveRotation` null → falls back to the persisted `rotation` prop).
  The old in-toolbar `straightenActive` sub-toggle is GONE — one toggle now reveals
  both the capture layer and the dial together (revealing = a straighten "mode":
  the z-20 capture layer intercepts crop drags while visible). Coverage: Vitest
  `CropOverlay.straighten.test.jsx` (default-hidden, reveal, effect-persists-hidden,
  MAX_ROT range).

## Landmines & history
- **Focus has NO working blob-playback path for a freshly-uploaded clip (T7280 finding,
  2026-08-20 — task abandoned mid-implementation, capturing for whoever revisits this via
  the Game Pools epic).** `getClipVideoConfig` (FocusScreen.jsx ~L416-456) resolves a game
  clip's source via `GET .../clips/{id}/playback-url` → presigned R2, which does NOT resolve
  until upload bytes land AND `activateGame` completes (a few seconds after `onGameCreated`).
  The mount `useLayoutEffect` (~L515) and the streaming branch (~L578) both explicitly bail on
  a `blob:` URL; there IS a blob `else` branch (~L582-588) that calls `loadVideoFromUrl`, but it
  only triggers when `getClipVideoConfig` RETURNS a blob URL — for a game clip it always returns
  the R2 playback-url, never a blob, so that branch is dead for this flow. Unlike Annotate
  (`useAnnotateState`'s early-src + upload-store restore effects give instant blob playback),
  **Focus cannot preview a still-uploading source today.** Any future "land the user in
  Focus right after upload" flow (T7280's fast path, or Game Pools' clip-contributor landing)
  hits this. Two resolution options analyzed (T7280-design.md §3, preserved at
  `docs/plans/tasks/T7280-design.md` even though the task itself was abandoned): (A) teach
  Focus to play the upload blob and swap to R2 on activation — high complexity, touches the
  most timing-sensitive load effects in the app, risks the T6190 no-mount-fetch rule and borders
  the reactive-persistence ban if the swap is implemented as a state-watching effect instead of a
  gesture continuation; (B) a "Preparing your clip…" placeholder gated on "source not resolvable
  yet," swapped to the live stream via the EXISTING `invalidateClips` gesture once upload
  activation completes — low complexity, no changes to `getClipVideoConfig` or the load effects.
  (B) was the approved direction when the task was live.
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
  fullscreen); the below-timeline controls — Focus `ExportButtonSection` (Export/Proceed)
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
  Focus/overlay hydration is NOT a first-paint cost center. Don't defer/idle it or add a fake
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
  (T5380b, 2026-07-19).** The reported bug: the FIRST crop-adjust drag after opening a Focus
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
- **Overlay stage is aspect-fit, not fixed-height (T5676, 2026-07-22).** `VideoPlayer` got an
  opt-in `fitToAspect` prop: when true (Overlay, `!isFullscreen && !mobileFs`) the
  `.video-player-container` + `.video-container` are `w-full h-full` (fill their parent) instead of
  the legacy fixed `h-[40vh] sm:h-[60vh]`. `OverlayModeView` wraps VideoPlayer in a stage box
  sized to the reel's true aspect via inline `style={{aspectRatio: 'W / H'}}` from
  `effectiveOverlayMetadata.width/height` (class `stageBoxClass`, useAspectStage branch:
  `mx-auto w-full max-w-full lg:w-fit lg:h-[70vh] lg:max-h-[70vh]`) → `object-contain` becomes a
  no-op and the 9:16 pillarbox dies (was ~2/3 black). **`.video-container` is still the
  ResizeObserver target — do NOT remove the class; resizing it is safe BECAUSE of T5590's RO.**
  Overlays (`HighlightOverlay`/`PlayerDetectionOverlay`) map via `useVideoDisplayRect` unchanged;
  since the box now == video aspect, the display rect fills the container (no letterbox math to
  drift). Fullscreen/`mobileFs` branches are byte-identical (aspect box + `fitToAspect` gated off;
  CSS `:fullscreen` still forces 100vw/100vh). Desktop `lg+` puts the Overlay Settings card
  (extracted to `components/OverlaySettingsCard.jsx` from `ExportButtonView`) BESIDE the video in
  a `lg:flex-row` row (reclaimed pillarbox width); the "Add Spotlight" CTA + progress stay
  full-width at the bottom; Controls bind to the video width (below the box, inside the
  `lg:w-fit` video column). `ExportButtonView`'s settings card is now framing-only. Real-browser
  proof: dev-only harness `aspectdiag.html` + `src/aspectdiag/main.jsx` (NOT a vite build input)
  mounts the REAL VideoPlayer(fitToAspect) + REAL HighlightOverlay for a 9:16 AND a 16:9 source;
  `e2e/T5676-aspect-stage-alignment.qa.spec.js` asserts video fills container (no pillarbox) +
  ellipse inside the video rect at 390/768/1315 (samples fulfilled via `page.route` from /tmp —
  vite v5 dev caches publicDir at startup so post-start public files 404). Live-account path
  honest-skips until this account has an exported reel. Vitest `OverlayModeView.aspectStage.test.jsx`
  pins the aspect-ratio math for both aspects + the two settings-card placements.
- **Overlay circle input = Pointer Events; edit levers gated on the tracking layer (T5450,
  2026-07-19, SUPERSEDES T5390's select-then-manipulate)**:
  `HighlightOverlay` is `onPointerDown` + `setPointerCapture` (mouse+touch one path); move/up
  are handled ONCE on the root div via event bubbling from the captured element (no window
  listeners). Transient drag data lives in refs (`draggingRef`/`resizingRef`/`resizeHandleRef`/
  `dragStartRef`/`highlightStartRef`) so the first move after pointerdown has zero re-render lag.
  The delta/scale drag math is UNCHANGED (still hand-rolled, not `screenToVideo`) so desktop
  mouse is byte-identical. **Interaction model is now a single `editable` prop (= `!showPlayerBoxes`),
  consistent on mobile + desktop — NO tap-to-select, NO deselect backdrop.** **CURRENT edit UI
  (T5570c `2567e90e`, SUPERSEDES the original T5450 rim-handle + center-grip model): four
  bounding-box CORNER handles `data-testid="highlight-corner-{nw,ne,sw,se}"` (drag a corner to
  grow/shrink BOTH radii about a fixed center; sign follows the corner — e=+x, w=-x, s=+y, n=-y)
  PLUS move by DRAGGING THE CIRCLE BODY on desktop, or a touch-ONLY `data-testid=
  "highlight-move-lever"` (a 44px `Move` `<div>` above the box, gated `editable && isCoarse`) on
  coarse pointers.** The removed `highlight-move-grip` / rim `highlight-handle-horizontal|vertical`
  ids no longer exist. When NOT editable the circle is DISPLAY-ONLY: body renders with
  `pointer-events-none`, no handles, no lever — so the video's tap-nav passes through. On a COARSE
  pointer (`useIsCoarsePointer` -> `(pointer: coarse)`) the corner hit circles are >=44px
  (`cornerHitR` r=26; visible r=13) and the lever is 44px; fine pointer keeps them compact
  (`cornerHitR` r=12, visible r=8, no lever). `editable` is threaded from
  `OverlayContainer` (`showPlayerBoxes` state, the "Hide/Show player boxes" toggle) through
  `OverlayScreen`/`OverlayModeView`. The mobileFs tap-nav wrapper YIELDS while editable:
  `onClick={togglePlay}` + the long-press `onTouch*` handlers are gated on `!editable` (pointer
  `stopPropagation` can NOT cancel those TOUCH handlers — gating is required). Test IDs (current):
  `highlight-body` / `highlight-corner-{nw,ne,sw,se}` / `highlight-move-lever` (coarse only) /
  `highlight-enter-hit` (tap-to-edit, T5610). **Sibling still mouse-only**: `PlayerDetectionOverlay`
  uses `onClick`/`onMouseEnter` — same touch gap, untouched here. Coverage: Vitest
  `HighlightOverlay.touch.test.jsx` (editable corner+lever model, incl. jsdom resize + lever-move
  math) + `HighlightOverlay.override.test.jsx`; REAL-browser `e2e/T5610-manual-override.qa.spec.js`
  (coarse + fine chromium, dev-only `overlaydiag-t5610.html`) proves tap-to-edit, body-drag move +
  no-scrub, corner-drag RESIZE widens the ellipse (T6000 test 6), the coarse move-LEVER moves the
  circle (T6000 test 7), and >=44px sizing. `e2e/T5450-overlay-circle-and-loop.qa.spec.js` now
  covers ONLY the loop play/pause toggle (its 8 move/resize tests asserted the removed T5450 DOM
  contract and were removed on 2026-07-26 `17e40530`; T5610 re-proves them under the current
  model). jsdom is insufficient for the pointer hit-testing (T5390's first attempt passed jsdom,
  failed on real touch) — hence the real-browser proofs. **Trailing-click swallow (T6080, FIXED
  2026-07-27 — supersedes T6000's observation):** in mobileFs a moved-POINTER gesture synthesizes a
  trailing compatibility `click` (desktop mobile-fullscreen layout, device emulation, mouse-
  synthesizing input stacks — NOT real touch, which synthesizes none). That click bubbles to
  `OverlayModeView.handleVideoAreaTap`, which drops out of circle-edit when `circleEditActive`. So
  EVERY editable child that starts a drag must swallow its own click. A single
  `swallowDragClick = tapToToggle ? stopClick : undefined` (matching the body's shape) is now wired
  on the body, all four corner handles, AND the move lever — T6000 recorded that the corners lacked
  it; T6080 also found the LEVER lacked it (the original trace named only the corners). Per-element
  click-swallow contract (all `onClick`, click event only — never touches pointer capture):
  | element | swallow | why |
  |---|---|---|
  | `highlight-body` (drag=move) | `swallowDragClick` | move drag's trailing click would exit edit |
  | `highlight-corner-{nw,ne,sw,se}` (drag=resize) | `swallowDragClick` | resize drag's trailing click would exit edit (T6080) |
  | `highlight-move-lever` (drag=move, coarse only) | `swallowDragClick` | lever drag's trailing click would exit edit (T6080) |
  | `highlight-enter-hit` (tap=enter) | raw `stopClick` (unconditional) | renders ONLY under `tapToToggle && !editable`, so it's ALWAYS in the swallow regime; a tap-enter, not a drag, so the `swallowDragClick` name would mislead |
  Gate rationale: with tracking OFF, `handleVideoAreaTap` is a no-op on an editable circle (no
  `circleEditActive` to clear, `!editable` is false), so swallowing there is dead code — hence
  `tapToToggle ?`. **Residual (known, matches the body's identical pre-existing behavior, out of
  T6080 scope):** if `constrainHighlight` clamps the drag at the video boundary so the handle
  separates from the cursor, the trailing click's target becomes the common ancestor (the video
  wrapper) rather than the handle, so the handle's `onClick` never runs and edit can still exit.
  Closing it needs a moved-flag guard on the wrapper, not a per-handle swallow. Proven real-browser
  by `e2e/T5610-manual-override.qa.spec.js` tests 8 (corner, fine+coarse) & 9 (lever, coarse).
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
  there; it's shared by Annotate/Focus. The overlay hook is the only new playback
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
- **Timeline click-to-seek convention — now TWO elements (T7720, 2026-08-25).** The
  overlay timeline has an established "click a timeline element -> switch to its settings
  tab + seek the playhead to it" shape, owned by `OverlayModeView` (which holds `activeTab`
  as local `useState('overlay')` plus `seek`). Two handlers follow it: `handleSelectRegion`
  (text region -> `setActiveTab('text')` + seek into the region, guarded by
  `isRegionUnderPlayhead` since a region is a RANGE) and, new, `handlePosterMarkerClick`
  (thumbnail marker -> `setActiveTab('thumbnail')` + unconditional `seek` since a marker is
  a single FRAME, not a range). Any new clickable timeline element should reuse this shape,
  not invent a new seek/tab mechanism. **Marker click vs drag is strictly separated in
  `PosterMarkerLayer` (the T6560 fix stays intact):** the pointerup handler fires EXACTLY
  ONE of `onDragEnd` (moved past `DRAG_THRESHOLD_PX` -> commits the new frame, SOURCE time,
  persisted) or `onClick` (release-in-place -> opens settings, passes the marker's CURRENT
  committed `visualTime`, never the click X, so a click never relocates the frame).
  **Coordinate asymmetry to keep straight:** `onPosterMarkerDragEnd` receives SOURCE time
  (OverlayMode converts via `visualTimeToSourceTime` because it persists the poster frame);
  `onPosterMarkerClick` receives VISUAL time straight through (its only job is `seek`, which
  is visual space — no conversion, no persistence). `onClick` does NOT set the marker's
  `hasInteractedRef` (a click doesn't move the marker, so the initial-load auto-follow, which
  only cares about position, has no reason to stop). Coverage: `PosterMarkerLayer.test.jsx`
  (T7720 click/drag mutual-exclusion + passes committed time, not click X) +
  `OverlayModeView.thumbnailMarkerClick.test.jsx` (handler opens the Thumbnail tab + seeks).
- **Driving real `<video>` playback in the overlay dev-harness specs — the READINESS
  CONTRACT (T6060, 2026-07-27).** The three `overlaydiag*` specs (T5450 loop, T5610 tap-nav,
  T5643) point a real `<video>` at a relative `/overlaydiag-sample.mp4` that ffmpeg writes in
  `beforeAll`. Two independent test-infra races (NOT app bugs) made the playback-driving tests
  flake — both are now solved in `e2e/helpers/videoRoute.js`, use it for any new harness that
  plays a `<video>`:
  1. **Vite v5 dev caches its publicDir listing AT STARTUP.** A file created in `beforeAll`
     (after the dev server is up) 404s, and vite serves the SPA `index.html` for the `<video>`
     src → media never loads → `play()` rejects (swallowed by the harness's `.catch(()=>{})`)
     → every "video plays" wait times out. Fix: generate the sample to `os.tmpdir()` (NOT
     `public/`) and serve it via `page.route` from disk — timing-independent (same landmine the
     T5676 aspectdiag spec hit). `curl`ing the src returned `Content-Type: text/html` len 6382
     (index.html) even with the mp4 present on disk — that is the tell.
  2. **A plain `route.fulfill({body})` answers one 200 with NO `Accept-Ranges`**, so Chromium
     marks the element **non-seekable** (`video.seekable == [0,0]`). `handlePlaySpotlight`'s
     `seek(spotlightSpan.start)` is then silently dropped and playback runs from 0 → T5450's
     `currentTime >= 0.35` assertion fails at ~0.27. Fix: the route responds to `Range` with a
     206 + `Content-Range`/`Accept-Ranges` (`routeSeekableVideo`), which restores
     `seekable == [0,dur]` and the seek lands (~0.435). The app's seek-then-play is CORRECT on a
     seekable source (prod R2 serves Range) — this was a fixture-transport defect, not a product
     bug.
  - **Ready-signal, never a sleep or visibility.** `waitForVideoReady` gates on
    `readyState >= 3` (HAVE_FUTURE_DATA) `&& Number.isFinite(duration) && seekable.length > 0`
    before ANY interaction — the real "can seek + play" signal. Proven deterministic by
    `--repeat-each=5` green across all three specs (115 runs, 0 flakes). T5450/T5610 now route
    the sample from `/tmp`; T5643 still writes `public/` (it does not drive playback, so it is
    unaffected) — the sample is shared-by-SHAPE (identical 640x360x3s `testsrc`), no longer by path.
  - **REAL-ACCOUNT staging surface — the SAME contract, but a VERDICT not a throw (T6110,
    2026-07-27).** The routed-fixture helpers above cover dev-harness `<video>`s that are
    guaranteed loadable. The three real-account overlay/framing specs (`T4550`, `T5676`,
    `bug38-autoselect-and-frame-step`) point a real `<video>` at the account's working video on
    R2, where T6100 measured a SECOND failure mode a routed fixture can never hit: staging carries
    **DANGLING `working_videos` refs** — `working_video/playback-url` returns 200 with a presigned
    URL, but the R2 GET for that object is a fast deterministic **404 (~120ms)** (intact objects
    return **206 in 120-360ms**). The `<video>` then fires `error` and the ready-signal (readyState
    / the overlay stage's inline `aspect-ratio`) can NEVER arrive — the original 240s hang. Two
    fixes, BOTH required (a readiness wait ALONE does not fix T5676): **(1)** gate on the real
    ready-signal, and **(2)** CHOOSE A LOADABLE DRAFT — a readiness wait on a draft that can't load
    is the same bug, slower.
    - `waitForVideoReady`'s sibling **`waitForRealVideoReady(page, {minReadyState, requireAspectRatio,
      timeout})`** (same `videoRoute.js`) RETURNS a verdict instead of throwing: `{ready:true}` once
      the `.video-container video` can seek+play (+ overlay stage `aspect-ratio`, when asked), or
      `{ready:false, reason}` when the element ERRORED (names the `MediaError` code → dangling ref)
      or NEVER hydrated within `timeout` (no ready, no error — e.g. playback-url 404 so VideoPlayer
      never even mounts). The caller then advances to another draft or **skips LOUDLY naming
      hydration** — never asserts a domain fact against a placeholder. A `false` verdict is a
      hydration verdict, NOT a raised timeout masking a regression. `minReadyState` 3 for
      seek/step/drag specs, 2 for a pure geometry read (T5676).
    - **`e2e/helpers/overlayDraft.js` `openLoadableOverlayDraft(page, {minReadyState})`** does fix #2:
      it PROBES every In-Overlay draft the way T6100 did (`page.request` shares the dev-login cookie:
      playback-url → `Range: bytes=0-1` GET on the presigned R2 URL, 206 = streams) and opens the
      first streamable one DETERMINISTICALLY — the `DraftTile` carries the project id in its poster
      `src`, so target `[data-testid="project-card"]` with `img[src*="/projects/{id}/poster"]` and
      click ITS `Open in Overlay` button (no `.first()` gamble). If NONE stream it returns a loud
      reason naming the dangling refs → the spec skips honestly. On imankh's staging copy: 5 In-Overlay
      drafts, **2 stream (54, 37), 3 dangling (31, 33, 51)** — so these specs run green by opening 54/37.
    - **Real-account overlay landmines these specs encode:** (a) tracking is ON by default so
      `editable` is false → the draggable body ellipse has NO `.cursor-move` class; select the
      always-rendered **`svg defs mask ellipse`** for geometry (the `.cursor-move` selector hangs).
      (b) "Add Spotlight" IS the overlay EXPORT button — NEVER click it on the real account (fires a
      costly render); a streamable In-Overlay draft already carries restored regions, so the spotlight
      renders from existing data. (c) the working video is a cross-origin R2 URL with no CORS, so a
      `<canvas>` `drawImage`+`toDataURL` pixel read TAINTS — guard BOTH calls and honest-skip (bug38
      glitch3). (d) auto-select-on-centered-player uses `pickPrimaryDetectionBox` (center **AND
      prominence**), so on real footage it legitimately picks a prominent near-center player, not the
      geometrically-most-centered box — assert the spotlight anchors INSIDE some detection box (the
      geometric frame center provably lies inside none), not "the box nearest frame center"; the exact
      ranking is Vitest-pinned (`useHighlightRegions.autoselect.test.js`).
    - **Focus (T4550) is NOT dangling-prone** — it plays the raw clip and DOES load (T6100: crop
      placeholder at ~6.4s, display rect settled at ~7.37s); its only fix is the ready-gate before the
      drag, plus dragging TOWARD the video center (a blind fixed direction hits `constrainCrop`'s clamp
      when the fixture crop sits near an edge → false "moved 0", per FIXTURE-CONTRACT T5320). The old
      T5380 comment claimed a 0,0 measurement meant the first-drag race regressed; it had not — the
      ready-gate now rules out "acted on a placeholder", so a 0,0 AFTER it is the genuine T5380
      regression (that misleading comment sent triage down the wrong path on 2026-07-27).
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
- **fps `|| 30` fallback landscape**: FocusScreen.jsx:219/541/623, useClipManager.js:46,
  projectDataStore.js:402, FocusContainer.jsx:238, overlay chain OverlayContainer.jsx:162/196/250;
  `videoUtils.timeToFrame/frameToTime` default 30. One canonical source is T4540 (audit C7).
- **getFilteredKeyframesForExport duplicated verbatim**: FocusContainer.jsx:862-896 (the wired
  one) ≡ FocusScreen.jsx:750-784 (audit D7).
- **FocusContainer hand-mirrors** hook→store per gesture at 8 sites (~L352-835) to dodge React
  batch ordering → T4470 (audit D1).

## Aspect-aware video stage (T5676)

The Overlay editor used to letterbox 9:16 portrait reels — the non-fullscreen stage box had
no height cap (`rounded-lg` only) and `VideoPlayer`'s `.video-container` fell back to a fixed
`h-[40vh] sm:h-[60vh]`, so a portrait video's `object-contain` shrank to fit that box's HEIGHT,
leaving wide pillarbox on both sides. **The fix**: `OverlayModeView` computes `useAspectStage =
!isFullscreen && !mobileFs && aspectW > 0 && aspectH > 0` from `effectiveOverlayMetadata`, and
when true: sets the stage box's `style={{ aspectRatio: '${aspectW} / ${aspectH}' }}` (CSS
aspect-ratio, not a Tailwind class — applies at ALL breakpoints) plus `lg:w-fit lg:h-[70vh]
lg:max-h-[70vh]` (lg+ only: pins height, derives width from the aspect ratio so the box
SHRINK-WRAPS instead of stretching full-column-width), and passes `VideoPlayer`
`fitToAspect={useAspectStage}` — which swaps VideoPlayer's own container to `w-full h-full`
(parent already has the right shape) instead of the `40/60vh` fallback, making `object-contain`
a no-op.

**Layout for A1**: lg+ screens (≥1024px viewport) place the stage box and
`OverlaySettingsCard` side-by-side in a flex row (reclaimed pillarbox width for settings).
Below lg (e.g. 768px), the box is `w-full max-w-full` with the aspect-ratio style still
applied — width-bound, not height-bound, so height is DERIVED from width via aspect-ratio
rather than pinned to 70vh. Settings card extracted from `ExportButtonView` into a new
presentational component `OverlaySettingsCard.jsx` (all props, no store/hook logic).

- **Implementation files**:
  - `src/frontend/src/components/VideoPlayer.jsx`: added `fitToAspect` boolean prop; when
    true, both the outer `video-player-container` and inner `.video-container` swap their
    non-fullscreen branch to `w-full h-full` instead of the `40vh/60vh` fallback classes.
  - `src/frontend/src/modes/OverlayModeView.jsx`: owns `useAspectStage`/`stageBoxClass`/
    `stageBoxStyle` (the aspect-ratio CSS + lg:70vh cap) and the A1 flex-row/stack layout;
    passes `fitToAspect={useAspectStage}` to `VideoPlayer` and renders `OverlaySettingsCard`
    beside it on lg+.
  - `src/frontend/src/components/OverlaySettingsCard.jsx` (new): presentational card with
    color, shape, stroke, fill, dim, effect controls.
  - `src/frontend/src/components/ExportButtonView.jsx`: removed settings card (moved to
    `OverlayModeView` for the beside-video placement).
  - `src/frontend/src/screens/OverlayScreen.jsx`: unrelated-to-layout T5676 change — locks
    `OverlaySettingsCard` (`settingsDisabled` prop) while THIS project's overlay export is
    in flight, mirrored from the export store (`exportingProject`).

**KNOWN TRADE-OFF (measured, not a bug)**: for a PORTRAIT (9:16) reel on desktop, the new
box is PINNED to `lg:h-[70vh]` vs the pre-fix fixed `sm:h-[60vh]` — ~10vh MORE vertical stage
height in exchange for killing the horizontal pillarbox and enabling the beside-video settings
layout. At a 748px-tall viewport this measured as the timeline needing ~75px MORE scroll to
reach for portrait reels specifically (landscape reels aren't affected — their width, not the
70vh height cap, is normally the binding constraint at lg breakpoints). Approved as part of the
A1 design; do not "fix" by shrinking 70vh without a design conversation.

**QA validation**: `e2e/T5676-aspect-stage-alignment.qa.spec.js` — real-account real-browser
test (390/768/1315px, fullscreen, mobileFs) PLUS a dev-only harness (`aspectdiag.html` +
`src/aspectdiag/main.jsx`, following the established `overlaydiag.html`/`cropdiag.html`
pattern) mounting the REAL `VideoPlayer(fitToAspect)` + REAL `HighlightOverlay` for a 9:16 AND
a 16:9 sample, since the QA account (imankh@gmail.com, profile 9fa7378c) has ZERO 16:9 projects
(verified via direct sqlite query — every `projects.aspect_ratio` row is `9:16`). Harness
samples must be 1080p-class (not 720p): a lower-resolution `<video>` can render BELOW the
harness box's CSS width at medium viewports because `VideoPlayer`'s video element uses
`max-w-full max-h-full` (pre-existing, unchanged by T5676 — never upscales past intrinsic
size), which produced a harness-only gap at 768px that does not reproduce with the real
account's higher-resolution export.

**Unchanged**: `useVideoDisplayRect`, fullscreen mode CSS (`:fullscreen` rules force 100vw/100vh
before any fitToAspect logic), no changes to zoom/pan or mobileFs enter/exit.

## Video-stage hydration on staging — MEASURED, NOT a product defect (T6100, 2026-07-27)

The staging E2E failures T4550 (Focus crop drag lands `0`) and T5676 (`overlay-video-stage`
never gets its `aspect-ratio` style → 240s timeout) both blamed "the video stage never
hydrates". **Root-caused by measurement against staging (real account imankh/9fa7378c) — it is
NOT a product bug, NOT slow-infra-when-warm, and does NOT gate a prod deploy.** Do not re-derive;
the numbers below are the answer.

- **Infra is FAST when warm** (rules out the "R2/CDN slow" theory, consistent with memory
  `project_t3760_overfetch_harmless`): `working_video/playback-url` 240ms; clip `playback-url`
  240ms; R2 presigned GET of a present working video (2.65MB faststart) 206 in 120–360ms. The
  ONLY real slowness is (a) Fly **cold-start**: the first request after the machine auto-stops
  can take ~30s (measured a 30s `GET /api/projects` timeout on a cold machine, fast on retry) —
  a lone first-hit cost, not the "hangs forever" symptom; and (b) the **poster-warming request
  storm** on home/list mount (`GET /api/games/{id}/poster.jpg` ×N measured 4–6s concurrently,
  the T5683 warmer + `warmAllUserVideos` contention villain), which delays the `clips`/list
  request ~1.6s but does NOT touch the video path.
- **T5676 (Overlay) — dangling working-video R2 refs (STAGING DATA artifact).** For 3 of 5
  "In Overlay" drafts the DB row says `has_working_video=True` and `playback-url` happily signs
  a URL (it does NOT verify the object exists), but the R2 GET returns **404 in ~120ms**. The
  frontend then correctly shows the T5440 "video unavailable — re-export to rebuild" state and
  `useAspectStage` correctly never flips (there is no video to size). This is a FAST deterministic
  404, not a hang. **No app code path deletes `working_videos/{filename}.mp4` R2 objects**
  (verified: `clips.py` deletes `raw_clips/`, `overlay.py` deletes the prior `final_videos/`,
  `project_archive.py` deletes only DB rows, sweep deletes `games/{hash}.mp4`) — so on prod a
  working-video object persists once written; the staging absence is an env-copy/wipe/E2E-export
  provenance artifact (DB rows referencing objects not mirrored into the staging R2 prefix).
  T5676's `openOverlay` picks `.first()` In-Overlay draft without checking it is loadable, so it
  waits 30s+ for an `aspect-ratio` that can never come for a 404'd asset → the 240s hang. Healthy
  drafts DO hydrate in-browser: `T5642-...qa.spec.js` passed on staging (project 54, presigned
  `<video>` 206 + plays).
- **T4550 (Focus) — test drags before the display rect exists (TEST timing race).** Measured
  timeline, click→ready: clips 5.4s (behind the poster storm), clip `playback-url` 6.07s, R2 game
  reads 206 in 0.14–0.24s, `<video>` HAVE_METADATA 6.74s, **display rect established 7.37s**. The
  crop box renders off clip metadata as a PLACEHOLDER at ~6.4s (evidence `qa/T4550-crop-overlay-placed.png`
  shows the box over a "Loading… / Connecting to server…" stage); T4550 drags the instant the box
  is visible — ~1s BEFORE the `<video>` display rect that `videoToScreen`/`useVideoDisplayRect`
  needs is established → the drag maps against a degenerate rect and lands exactly `0` (the same
  signature as, but NOT, the T5380 first-drag race — `attachDragListeners` is intact). The video
  DOES load; it is a race, not a hang. Focus clips are the full **3GB non-faststart** game video
  (`games/{hash}.mp4`, moov ~700KB before EOF) so Chrome does a front+tail range read for metadata
  — still fast (~0.3s) but slower to paint than Overlay's small faststart working video, which is
  why the placeholder window is wider in Focus.
- **Fixes belong to T6110** (spec hardening: wait for the real video-ready signal, not the
  placeholder; skip/990 drafts whose working video 404s). **Do NOT raise timeouts.** See
  [export-pipeline.md] for the media-URL / R2-ref side.
- **Prod-impact answer (the gating question):** No new prod defect. The Focus race is a test
  artifact real users never hit (nobody drags a crop box in the sub-second before first paint, and
  the box re-maps correctly once the video paints). The Overlay dangling ref is staging-only data;
  even the worst case on prod is the graceful T5440 "re-export" prompt (no hang, no data loss).
  Residual (un-checkable here — no prod creds): whether prod holds any `working_videos` DB row whose
  R2 object HEADs 404. Recommend a READ-ONLY prod audit as a cheap follow-up; it does not block the
  deploy because the failure mode is graceful.

## Active/upcoming work
- **T4220**: `remove_segment_split` wipes ALL segment speeds (clips.py ~483-497, literal "for now
  just clear speeds") — re-index instead; align useSegments.js.
- **T4230**: projects.py catch-all writes NULL over crop_data on rescale decode hiccup; rename PUT
  reverts aspect_ratio (no refit).
- **T4250**: replace both spline specializations with `interpolateGenericSpline`; fixes
  strokeOpacity/fillOpacity snapping; characterization tests pin crop behavior.
- **Keyframe System Unification epic (STRICT order)**:
  - **T4440** dead-code sweep (dead OverlayTimeline/HighlightLayer/components-Timeline,
    useHighlight, focusStore corpses).
  - **T4450** shared KeyframeTrack — unify delete gating to the flat-list rule; the gating change
    is the single intended diff.
  - **T4460** overlay onto keyframe controller (**Stage 2 design gate**): region-scoped tracks;
    snap direction/window decision (T3820); payload-parity tests per gesture — persistence
    semantics are the T350-class risk.
- **T4400**: backend-authoritative export (`mark-exported`) — kills the client full-state PUT
  clobber class (T4020, two tabs).
