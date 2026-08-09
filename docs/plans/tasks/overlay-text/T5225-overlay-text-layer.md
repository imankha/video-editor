# T5225: Overlay text layer — rich text over a range of clips

**Status:** TODO
**Impact:** 7 | **Complexity:** 6
**Epic:** [Player Intro + Rich Text](EPIC.md) — depends on [T5180](T5180-rich-text-engine.md) only

> Read [EPIC.md](EPIC.md) (decisions 4, 5). UI mockup (timeline):
> <https://claude.ai/code/artifact/93478a34-c7e5-406f-a56b-3c3724e4b6dd> § 06 D.
> Knowledge docs: `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/keyframes-framing.md`,
> `.claude/knowledge/modal-gpu.md`.

## Problem

User requirement 5: *"the text overlay system will be re-used and brought into overlay where the
user can define a range of clips and add that same rich text."* Same TextSpec, same fonts, same
editing controls as the intro card — a different surface and a different renderer host.

**Because it needs only [T5180](T5180-rich-text-engine.md), this task can run early** if the Overlay
text is wanted before the intro cards.

## What already exists (verified 2026-08-03)

| Fact | Consequence |
|---|---|
| `working_videos.text_overlays` BLOB exists (`database.py:985`), is already returned by `/overlay-data` (`overlay.py:1716/1765/1855`), and already counts toward `has_overlay_edits` (`projects.py:332`). Nothing writes it, nothing renders it. | **No migration.** This task fills an open socket. |
| The `TextOverlay` model in `schemas.py:273` is a pixel-based placeholder. | T5180 replaces it with TextSpec. Do not extend the old one. |
| ~~`OverlayTimeline.jsx:103`/`:153` reserve a Text layer slot.~~ **WRONG — corrected 2026-08-04.** The comments exist, but `OverlayTimeline` is **dead code: it is never rendered anywhere.** The live timeline host is `OverlayMode.jsx` (`OverlayScreen → OverlayContainer → OverlayModeView → OverlayMode → RegionLayer`). | Integrate into **`OverlayMode.jsx`** — new label, `<TextLayer>` as a sibling of `RegionLayer`, `getTotalLayerHeight` bump, props forwarded through both `<OverlayMode>` call sites. Deleting the dead component is OUT of scope here. |
| **Clip boundaries do not exist client-side and are not on `/overlay-data`** (found 2026-08-04). | Snapping is impossible without them. Add a `clip_boundaries` read to `/overlay-data`, derived server-side by the SAME per-clip output-duration walk `poster.py` already uses — do not write a second walk. No migration. Must degrade to an empty list, never a 500, when boundaries cannot be reconstructed (a published reel has pruned `working_clips`). |
| The **no-keyframes copy path** (`overlay.py:2354`) gates on highlight keyframes only. | It would **silently drop text**. The gate becomes `has_keyframes or has_text`. |
| The overlay render is a **per-frame OpenCV/numpy loop** (`modal_functions/video_processing.py::_process_overlay`, `services/local_processors.py::_overlay_sync`), not an ffmpeg filter graph. | Text composites as an RGBA layer per frame, in **both** loops. |

## Scope

### A. Data model

- Each entry: `{ id, spec: TextSpec, startTime, endTime, enabled }` on the final/working timeline.
- Persisted into the existing `working_videos.text_overlays` BLOB, msgpack like its siblings.
- Read back through `/overlay-data` (already wired) and restored on load — **restore is read-only**,
  it must never trigger a write-back (project persistence rule).

### B. Timeline layer

- A third layer in `OverlayTimeline`, beside the highlight layer, in the slot the comments reserve.
- **Range editing: free drag that SNAPS to clip boundaries** (epic decision 4) — dragging an edge
  clicks onto a clip edge within a threshold but can be parked anywhere, so "clips 1-2" is one
  gesture and "the first 3 seconds" is still possible. Mirror `RegionLayer`'s pointer-event pattern
  (the spotlight region directly above it) rather than inventing a second drag idiom.
- Clip boundaries must be available on the overlay timeline to snap to — if `/overlay-data` does not
  already expose them, add them as a read (they are derivable from the project's working clips).
- Selecting a text block opens the **same right-rail editor as the card**
  ([T5205](T5205-card-editor-ui.md)) — it edits the same TextSpec, so it must be the same component,
  not a copy.
- Live preview: `RichText` positioned over the video preview, so what you see is what renders.

### C. Persistence

- **Gesture-based and surgical**: add / move-edge / edit-text / delete each send only their own
  change through the existing overlay action endpoint pattern (`overlay.py`'s action handlers), the
  same way highlight regions and keyframes already persist. **No `useEffect` -> API.**

### D. Render burn-in — both loops

- Modal: `_process_overlay` / `_process_overlay_gen` in `modal_functions/video_processing.py`.
- Local: `_overlay_sync` in `services/local_processors.py`.
- For each frame, alpha-blend the cached RGBA layer from `text_render.render_text_layer` (T5180)
  when `startTime <= t < endTime`. The layer is rendered once per spec and reused for every frame —
  never re-rasterise per frame.
- **A Modal redeploy is required** (`modal deploy app/modal_functions/video_processing.py`) — ask
  the user before deploying, per `src/backend/CLAUDE.md`.
- Text must survive the same paths spotlights do: no-keyframes copy path, test-mode path, and the
  real render path all need to agree on whether text is present.

### E. UX truth

Overlay text is **burned into the render**, unlike the intro card. Adding or editing text after a
reel is exported means re-exporting it — the same rule spotlights already follow. Say so **at the
moment of editing**, not at export time.

## Relevant files
- `src/frontend/src/modes/overlay/OverlayTimeline.jsx` (:103, :153 reserved slots)
- `src/frontend/src/components/timeline/RegionLayer.jsx` — the drag pattern to mirror
- `src/frontend/src/screens/OverlayScreen.jsx`, `src/frontend/src/stores/overlayStore.js`,
  `src/frontend/src/actions/overlayActions.js`
- `src/backend/app/routers/export/overlay.py` — action handlers, `/overlay-data`
- `src/backend/app/modal_functions/video_processing.py`, `src/backend/app/services/local_processors.py`

## Classification hint
L-tier: frontend + backend + Modal. **No migration.** Architect gate on the persistence shape and
the snapping rule. Reviewer required. Real-browser verification mandatory (drag/pointer behaviour —
jsdom gives false confidence, T5380). A rendered-video check is required, not just a preview check.

## Acceptance criteria
- [ ] A text block can be added on the Overlay timeline, its range dragged with clip snapping, its
      TextSpec edited in the same rail as the card editor, and deleted.
- [ ] It persists into `working_videos.text_overlays` via surgical gesture calls and restores on
      reload without a write-back.
- [ ] The rendered video shows the text over exactly the chosen range, matching the preview.
- [ ] Both the Modal and local render paths produce identical output.
- [ ] The layer is rasterised once per spec, not per frame.
- [ ] The "re-export needed" consequence is stated at edit time.
- [ ] Verified in a real browser AND on a rendered video file.
