# T6560: Overlay — the preview image can be switched off, and one line of copy earns nothing

**Status:** TODO
**Impact:** 6 | **Complexity:** 2
**Follows:** [T6510](T6510-rename-cover-photo-preview-image.md), T5410

Two items from staging use, 2026-08-05.

## 1. The preview image can be turned OFF from the timeline (bug)

> I am noting a ux bug with the Preview Image, it seems possible to turn it off on the timeline by
> clicking it. It shouldn't be possible.

Clicking the poster marker on the overlay timeline can clear the selection. **There is no valid
"no preview image" state** — T6510 established that the preview image is ALWAYS a frame: a default
is resolved, shown, and movable. An interaction that produces "none" contradicts that, and the
consequence is invisible until someone shares the link and gets a blank unfurl.

Fix so the marker can be **moved but never cleared**. If a "reset to the automatic frame" action is
wanted, it must land back on the auto default, never on nothing. Check the click/keyboard paths on
`PosterMarkerLayer` and whatever handler treats a repeat click or a click-at-current-position as a
toggle.

## 2. Remove "Applies highlight overlay (H.264)"

> In overlay this text doesn't really help, remove "Applies highlight overlay (H.264)"

It describes the implementation (a codec) rather than the consequence, to a user who has no decision
to make about it. Delete the line; do not replace it with a different explanation.

## Relevant files
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx`
- `src/frontend/src/screens/OverlayScreen.jsx` — marker gesture handlers
- `src/frontend/src/components/OverlaySettingsCard.jsx` — the preview-image block
- wherever the "Applies highlight overlay (H.264)" string lives (grep it)

## Classification hint
S/M-tier, frontend-only, no schema change. Real-browser verification for item 1 — it is a pointer
interaction, and jsdom will pass a toggle that a real click still triggers.

## Acceptance criteria
- [ ] No interaction on the timeline or in the panel can leave the reel with NO preview image.
- [ ] The marker can still be moved freely, and "use current frame" still works.
- [ ] If a reset affordance exists, it returns to the automatic frame, never to none.
- [ ] The "Applies highlight overlay (H.264)" string is gone and not replaced.
- [ ] Verified in a real browser, including a repeat click at the marker's current position.
