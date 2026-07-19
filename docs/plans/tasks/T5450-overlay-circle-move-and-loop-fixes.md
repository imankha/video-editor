# T5450: Overlay mobile fixes from testing — circle move-grip + tracking-gated levers; loop play/pause

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-19
**Follows:** T5390 (overlay circle touch) + T5370 (spotlight loop) — corrections from real mobile testing.

## Problem (user testing 2026-07-19, mobile)
1. **Can resize the spotlight circle but can't move it.** T5390's select-then-manipulate works for
   resize (handles appear after a tap) but the body-drag-to-move is unreliable/undiscoverable on
   touch. User wants a **dedicated move lever**.
2. **Selection should not be required.** The edit levers should appear automatically by **turning off
   the player-tracking layer** (the existing "Hide/Show player boxes" toggle, `showPlayerBoxes`), not
   by tap-selecting the circle.
3. **Loop playback won't stop.** Pressing the primary "Play spotlight" button a second time keeps
   looping instead of pausing.

## Decided design (user, 2026-07-19)
- **Levers gated on the tracking layer, consistent on mobile + desktop:** when player boxes are OFF
  (`!showPlayerBoxes`) the circle shows its edit levers (rim resize handles + a new center move grip)
  on EVERY device; when player boxes are ON the circle is **display-only** (no levers) and the video
  tap-nav behaves normally. This replaces T5390's tap-to-select / deselect-backdrop model entirely.
- **Center move grip (4-arrow):** a round grip with a 4-way move icon at the circle center; drag it
  to move the circle. Rim handles still resize. Both >=44px on coarse pointers (T5360 floor).
- **Loop button = true play/pause toggle:** pressing "Play spotlight" while playing PAUSES; pressing
  while paused seeks to span start (only if outside the span) then plays in loop mode. The
  "Back to spotlight" pill remains the return-to-start affordance.

## Relevant files
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx` — replace the `isSelected`/
  `onSelectedChange` select-then-manipulate gate with an `editable` (= `!showPlayerBoxes`) gate; add
  the center 4-arrow move grip (reuse `beginBodyDrag` + the pointer-move math with setPointerCapture);
  keep rim resize handles; remove the deselect backdrop.
- `src/frontend/src/containers/OverlayContainer.jsx` — `showPlayerBoxes` / `togglePlayerBoxes` already
  exist (:204/:206). Thread `showPlayerBoxes` (or `editable = !showPlayerBoxes`) to the view. **Fix
  `handlePlaySpotlight` (:182)** to a true play/pause toggle.
- `src/frontend/src/modes/OverlayModeView.jsx` — pass `editable` to HighlightOverlay; change the video
  tap-nav yield to key on `!showPlayerBoxes` (yield while levers are active) instead of the old
  `isHighlightSelected`.
- `src/frontend/src/screens/OverlayScreen.jsx` — thread any new prop through if needed.
- `src/frontend/src/modes/overlay/OverlayMode.jsx` — the "Hide/Show player boxes" button (:115) is the
  tracking toggle the levers key off; no change needed unless labeling helps discoverability.

## Acceptance Criteria
- [ ] Turning player boxes OFF shows the circle's resize handles AND a center move grip — no tap-to-
      select — on mobile AND desktop. Turning them ON hides the levers (display-only).
- [ ] Dragging the center move grip MOVES the circle (touch + mouse); dragging a rim handle resizes.
- [ ] While levers are active, dragging the circle does not scrub/play the video (tap-nav yields);
      while tracking is on, video tap-nav is normal.
- [ ] Pressing "Play spotlight" while it is looping PAUSES; pressing while paused plays (seek to span
      start only if outside the span); loop wrap still works; the "Back to spotlight" pill still works.
- [ ] Move grip + resize handles are >=44px on coarse pointers.
- [ ] Verified in a REAL browser (coarse + fine), not jsdom.

## Classification hint
M-tier, frontend-only, no schema/backend/persistence (ephemeral view state only). Overlay interaction.
Verify on a real browser / touch emulation (the T5390 first attempt passed jsdom but failed on real
touch — do not repeat that). Supersedes T5390's tap-to-select model.
