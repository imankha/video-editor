# T6590: The preview-image marker and the "Use current frame" card read as two unrelated things — and the marker gets occluded

**Status:** TODO
**Impact:** 6 | **Complexity:** 3
**Follows:** [T6510](T6510-rename-cover-photo-preview-image.md) (preview image is always a frame),
[T6560](T6560-overlay-preview-image-and-copy.md) (marker moves but never clears)

User, 2026-08-05, with an annotated screenshot circling **two** things: the **"Use current frame"**
button in the Preview image card, and the **marker icon on the timeline**.

> for overlay, we need to link these two things visually and not occlude the icon.

## 1. The two surfaces are the same concept and look unrelated

The preview image is controlled from two places that share no visual language:

- the **Preview image card** in the right rail (`OverlaySettingsCard.jsx:218-270`) — a thumbnail,
  "Frame you picked · 0:01", and a **"Use current frame"** button;
- the **marker on the timeline** (`PosterMarkerLayer.jsx`) — a small teal image icon.

Nothing tells the user these drive the same value. Dragging the marker changes the thumbnail above,
and clicking "Use current frame" moves the marker, but neither surface points at the other. T5410's
design gate made *discoverability* the whole point of the marker; this is the other half — once seen,
the marker must be legible as *the preview image's position*.

Establish a shared visual identity across both. Options to weigh (do not just pick the first):
colour/iconography continuity (the card and the marker sharing one accent + the same `Image` glyph),
a labelled marker rather than a bare icon, an explicit hover/active tie (hovering either one
highlights the other), or naming the marker inline on the timeline. Whatever is chosen must survive
the marker's small size and the timeline's dark, busy background.

**Constraint:** the card's copy already says "Frame you picked · {time}". Keep one vocabulary across
both surfaces — the marker's `aria-label` is currently "Preview image marker" and its tooltip text
lives at `PosterMarkerLayer.jsx:129`. If the wording changes, change it in both, and keep the
accessible name meaningful.

## 2. The marker icon is occluded

`PosterMarkerLayer` is pinned to the **top rail of the video track — deliberately "the same band as
the playhead"** (component docstring). That choice avoided colliding with `RegionLayer`'s drag
handles below, and traded it for a collision with the playhead instead: in the report the playhead
sits on top of the marker and cuts through it. It is worst exactly when the user is doing this task,
because "Use current frame" puts the playhead **at** the marker's time — so the moment the feature is
used, the playhead and the marker are guaranteed to coincide.

Fix so the icon stays fully readable when the playhead is at or near the marker. Consider z-order,
a dedicated band, an offset, or a shape/outline that reads through the playhead line. Do **not**
solve it by hiding the marker on overlap or gating it behind hover — visible-at-rest is a T5410
invariant and the guard against the hidden-affordance bug class (T5910, T6300).

Check the same overlap against the region drag handles and at high zoom (the report is at **Zoom
500%**, where the playhead is thick relative to the marker).

## Relevant files
- `src/frontend/src/components/OverlaySettingsCard.jsx:218-270` — the Preview image card + button
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx` — marker, docstring explaining the
  top-rail placement, `:129` tooltip, `:139` aria-label
- the playhead layer + `TimelineBase` children slot (stacking context lives here)
- `src/frontend/src/screens/OverlayScreen.jsx:1029+` — `wrappedSetPosterMarkerTime`, the one write path

## Classification hint
M-tier, frontend only, no schema. **ui-designer required** — item 1 is a design question, and the
proposal should be approved before implementation. Real-browser verification is mandatory (this is a
layering/occlusion bug; jsdom cannot prove it — see the T5380 note). Screenshots at desktop and 375px,
**including the playhead parked exactly on the marker** and at Zoom 500%.

## Acceptance criteria
- [ ] The Preview image card and the timeline marker share an explicit visual relationship; a user
      seeing the marker can tell what it controls without being told.
- [ ] One vocabulary across both surfaces, including the marker's accessible name.
- [ ] The marker stays fully legible with the playhead at the same time index, at desktop and 375px
      and at Zoom 500% — proven by screenshots, not assertions.
- [ ] The marker remains visible at rest and keyboard-reachable (no hover gating, no hide-on-overlap).
- [ ] No regression to the region drag handles below.
