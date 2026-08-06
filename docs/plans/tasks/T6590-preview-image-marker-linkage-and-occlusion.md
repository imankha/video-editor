# T6590: The thumbnail marker owns the whole interaction — rename, drag-to-set, and stop occluding it

**Status:** TODO
**Impact:** 7 | **Complexity:** 4
**Follows:** [T6510](T6510-rename-cover-photo-preview-image.md) (cover photo -> preview image),
[T6560](T6560-overlay-preview-image-and-copy.md) (marker moves but never clears)

User, 2026-08-05, with an annotated screenshot circling **two** things — the **"Use current frame"**
button in the Preview image card, and the **marker icon on the timeline**:

> for overlay, we need to link these two things visually and not occlude the icon.

User, 2026-08-06, going further and settling the direction:

> instead of calling it preview image, call it thumbnail in all text on overlay. We need a clearer
> UI that links the blue icon for setting this. What if there was no "set current Frame" button.
> Instead, when the user can drag the icon for thumbnails. The icon is currently cut off and
> shouldn't be. the icon on the timeline could be lower (in the middle). The rollover text should
> clarify the use, that dragging the marker changes the thumbnail frame.

**The 2026-08-06 direction supersedes the "link the two surfaces" framing of the original report.**
You do not link two surfaces that read as unrelated — you delete one of them and let the marker own
the interaction outright.

## 1. Rename: "preview image" -> "thumbnail", in ALL text on Overlay

This is the THIRD name for this datum (cover photo -> preview image in T6510 -> thumbnail now), so
do it completely and leave no mixed vocabulary. Sweep every user-visible string on the Overlay
screen: the settings card heading and body copy, the marker tooltip, the `aria-label`, any toast,
and any empty/error state. Keep the accessible name meaningful, not just renamed.

Scope note: rename **user-visible text**. Do NOT rename the `poster_*` data model, columns, R2 keys,
or API fields — the datum is `poster_frame_time` / `poster_filename` throughout the backend and a
data rename is a separate, much larger change with migration cost. If the mismatch between UI
wording and code naming is confusing, add ONE comment at the component boundary saying the UI calls
it "thumbnail" and the model calls it "poster"; do not half-rename the model.

## 2. Delete the "Use current frame" button; the marker IS the control

Today the value is set from two places with no shared visual language — the Preview image card in
the right rail (`OverlaySettingsCard.jsx:218-270`) and the marker on the timeline
(`PosterMarkerLayer.jsx`). Removing the button collapses that to one control and removes the
question the original report was really asking.

- Dragging the marker sets the thumbnail frame. That is the single interaction.
- The card keeps showing the resulting thumbnail and its time ("Frame you picked - 0:01") as
  **feedback**, not as a control.
- **Discoverability is the risk this creates and it must be answered explicitly.** Losing the button
  loses the one obvious affordance. T5410 made visible-at-rest a hard invariant, and T5910/T6300 are
  the hidden-affordance bug class. The marker must read as draggable at rest — do NOT gate the
  affordance behind hover.
- Persistence stays on the ONE existing write path (`OverlayScreen.jsx:1029+`
  `wrappedSetPosterMarkerTime`), one surgical write on drag end. Do not add a second write path, and
  do not write during the drag.

## 3. The rollover text must explain the interaction

The tooltip (`PosterMarkerLayer.jsx:129`) and `aria-label` (`:139`) must say what dragging DOES —
that dragging the marker changes which frame is used as the thumbnail. Not a noun label ("Preview
image marker"), a statement of the interaction. This matters more once the button is gone, because
the tooltip becomes the primary explanation.

## 4. The icon is cut off, and it is occluded

Two distinct defects; fix both and do not conflate them.

- **Cut off**: the icon is clipped by its container. `PosterMarkerLayer` renders with a negative
  `-top-3` offset against the video-track rail, so the glyph is trimmed at the boundary. Find the
  actual clipping ancestor (`overflow` on the track/scroll container) rather than nudging the offset
  until it looks right.
- **Occluded**: it is pinned to the **top rail of the video track — deliberately "the same band as
  the playhead"** (component docstring). That avoided colliding with `RegionLayer`'s drag handles
  and traded it for a collision with the playhead. It is worst exactly when the feature is used,
  because setting the frame puts the playhead AT the marker's time, so the two are guaranteed to
  coincide.

**The user proposes moving the marker lower — "in the middle" of the timeline.** Evaluate that
against what the docstring says the top rail was protecting (the region drag handles). If lower
works, take it and UPDATE the docstring so the next reader does not restore the old placement. If it
reintroduces a collision, say so with evidence and solve the occlusion another way (dedicated band,
z-order via the merged `zLayers.js` scale, or an outline that reads through the playhead line).
Do **not** solve it by hiding the marker on overlap or gating it behind hover.

Check overlap against the region drag handles, the text lane (T6630 is changing that lane's height
and controls), and **at 500% zoom**, where the playhead is thick relative to the marker.

## Relevant files
- `src/frontend/src/components/OverlaySettingsCard.jsx:218-270` — the card + the button to remove
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx` — marker, the docstring explaining
  the top-rail placement, `:129` tooltip, `:139` aria-label
- `src/frontend/src/screens/OverlayScreen.jsx:1029+` — `wrappedSetPosterMarkerTime`, the ONE write path
- `src/frontend/src/constants/zLayers.js` — the ordered z-index scale (T6600); use it, not a raw number
- `src/frontend/src/modes/overlay/OverlayMode.jsx` — layer stack + `getTotalLayerHeight()`

## Classification hint
M-tier, frontend only, no schema. **Real-browser verification mandatory** — drag/pointer and
occlusion cannot be proven in jsdom (T5380), and harness-only verification is rejected (the
2026-08-05 false green). Reviewer required. Coordinate with T6630, which is changing the text lane
directly below this marker.

## Acceptance criteria
- [ ] No user-visible string on Overlay says "preview image" or "cover photo"; everything says
      "thumbnail", including the tooltip and the accessible name.
- [ ] The "Use current frame" button is gone and dragging the marker is the only way to set the frame.
- [ ] The marker reads as draggable AT REST, with no hover required to discover it.
- [ ] The tooltip states that dragging changes the thumbnail frame.
- [ ] The icon is never clipped by its container, at default and 500% zoom.
- [ ] The icon stays fully readable when the playhead is exactly at the marker's time.
- [ ] The marker does not collide with the region drag handles or the text lane at its new position.
- [ ] Exactly ONE surgical write per completed drag, on drag end, via the existing write path.
- [ ] Real-browser evidence at desktop and 375px, at default and 500% zoom.
