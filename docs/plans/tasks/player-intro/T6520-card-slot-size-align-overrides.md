# T6520: Per-slot size and alignment control on an intro card

**Status:** TODO
**Impact:** 5 | **Complexity:** 3
**Follows:** [T5205](T5205-card-editor-ui.md) (card editor, merged 2a3594a6),
[T5210](T5210-intro-card-generation.md) (render engine + shared contract, merged 9c603f6f)

## Problem

[T5205](T5205-card-editor-ui.md) originally specified a right rail with **text, font,
size (S/M/L/XL), colour and alignment**. Size and alignment shipped **removed**, and the removal was
correct given the contract as built: `intro_card_geometry` owns layout, `_merge_spec` resolves it
"layout always wins", and `text_elements` is styling-only. Rail controls for size and align would
have edited fields the renderer ignores — the preview would have shown one thing and the export
produced another, which is the exact failure the shared contract exists to prevent.

So the user lost two controls they had asked for. This task gives them back **without** taking layout
ownership away from the contract.

## Approach (decided with the user at merge time — 2026-08-04)

Do NOT make size/align styling-owned. Keep geometry as the source of layout truth and let the card
express an adjustment **relative** to it:

- **Size becomes a multiplier.** S/M/L/XL map to something like `×0.85 / ×1.0 / ×1.15 / ×1.3`
  applied to the slot's geometry size. The per-aspect tuning survives — a title is still `0.066` of
  frame height at 9:16 and `0.12` at 16:9, and the multiplier scales whichever applies.
- **Alignment becomes an override.** Absent = use the geometry's align. Present = use the override,
  still inside the slot's `maxWidth` box so nothing escapes its column.
- Both live in `text_elements[slot]` alongside the existing styling, and **both must be resolved in
  the ONE shared place** (`_merge_spec` + its JS mirror `buildPreviewElements`), never at a call site.

## Why a multiplier rather than an absolute size

An absolute per-slot size would have to be stored per aspect, or it would frame correctly at 9:16 and
wrongly at 16:9 — the same reason the photo uses a normalised focal point rather than a crop rect
(epic decision 3b). A multiplier is aspect-agnostic by construction.

## Watch out for

- **Overflow.** A long club name in Graduate at 16:9 recruiting already wraps to two lines at ×1.0
  (measured during T5210 QA). At ×1.3 it may wrap to three or collide with the slot below. Decide the
  behaviour — clamp, shrink-to-fit, or allow and let the user see it — and TEST it, do not discover it.
- **Parity is the whole point.** Whatever resolution rule you write must exist once in Python and
  once in JS with the parity test extended to cover it. If the two disagree, the preview lies.
- The multiplier ladder is a product decision; show the user rendered samples at each step rather
  than asking them to approve four numbers.

## Relevant files
- `src/backend/app/services/intro_card_geometry.py` — the contract + `_merge_spec`
- `src/frontend/src/utils/introCardGeometry.js` — generated JS mirror (do not hand-edit)
- `src/frontend/src/components/introcards/introCardPreviewElements.js` — the JS `_merge_spec` mirror
- `src/frontend/src/components/textspec/TextSpecEditor.jsx` — has `hideSize`/`hideAlign` props added
  by T5205; this task re-enables them for the card host
- `src/backend/tests/test_t5210_geometry_parity.py`

## Classification hint
M-tier. Backend + Frontend. No migration (`text_elements` is a schemaless msgpack blob). Reviewer
required. Real-browser verification for the rail controls and the overflow cases.

## Acceptance criteria
- [ ] Size (S/M/L/XL) and alignment controls are back in the card editor's right rail.
- [ ] Size is a multiplier on the geometry size; ONE stored value frames correctly at 9:16 and 16:9.
- [ ] Alignment override respects the slot's `maxWidth` box.
- [ ] Resolution happens in the shared `_merge_spec` and its JS mirror only — no call-site logic.
- [ ] Parity test extended; Python and JS agree on every combination.
- [ ] The export matches the preview for every size step and both alignments, verified on real MP4s.
- [ ] Overflow behaviour at the largest step is decided, implemented and tested (Graduate + a long
      club name at 16:9 recruiting is the known worst case).
- [ ] `TextSpecEditor`'s other host (T5225 overlay text) is unaffected.
