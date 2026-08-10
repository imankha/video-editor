# T6720: Overlay text — drag to reposition ON THE FRAME (spatial position), alongside existing align presets

**Status:** TODO
**Impact:** 6 | **Complexity:** 4
**Epic:** [Player Intro + Rich Text](player-intro/EPIC.md) — Overlay text follow-up
**Follows:** [T5225](player-intro/T5225-overlay-text-layer.md) (base layer, merged), [T6610](player-intro/T6610-overlay-text-element-manipulation.md) / [T6630](player-intro/T6630-overlay-text-add-remove-drag-ux.md) (TEMPORAL drag — moving a text block's start/end TIME along the timeline lane; both merged, both **untouched by this task**)

## Problem

`TextSpec` already carries a normalised spatial position (`Position { x, y }` — frame-relative
anchor point, `x`/`y` both 0..1; `src/backend/app/schemas.py:329-333`, consumed at
`text_render.py:130-131` and mirrored in `RichText.jsx:220-221`) — the DATA MODEL has supported
custom placement since T5180. But there is **no UI to set it**: `TextSpecEditor.jsx`'s only
positioning control is an **Align dropdown** (~lines 158-172), which picks from a fixed set of
preset anchors. `spec.position` is never read or written from that dropdown or anywhere else in
the editor. A user cannot drag a text block to an arbitrary spot on the video frame today — only
choose from the preset list.

Do not confuse this with T6610/T6630's drag work, which is **temporal** (moving a block's
start/end time along the horizontal timeline lane, `TextLayer.jsx` in
`src/frontend/src/components/timeline/`) — that shipped and is unrelated to spatial placement.
This task is about WHERE the text sits on the video frame, not WHEN it appears.

## User decision (2026-08-10) — both must coexist

The align-preset system stays exactly as it works today; free-drag positioning is **additive**,
not a replacement. Do not remove or gate the Align dropdown behind a "custom position" mode
switch that regresses the existing preset workflow for users who never touch drag.

**Open question to resolve before/during implementation** (recommend deciding this explicitly
with the user or ui-designer before writing code, since it changes the data flow): align presets
and drag are almost certainly just two different ways to WRITE the same `spec.position` field,
not two parallel systems —
- Recommended reconciliation: picking an align preset sets `position` to that preset's canonical
  x/y (current behavior, unchanged). Dragging the block live on the preview sets `position`
  directly to wherever it was dropped (a "custom" position). The Align dropdown should visually
  reflect "Custom" (or deselect) once a drag has moved the block off any preset's exact
  coordinates, and picking a preset afterward snaps back onto it (overwriting the custom drag) —
  this is the same everyday behavior of e.g. a text-editor's alignment buttons vs. manual
  indentation, so it should feel unsurprising.
- Confirm this resolution (or the user's alternative) explicitly before implementing — don't
  assume silently, this is exactly the kind of reconciliation that's easy to get subtly wrong.

## Solution

- **Where it renders:** the LIVE Overlay preview — `RichText.jsx` positioned over the video
  preview inside the Overlay screen's canvas (the same live-preview surface the user already
  watches while editing text; find the exact mount point in `OverlayModeView.jsx`/`OverlayMode.jsx`
  — Code Expert step, do not assume without checking against current code, which has moved since
  T5225 was written).
- **Drag idiom:** reuse the ESTABLISHED spatial-drag pattern already in this codebase for
  `HighlightOverlay`/`CropOverlay` (the circle-region move/resize drag) rather than inventing a
  new one — same window mousedown/mousemove/mouseup lifecycle, same lesson from T5380 (attach
  listeners on mousedown, not gated in a useEffect that races the first move event; that exact
  bug shipped once already on a sibling drag surface).
- **Only the SELECTED text block is draggable** (the one the right-rail editor currently has open)
  — dragging an unselected block is out of scope; clicking selects it (existing behavior from
  T6630), then the drag handle/hit-area becomes active.
- **Clamp to the frame.** The dragged position must keep the text block's actual rendered
  bounding box on-screen — not just its anchor point. Text block size is dynamic (font size,
  content length, wrapping), so the clamp must measure the LIVE rendered box, not a fixed
  assumption. Decide and document the exact clamping rule (e.g. anchor cannot leave `[0,1]` minus
  half the block's normalised width/height) and test it with both a short and a long string.
- **Persistence: ONE surgical write per drag end** (gesture-based-sync convention — this
  codebase's standing rule, see `src/backend/.claude/skills/gesture-based-sync/SKILL.md` and
  T6610's precedent: local move per pointer tick, exactly one write on release, no `useEffect` ->
  API). Local-only during the drag; the write fires on pointerup.
- **Real-browser verification is mandatory, not optional** — this codebase has shipped this
  EXACT class of bug before (T5380: a drag surface's first gesture silently dropped because
  listeners raced a `useEffect`; only a real-chromium harness caught it, jsdom passed a false
  positive). Do not rely on jsdom for the drag mechanics.

## Explicitly out of scope

- The intro CARD editor. Since T6640 (epic decision 12), card text position is fully
  geometry/template-owned and `TextSpecEditor` was removed from the card rail entirely — cards
  are not part of this task and must not regain a position-editing surface. `TextSpecEditor.jsx`
  is effectively Overlay-only now; confirm in the Code Expert step that no other host still mounts
  it before changing its shape.
- T6610/T6630's temporal (time-axis) drag — already shipped, do not touch `TextLayer.jsx`'s
  timeline-lane drag logic.
- Multi-select / dragging more than one block at once.

## Context

### Relevant files (verify against current code first — this area has moved since T5225/T6630)
- `src/backend/app/schemas.py` — `Position`/`TextSpec.position` model (already exists, read-only
  need here, no schema change expected)
- `src/backend/app/services/text_render.py` — consumes `spec.position` for the burned-in render;
  confirm the export path stays in sync with whatever the live preview shows (parity, same rule
  every TextSpec-consuming surface in this epic follows)
- `src/frontend/src/components/RichText.jsx` — live preview renderer, currently READS
  `spec.position` only (`:220-247`); this is where drag interactivity gets added
- `src/frontend/src/components/textspec/TextSpecEditor.jsx` — Align dropdown (~`:158-172`); needs
  the reconciliation logic from the "User decision" section above
- `src/frontend/src/modes/overlay/OverlayModeView.jsx` / `OverlayMode.jsx` — find the exact live
  preview mount point
- `src/frontend/src/components/CropOverlay.jsx` / `HighlightOverlay.jsx` — the established
  spatial-drag idiom to reuse, and the T5380 landmine to avoid repeating

### Related tasks
- [T5225](player-intro/T5225-overlay-text-layer.md) — base Overlay text layer
- [T6610](player-intro/T6610-overlay-text-element-manipulation.md) /
  [T6630](player-intro/T6630-overlay-text-add-remove-drag-ux.md) — temporal drag (sibling, not
  touched by this task)
- [T6640](player-intro/T6640-cards-cannot-be-ugly.md) — the reason cards are out of scope
  (decision 12, template-owned typography)
- [T5380](T5380-cropoverlay-first-drag-dropped.md) — the first-drag-dropped landmine this task
  must not repeat

### Classification hint
M-tier. Frontend-only (no schema change — `position` already exists on `TextSpec`). Reviewer
required (shared-component change to `TextSpecEditor`/`RichText`, both used elsewhere in the
Overlay flow). Real-browser verification mandatory.

## Acceptance criteria
- [ ] The currently-selected Overlay text block can be dragged to an arbitrary position on the
      live video preview; position updates the SAME `spec.position` field the align presets write.
- [ ] Existing Align preset dropdown continues to work exactly as today for users who never drag.
- [ ] The reconciliation between align-preset and free-drag (see "User decision" above) is
      implemented and matches what was confirmed with the user before coding.
- [ ] Drag is clamped so the block's actual rendered bounding box never leaves the frame, verified
      with both a short and a long string.
- [ ] Exactly ONE surgical write per drag (pointerup), never during the drag itself.
- [ ] What the live preview shows during/after a drag matches the burned-in export (parity check
      on a real rendered clip, not just the editor).
- [ ] Real-browser evidence for the drag mechanics (first-gesture-not-dropped, per T5380).
- [ ] T6610/T6630's temporal (timeline) drag is unaffected — verified with its existing tests.
- [ ] The intro card editor is unaffected (out of scope, confirmed untouched).
