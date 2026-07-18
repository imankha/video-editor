# T5390: Overlay spotlight circle can't be moved/resized by touch on mobile

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-18

## Problem

User report 2026-07-18 (imankh, staging smoke, mobile): in Overlay mode you can't move or resize
the spotlight **circle** by touch. Root cause (code read): `HighlightOverlay`
([HighlightOverlay.jsx](../../src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx))
wires **mouse-only** handlers — `handleEllipseMouseDown` (:91), `handleResizeMouseDown` (:105),
`handleMouseMove` (:118) — with **no `onTouchStart` / `onPointerDown` / touch handlers**. On a
phone the drag only works if the browser synthesizes mouse events from a touch, which it does
unreliably, and here it **loses to the video's own tap / swipe zones** (play/pause + seek regions
sit under the same area). So a touch on the circle scrubs/plays the video instead of grabbing the
circle. Pre-existing (not a T4550 regression — T4550 only changed the coordinate math, not the
event model); it has simply never worked well on touch.

## Solution (user-directed interaction model — mobile only)

Sidestep the gesture competition with an explicit **select-then-manipulate** model on touch
devices (desktop mouse behavior stays exactly as-is):

1. **One tap selects the circle.** A tap on the ellipse enters a "selected" state (ephemeral view
   state, never persisted). While selected:
   - the video's tap/swipe navigation is **suppressed over the circle's region** (so a drag can't
     be stolen by play/seek),
   - the resize **handles/levers appear** (bigger, >=44px touch targets — pairs with T5360), and
   - the circle body becomes **draggable to move**, the handles **draggable to resize**.
2. **Tap elsewhere (or a Done affordance) deselects** — handles hide, video tap-nav returns.
3. Implement input via **Pointer Events** (`onPointerDown/Move/Up` + `setPointerCapture`) so mouse
   and touch share one path, instead of duplicating mouse+touch handlers. Reuse T4550's
   `useVideoDisplayRect` `screenToVideo` for coordinates (don't hand-roll the inverse).
4. Desktop: no selection step required (mouse hover/drag unchanged); the selection state is a
   touch/coarse-pointer affordance (gate with the `coarse-pointer` variant from T5360, or
   `isMobile`). Keep desktop byte-identical.

## Relevant files
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx` — the ellipse + resize-handle
  interaction (mouse-only today); add selection state + pointer handlers
- the video tap/swipe-zone owner (OverlayScreen / the shared player tap-nav) — must yield while a
  circle is selected
- `src/frontend/src/hooks/useVideoDisplayRect.js` — `screenToVideo` (T4550; reuse, don't modify)
- check the sibling `PlayerDetectionOverlay` / crop overlay for the same touch gap (CropOverlay's
  first-drag race is separately T5380)

## Acceptance Criteria
- [ ] On a phone: tap the spotlight circle -> it selects (handles appear); drag the body moves it;
      drag a handle resizes it; the video does NOT scrub/play during the manipulation
- [ ] Tap elsewhere deselects (handles hide, video tap-nav returns)
- [ ] Handles are >=44px touch targets (with T5360)
- [ ] Desktop mouse behavior byte-identical (no selection step, drag/resize as today)
- [ ] Selection state is ephemeral (never persisted); no reactive DB/store write from selection
- [ ] Verified on a real touch device / emulation; tests cover select -> move -> resize -> deselect

## Context
### Related Tasks
- Same mobile cluster: T5290 (recap mobile), T5360 (touch targets), T5370 (spotlight loop),
  T5380 (crop first-drag). Coordinates via T4550's `useVideoDisplayRect`.
- Found by: 2026-07-18 staging derisk smoke.

### Classification hint
M-tier, frontend-only, no schema/backend. The substance is the selection state + pointer-event
migration + making the video tap-nav yield; desktop must stay untouched. Drive a real touch
device to verify.
