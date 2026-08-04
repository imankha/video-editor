# T5225 Design — Overlay text layer (rich text over a clip range)

**Status:** DESIGN — awaiting approval (design gate)
**Tier:** L · Frontend + Backend + Modal · ~9 files · ~600 LOC · **No migration**
**Depends on:** T5180 (rich text engine — `text_render.render_text_layer`, `RichText.jsx`, `TextSpec`)
**Knowledge:** `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/keyframes-framing.md`

> This document is the Stage 2 artifact. It fixes the five gate items (persisted entry shape,
> clip-boundary source, snapping threshold + edge/free behaviour, shared TextSpec editor factoring,
> shared rasterised layer across the two render loops) plus the render-pass architecture and the
> completion-path consistency rule. **Nothing below is implemented yet.**

---

## 0. Audit corrections that change the plan (read first)

Two verified findings contradict the task file / classification and must be settled at the gate.

### 0.1 The stated integration point is DEAD CODE

The task file and Stage-0 classification name `src/frontend/src/modes/overlay/OverlayTimeline.jsx:103`
and `:153` (the "reserved slot" comments) as where the text layer lands. **That file is never
rendered.** Verified:

- `<OverlayTimeline>` appears as JSX **nowhere** in `src/frontend/src` (`grep '<OverlayTimeline'` → 0 hits).
- `modes/overlay/OverlayTimeline.jsx` is referenced only by a doc-comment (`Timeline.jsx:16`) and the
  barrel `modes/overlay/index.js:7-8`. It composes `HighlightLayer` (the old diamond-keyframe layer),
  not `RegionLayer`.
- **The live timeline** is `OverlayScreen → OverlayContainer → OverlayModeView → `**`OverlayMode.jsx`**
  ` → RegionLayer`. `<OverlayMode>` is rendered at `OverlayContainer.jsx:756`, `OverlayModeView.jsx:685`
  (desktop) and `:764` (mobile-fullscreen).

**Decision:** the third layer is added to `OverlayMode.jsx` (the live host), NOT `OverlayTimeline.jsx`.
Concretely:
- New label in `layerLabels` (`OverlayMode.jsx:128-166`, a `Type`/text icon after the Highlight label).
- New `<TextLayer>` track as a sibling of `RegionLayer` (`OverlayMode.jsx:211-241`).
- Extend `getTotalLayerHeight()` (`OverlayMode.jsx:88-93`) so the playhead line spans the new row.
- Forward the new props through **both** `<OverlayMode>` call sites in `OverlayModeView.jsx` (`:685`,
  `:764`) and through `OverlayContainer.jsx:756`.

We leave `OverlayTimeline.jsx` untouched (deleting dead code is out of scope for this task; note it in
the knowledge doc at Stage 7).

### 0.2 Clip boundaries are NOT available anywhere client-side, and NOT in `/overlay-data`

Snapping needs clip cut-points on the concatenated working-video timeline. Today:
- The overlay operates on a single flattened working video; `OverlayScreen` never forwards `clips` to
  the timeline, and `sourceTimeToVisualTime`/`visualTimeToSourceTime` are **identity** in overlay mode
  (`OverlayModeView.jsx:711-712`). No per-clip offsets exist client-side.
- `/overlay-data` returns `video_duration` and `poster_slowmo_section` but **no per-clip boundary array**.

**Decision:** add a `clip_boundaries` array to the `/overlay-data` response (§2.2). It is a pure
read-side extension — the offsets are derivable server-side by the same walk `poster.py` already uses.

---

## 1. Data model — persisted entry shape

### 1.1 The entry

Each overlay-text block, stored in the existing `working_videos.text_overlays` BLOB (msgpack list,
`encode_data`/`decode_data` from `app/utils/encoding.py` — the same pair used by `highlights_data`):

```jsonc
{
  "id": "txt_<clientRandom>",   // client-generated, like highlight region ids (optimistic create)
  "spec": { /* full TextSpec — see below */ },
  "startTime": 3.20,            // seconds on the WORKING-VIDEO (concatenated) timeline
  "endTime":   7.85,            // half-open [startTime, endTime) at burn-in (see §5.4)
  "enabled":   true
}
```

`spec` is a `TextSpec` (T5180) serialized verbatim (`schemas.py:369` on the backend, `constants/textSpec.js`
on the frontend):

```
text, font (anton|oswald|graduate|playfair), size (frac of frame H),
color (#RRGGBB), align (left|center|right), position {x,y in 0..1},
maxWidth (frac of frame W), shadow {blur,color,opacity}, stroke {width,color},
animation (IGNORED in v1 — Overlay text is static; textSpec.js:68 already says so)
```

- `startTime`/`endTime` are in the **concatenated final/working timeline**, exactly the axis the overlay
  timeline and every render loop already use. No per-clip remapping.
- `id` is a string, client-minted (mirrors `useHighlightRegions` region ids) so add is optimistic.
- `enabled` lets a block be muted without deleting it (mirrors `toggle_region`). Only `enabled` blocks
  are rasterised/burned in.

### 1.2 Storage & versioning

- Column already exists (`database.py:985`, `text_overlays BLOB`). **No migration** — we fill an open
  socket. `/overlay-data` already decodes and returns it (`overlay.py:1764-1765/1855`) and already
  factors it into `has_data` (`:1858`).
- Writes bump the shared `overlay_version` (same counter as highlights) so the sync layer sees a change.
- **Never** fall back to `[]` on a decode error — `raise`, mirroring the hard rule at `overlay.py:387-397`
  (a silent `[]` would let the next read-modify-write erase every text block).

---

## 2. Clip boundaries — source & shape

### 2.1 Where they come from (server-side)

The concatenated per-clip offsets are already computable with the exact math `poster.py` uses for
slow-mo section resolution:
- `read_clip_segments_for_project(project_id)` (`poster.py:345`) → ordered
  `[(segments_data|None, source_duration|None), …]` for the latest `working_clips` in `sort_order`
  (concatenation order).
- Per-clip **output** duration (post-trim, post-speed) is what `first_slowmo_section` (`poster.py:247`)
  already accumulates via `start += clip_out`. We reuse the same walk to emit cumulative cut-points.

Add a small helper (co-located with the poster walk, e.g. `poster.py::clip_boundary_offsets(project_id)
-> list[float]`) that returns the **interior cut-points** on the working-video timeline:
`[d0, d0+d1, …]` (excluding the trivial `0.0` and the final `total`, which the client adds itself).
A leading clip of unknown output length (`(None, None)`) → bail to `[]` (no fabricated offsets), same
guard the poster walk uses.

### 2.2 Where they surface (API)

Extend the `/overlay-data` response (`overlay.py:1852-1870`) with:

```jsonc
"clip_boundaries": [4.10, 9.55, 12.00]   // interior cut-points, working-video seconds; [] if underivable
```

`/overlay-data` already imports `load_project_clip_segments` / `first_slowmo_section` (`overlay.py:59-68`),
so this is additive. It is a **read** (restore-read-only; no write-back).

### 2.3 Client threading

`OverlayScreen` reads `clip_boundaries` from `/overlay-data` (both loader effects, `:576-597` and
`:663-681`) into overlay state, and forwards it down `OverlayModeView → OverlayMode → TextLayer` so the
drag handler can snap. The full snap set the client uses = `[0, ...clip_boundaries, totalDuration]`
(reel start and end are snap targets too).

---

## 3. Timeline layer & snapping

### 3.1 The layer

`TextLayer.jsx` (new, under `components/timeline/` or `modes/overlay/layers/`) is a **near-clone of
`RegionLayer`'s pointer-event mechanics**, not a new drag idiom. It reuses verbatim (`RegionLayer.jsx`):
- `useIsCoarsePointer()` + `leverHitWidth = coarse ? 44 : 32`, `leverHitOffset` (`:71-75`).
- `pixelToTimeValue` (`:78-87`): `getBoundingClientRect` − `edgePadding`, clamp, percent × `visualDuration`,
  then `visualTimeToSourceTime` (identity in overlay).
- `draggingLever` state `{ blockId, type:'start'|'end', pointerId }` (`:67`).
- `onPointerDown` → `setPointerCapture(pointerId)` + set drag state (`:415-420/:437-442`).
- **window** listeners `pointermove {passive:false}` / `pointerup` / `pointercancel`, `pointerId`-guarded,
  `e.preventDefault()` when cancelable (`:98-132`).
- `touch-action:none` (`touch-none`) on each lever, `.lever-handle` class + the `handleTrackClick`
  `.lever-handle` guard (`:193`) so an edge drag doesn't also fire add-block.
- `data-testid="text-lever-start-{i}"` / `-end-{i}` for the real-browser QA.

Blocks render as bars on the track; click-empty-track adds a block (default ~2s span at the click time,
snapped). Selecting a block marks it active (opens the right-rail editor, §4) and shows its live preview.

Colour scheme distinct from highlight orange (e.g. a text/`cyan`/`violet` family) so the two layers read
apart.

### 3.2 Snapping — threshold & behaviour (gate item)

Free drag that **snaps to clip boundaries within a pixel threshold**, else parks anywhere (epic decision 4).

- **Threshold is PIXEL-based, converted to time at drag time** (zoom-invariant affordance — matches the
  15px click-to-add snap already in `RegionLayer:202-211`). Proposed `SNAP_PX = 10`. During
  `handlePointerMove`, convert the raw pointer time, then:
  1. Compute `rawTime = pixelToTimeValue(clientX)`.
  2. Map each candidate boundary `b ∈ [0, ...clip_boundaries, totalDuration]` to its pixel-x; find the
     nearest whose `|px(b) − clientX| ≤ SNAP_PX`.
  3. If one exists → **snap** (`newTime = b`); else → **free park** (`newTime = rawTime`).
- **At a clip edge:** the edge clicks exactly onto the cut-point, so "clips 1-2" is a single gesture that
  lands on true boundaries (start snaps to clip-1 start, end snaps to clip-2 end).
- **Mid-clip / free:** outside the threshold the value is the raw time, so "the first 3 seconds" (an edge
  parked at 3.0s inside clip 1) is still expressible.
- **Guards** (mirror RegionLayer): clamp start `≥ 0`, end `≤ totalDuration`, and enforce a minimum span
  (`MIN_TEXT_DURATION`, e.g. 0.3s) so an edge can't cross its partner.
- **Feedback:** when a snap is active, tint the boundary tick / lever (cheap visual affirmation; optional
  but recommended so the user learns the behaviour). Pure render state, no persistence.
- **Persisted value = the snapped/parked result**, computed at gesture time (never a raw pixel), same
  discipline as `resolveTargetFrame` for keyframes.

---

## 4. Shared TextSpec editor (gate item — must be reusable by T5205)

**Today there is NO TextSpec editing UI anywhere** (`RichText.jsx` is render-only; the overlay right rail
is the highlight-settings card). T5225 is the first consumer, so **T5225 defines the shared editor** and
T5205 (card editor) reuses it.

### 4.1 Component contract

`components/textspec/TextSpecEditor.jsx` — **pure presentational, store-free, API-free** (same posture as
`RichText`):

```jsx
<TextSpecEditor
  spec={spec}                 // current TextSpec
  onChange={(nextSpec) => …}  // emits a COMPLETE, valid TextSpec on every field edit
  fonts={FONT_CATALOGUE}      // from the T5180 fonts manifest
/>
```

- Controls: text input, font picker (4 faces), size, colour, alignment, shadow, stroke, position/maxWidth
  (position via drag on the preview is a stretch; numeric/slider for v1).
- It **owns no persistence and no store** — it only transforms a `spec` into a `nextSpec`. The *host*
  decides what to do with the change. This is what makes it literally the same component in two places,
  not a copy (epic "exactly one preview component" rule).
- Emitting a whole valid `TextSpec` (not field deltas) keeps the editor decoupled from the transport and
  lets the backend re-validate the spec as one atomic unit (§5.2).

### 4.2 Two hosts

- **T5225 (this task):** the overlay right rail hosts `<TextSpecEditor spec={selectedBlock.spec}
  onChange={handleEditText}/>`. `handleEditText` is the gesture wrapper that persists (§5.1).
- **T5205 (later):** the card editor hosts the same component per text slot; its `onChange` writes to the
  card's `text_elements`. No overlay code is imported by the card path.

### 4.3 Live preview

`<RichText spec={...} boxWidth boxHeight/>` absolutely positioned over the video preview, sized to the
displayed video rect (reuse `useVideoDisplayRect`, the T4550 SSOT, so it tracks letterboxing). Render each
**enabled** block whose `[startTime, endTime)` contains `currentTime`; additionally always preview the
**selected** block while its editor is open (so editing is visible even when the playhead is outside the
range). Preview is display-only — it never writes.

---

## 5. Persistence — gesture-based, surgical (no `useEffect` → API)

### 5.1 Frontend

Mirror `useHighlightRegions` + the `OverlayScreen` wrapped-handler pattern exactly:

- New hook `useTextOverlays` holding the array; methods return the updated entity (never rely on async
  React state in the same tick — the `wrappedAddHighlightRegion` stale-`.find` landmine, `OverlayScreen:711`).
- Wrapped handlers in `OverlayScreen` (optimistic local mutate → `if (canSyncActions)
  dispatchOverlayAction(label, () => overlayActions.X(...))` → `setOverlayChangedSinceExport(true)`):
  - `handleAddText(clickTime)` → `add_text`
  - `handleMoveTextStart(id, t)` / `handleMoveTextEnd(id, t)` → `move_text_edge`
  - `handleEditText(id, spec)` → `update_text_spec` (debounced ~250ms while dragging a slider, so a
    continuous drag coalesces into one POST at rest — still one gesture, one surgical write)
  - `handleToggleText(id, enabled)` → `toggle_text`
  - `handleDeleteText(id)` → `delete_text`
- `canSyncActions = overlaySyncState==='ready' && overlayLoadedProjectId===projectId` (`OverlayScreen:704`)
  is the structural **restore-read-only** guarantee: restore runs while state is `'loading'`, so no
  restore-time mutation fires a POST. We do NOT add any `useEffect` that writes.
- Transport reuses the existing envelope (`api/overlayActions.js`, `POST
  /api/export/projects/{id}/overlay/actions`, body `{action, target?, data?}`) via new functions
  `createText/moveTextEdge/updateTextSpec/toggleText/deleteText`. Retry/failure UX comes for free from
  `dispatchOverlayAction`/`overlayActionStore`.

### 5.2 Backend action handler

Add branches to the `overlay_action` dispatch (`overlay.py:551-797`, the `if/elif` chain):

| action | payload (`data`/`target`) | effect |
|---|---|---|
| `add_text` | `{id, spec, start_time, end_time}` | validate `spec` via `TextSpec(**spec)`; append `{id,spec,startTime,endTime,enabled:true}` |
| `move_text_edge` | `target:{id}`, `data:{start_time?, end_time?}` | update the named edge(s) (partial, mirrors `update_region`) |
| `update_text_spec` | `target:{id}`, `data:{spec}` | re-validate full `TextSpec`; replace that block's `spec` |
| `toggle_text` | `target:{id}`, `data:{enabled}` | set `enabled` |
| `delete_text` | `target:{id}` | remove the block (idempotent no-op if absent, like `delete_keyframe`) |

- Read/mutate/write inside the same `with get_db_connection()` transaction the handler already opens
  (`overlay.py:528`). Add a **dedicated text read/save pair** so the highlights read/save is untouched:
  - `_get_text_overlays(cursor, working_video_id)` → `decode_data` (raise on error, never `[]`).
  - `_save_text_overlays(cursor, working_video_id, text_overlays, new_version)` →
    `UPDATE working_videos SET text_overlays=?, overlay_version=? WHERE id=?` (`encode_data`).
  - `new_version = version + 1` from the existing `_get_overlay_data` read, so text and highlight edits
    share the one monotonic `overlay_version`.
- **Spec validation** reuses the Pydantic `TextSpec` (`schemas.py:369`). Invalid spec → 400
  (`ValueError` path at `overlay.py:808`), which `dispatchOverlayAction` treats as non-retryable.
- Extend `OverlayActionData` (`overlay.py:~283`) with `spec: dict|None` and reuse `start_time`/`end_time`/
  `enabled`; extend `OverlayActionTarget` usage to carry the text `id` (reuse `region_id`, or add `text_id`
  — decide at implementation; reusing `region_id` keeps the schema flat).

---

## 6. Render burn-in — how the two loops share the rasterised layer (gate item)

### 6.1 The chosen architecture: pre-rasterise ONCE on the app side, pass PNG bytes

Because overlay text is **time-invariant within its range** (animation ignored in v1), each block needs
exactly one rasterisation. We rasterise on the **app side** (which can import `text_render`) and hand the
**same PNG bytes** to both render loops. This is the cleanest way to satisfy every constraint:

- Satisfies "rasterise once per spec, reuse every frame" — one `render_text_layer` call per block, then
  `cv2.imdecode` once per block **before** each loop starts.
- Guarantees Modal and local produce **byte-identical** text (identical source pixels), which the local
  path could NOT guarantee if it rasterised independently.
- **Avoids adding Pillow to the Modal image and avoids a second inline renderer + parity test.** The Modal
  image (`video_processing.py:30-38`) has only `boto3/opencv/numpy` and does not mount `app`; passing a spec
  would force the `spotlight_reveal`-style inline-mirror tax. Passing decoded PNG bytes needs only `cv2`.
- `bytes` are a first-class Modal/cloudpickle argument — same channel `highlight_regions`/`overlay_settings`
  already travel on (`modal_client.py:1075-1083`). No serialization work.

**Rasterisation resolution.** `TextSpec` is fully frame-relative (sizes/positions are fractions), so we
rasterise at the export's **output resolution** (the same width×height the render loop's frames are — from
the working video / framing aspect). The app obtains these dims the same way the pipeline already does
(probe of the working video before dispatch, or stored dims). Design intent: rasterise at the true frame
dims so the loop never resizes. *If the frame dims differ from the rasterise dims* (edge case), the loop
resizes the decoded layer with `INTER_AREA`/`INTER_LINEAR` — but the target is exact-match. **Open
question O3 (§8): confirm the dims source at dispatch.**

### 6.2 App-side producer (new)

In the real-render background path (`_run_overlay_export_background`, `overlay.py:2071`):
1. Add `text_overlays` to the working-video SELECT that currently loads highlights (`overlay.py:~2254` —
   it does not select the column today).
2. For each `enabled` block: `img = render_text_layer(TextSpec(**block['spec']), w, h)` → encode RGBA to
   PNG bytes. Build `text_layers = [{startTime, endTime, png: bytes}]`.
3. Thread `text_layers` through `call_modal_overlay_auto` (`overlay.py:2109`) → `call_modal_overlay`
   (`modal_client.py:988`) → both `render_overlay.remote_gen` (`:1075`, Modal) and `_overlay_sync`
   (`:1026`, local), exactly how `overlay_settings` is already threaded.

### 6.3 Modal loop (`video_processing.py`)

`render_overlay` gains a `text_layers` param; `_process_overlay_gen` (`:281-415`) and its twin
`_process_overlay` (`:418-565`):
- **Before** the frame loop: `cv2.imdecode` each layer's PNG once → `(rgba, [startTime,endTime])`; split
  into `bgr` + normalized `alpha` (resize to frame dims only if needed).
- **Per frame**, after the highlight `_render_highlight` call and **before** `ffmpeg_proc.stdin.write`
  (blend point `:368→:370` in `_gen`, `:534→:536` in the twin): for each layer with
  `startTime <= current_time < endTime`, `frame = frame*(1-alpha) + bgr*alpha` (vectorised numpy).

A tiny inline `_alpha_blend_bgr(frame, bgr, alpha)` helper is duplicated in the Modal module (≈8 lines,
same "can't import app" reason as `_spotlight_reveal`), with a keep-in-sync comment. **A Modal redeploy is
required** for this code change — **ASK THE SUPERVISOR before `modal deploy
app/modal_functions/video_processing.py`** (per `src/backend/CLAUDE.md`).

### 6.4 Local loop (`local_processors.py` / `overlay.py:_process_frames_to_ffmpeg`)

`_overlay_sync` (`local_processors.py:505`) and `_process_frames_to_ffmpeg` (`overlay.py:826-1002`) run in
the app process and receive the **same** `text_layers` PNG bytes. Same recipe: `imdecode` once before the
loop, blend per active frame between `render_highlight_on_frame` and the stdin write (`:975→:978`). The
blend helper here can live in a shared `app/services` module (local path can import app), but to keep
Modal/local byte-identical the **input is the identical pre-rendered PNG**, so both do the same numpy op.

### 6.5 Completion-path consistency (all three paths must agree)

The dangerous path is the **no-keyframes copy** (`overlay.py:2354`): `has_keyframes` (`:2337`) inspects
only highlight regions. If a reel has text blocks but no highlight keyframes, it R2-copies the raw working
video and **silently drops the text**. Fix:

- Compute `has_text = any(b['enabled'] for b in text_overlays)` and change the gate to
  `if not (has_keyframes or has_text): <copy path>`. When text exists, route to the real render path.
- **Test-mode path** (`:2436`, `X-Test-Mode` + not modal) stays render-blind by design — document that any
  test asserting text burn-in must NOT use the test-mode header (it must exercise the local render path).
- Real render path is the producer in §6.2.

This mirrors the task's "no-keyframes copy path, test-mode path, real render path all agree on whether text
is present."

---

## 7. UX truth — "burned in, re-export needed" (stated at edit time)

Overlay text is burned into the render (unlike the intro card). Surface the consequence **at the moment of
editing**, not at export:
- A persistent inline note in the text editor rail: *"Overlay text is burned into the exported video —
  changing it means re-exporting, like spotlights."*
- This is copy only; it reuses the existing spotlight/overlay "changed since export" affordance
  (`overlayChangedSinceExport` is already set by every text gesture, §5.1), so the export button's
  re-export prompt already lights up. No new persistence.

---

## 8. Open questions for approval — RESOLVED (supervisor, 2026-08-04)

- **O1 — Dead-code integration point (§0.1). RESOLVED: YES.** Integrate into the live `OverlayMode.jsx`.
  Leave `OverlayTimeline.jsx` alone — deleting it is out of scope for this task and is filed separately by
  the supervisor. Do NOT quietly delete it. (Supervisor note: the audit correction is a correction to the
  *task-file/EPIC spec*, which claimed `OverlayTimeline.jsx` reserved the slot — the reserved-slot comments
  are real, but whether that component is actually rendered was never verified before this task. Task file
  is being fixed on master separately.)
- **O2 — `clip_boundaries` on `/overlay-data` (§0.2/§2). RESOLVED: YES.** It is a read, no migration.
  Derive it server-side with the **same** per-clip output-duration walk `poster.py` already uses — do not
  write a second walk. No column-guard needed (no new column). **Binding: must degrade to an empty list,
  never 500**, when boundaries can't be reconstructed — the concrete case to check is a **published reel
  with pruned `working_clips`** (publish prunes them; live reconstruction returns `[]`, same as the
  existing slow-mo-section resolution fallback).
- **O3 — Rasterise dims source (§6.1). RESOLVED.** Chosen source: **probe the working video's actual
  encoded frame dimensions** at dispatch time (the same ffprobe/cv2 dims each render loop already reads
  off its own input, not a separately-stored column that could drift from the real file). Rationale: the
  binding invariant is that the rasterised layer's dimensions **equal** the frame dimensions the loop is
  about to encode, and a probe reads the source of truth directly rather than trusting a stored value that
  could be stale (e.g. a re-export at a different aspect ratio). **A mismatch must fail loudly, never
  silently rescale** — if the decoded PNG dims disagree with the loop's frame dims, raise/log CRITICAL and
  abort that block's blend rather than `cv2.resize`-ing to paper over it (implementation detail: add an
  explicit dimension-equality assertion at the decode-once step in both loops).
- **O4 — Spec-edit granularity (§5.2). RESOLVED: whole-spec per block, debounced.** Entity-surgical (one
  text block per call), validates atomically, and matches the project persistence rule's intent — the rule
  bans sending *unrelated* state, not sending a whole entity that itself changed. Debounce (~250ms) so a
  continuous slider/drag coalesces into one POST at rest; never a POST per keystroke.
- **O5 — Modal redeploy. RESOLVED: supervisor's step.** Implement and fully test the **local** render path;
  do NOT deploy. The Modal code change lands in this branch's commit but stays inert until the supervisor
  runs `modal deploy app/modal_functions/video_processing.py`. The local path must be genuinely exercised
  (rendered-video check, §6.4) so the work is verifiable before that deploy happens — report the pending
  deploy explicitly at Stage 7/completion.
- **O6 — Half-open vs closed range (§5.4/§1.1). RESOLVED: half-open, `start <= t < end`, CONFIRMED.**
  Highlights being closed is a real, acknowledged inconsistency — **do not change highlight behaviour** in
  this task. Document the asymmetry explicitly in `.claude/knowledge/export-pipeline.md` at Stage 7 so a
  future reader does not assume the two layers share boundary-inclusion semantics.

**Also approved as designed (no changes):** the no-keyframes copy-path gate becoming
`has_keyframes or has_text` (§6.5 — a genuine bug the audit found: text was being silently dropped);
`TextSpecEditor.jsx` as a pure presentational component for T5205 to reuse (§4); pre-rasterising app-side
so Modal only needs `cv2.imdecode`, avoiding a Pillow install + a second parity surface (§6.1).

---

## 9. Files touched (estimate ~9, ~600 LOC)

**Frontend**
- `modes/overlay/OverlayMode.jsx` — label + `<TextLayer>` slot + `getTotalLayerHeight`.
- `modes/OverlayModeView.jsx` + `containers/OverlayContainer.jsx` — forward props through both call sites.
- `components/timeline/TextLayer.jsx` — **new**, RegionLayer-mirrored drag + clip snapping.
- `components/textspec/TextSpecEditor.jsx` — **new**, shared editor (T5205 reuses).
- `modes/overlay/hooks/useTextOverlays.js` — **new**, array state + entity-returning methods.
- `screens/OverlayScreen.jsx` — wrapped gesture handlers, restore of `text_overlays` + `clip_boundaries`,
  live `RichText` preview host.
- `api/overlayActions.js` — `createText/moveTextEdge/updateTextSpec/toggleText/deleteText`.

**Backend**
- `routers/export/overlay.py` — 5 action branches + `_get/_save_text_overlays`; `clip_boundaries` on
  `/overlay-data`; `text_overlays` in the render SELECT; `has_text` completion-path gate; app-side
  rasterise producer.
- `services/poster.py` — `clip_boundary_offsets` helper (reuses the existing walk).
- `modal_functions/video_processing.py` — `text_layers` param + decode-once + per-frame blend (**redeploy**).
- `services/local_processors.py` / `_process_frames_to_ffmpeg` — `text_layers` param + decode-once + blend.
- `modal_client.py` — thread `text_layers` through `call_modal_overlay(_auto)`.

**No migration** (`text_overlays` column exists).

## 10. Test plan (Stage 3/5/QA — for reference, not this gate)

- Backend unit: action branches (add/move/edit/toggle/delete), spec validation reject, decode-error raise
  (never `[]`), `clip_boundary_offsets` walk (single/multi-clip/underivable), `has_text` gate routes off
  the copy path. A **Modal-inline blend parity** test (like `test_spotlight_reveal.py`) if any blend logic
  is duplicated.
- Frontend unit (Vitest): `useTextOverlays` entity returns + optimistic add (no stale `.find`), snapping
  math (snap within threshold / free park outside), `TextSpecEditor` emits valid full specs, restore-read-
  only (no POST while `overlaySyncState!=='ready'`).
- **Real browser (mandatory, jsdom gives false confidence — T5380):** add text, drag both edges, confirm
  snap-at-boundary vs park-mid-clip, edit spec in the shared rail, delete, reload → restore with **no
  write-back**; two overlapping blocks; empty text; responsive sweep.
- **Rendered-video check (mandatory):** export and confirm text appears over exactly the chosen range and
  matches the preview; **Modal path vs local path identical**; layer rasterised once (assert one
  `render_text_layer`/decode per block, not per frame).
- Evidence via `e2e/helpers/qa.js` `saveEvidence` + `responsiveSweep`. Known flake:
  `test_vacuum_on_signout` (master, not ours).
