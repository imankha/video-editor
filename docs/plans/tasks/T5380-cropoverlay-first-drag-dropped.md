# T5380: CropOverlay drops the first drag gesture after mount

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-17

## Problem

Found by the T5320 worker while getting `T4550-overlay-transform.qa.spec.js` to pass: the **first
crop-adjust drag after `CropOverlay` mounts is silently dropped** — the crop doesn't move. The
2nd and every subsequent drag work. The QA spec had to insert a "warm-up prime drag" to get a
deterministic measurement, and the underlying product bug was flagged (not masked).

Root cause: `CropOverlay`'s window `mousemove`/`mouseup` listeners are attached in a `useEffect`
gated on `isDragging`. On the first `mousedown`, React schedules the state update + the effect that
registers the listeners, but the synthesized/real first `mousemove` can fire before the effect
commits the listeners → the first move is lost. Subsequent drags already have the listeners attached.

User impact: a user opening Framing and immediately dragging to adjust the crop sees the first drag
do nothing; they have to release and drag again. Small but real friction on a core gesture.

## Solution
Attach the drag `mousemove`/`mouseup` listeners so the first gesture is never lost. Options:
- Attach the window listeners on `mousedown` itself (in the handler, not a gated effect), or
- Register the listeners unconditionally on mount and gate the *handler bodies* on `isDragging`,
  or use a ref instead of an effect-gated attach.
Keep it minimal; do not restructure the transform (T4550's `useVideoDisplayRect` is the source of
truth for coordinates — don't touch it). Verify the same pattern isn't repeated in the other overlays
that now share `useVideoDisplayRect` (HighlightOverlay / PlayerDetectionOverlay drag handlers).

## Relevant files
- `src/frontend/src/modes/framing/overlays/CropOverlay.jsx` — the drag handlers + the `isDragging`-gated effect
- `src/frontend/src/hooks/useVideoDisplayRect.js` — coordinate transform (do NOT modify; reference only)
- `src/frontend/e2e/T4550-overlay-transform.qa.spec.js` — has a warm-up prime; once fixed, the prime
  can be removed and the spec should pass on the FIRST drag (tighten it as the regression proof)

## Acceptance Criteria
- [ ] The first crop drag after mount moves the crop (no dropped gesture); verified in the running app
- [ ] The T4550 QA spec passes WITHOUT the warm-up prime (remove it; first drag measured directly)
- [ ] No regression to subsequent drags, zoom/pan, or fullscreen; other overlays checked for the same race
- [ ] Tests pass

## Context
### Related Tasks
- Found by: T5320 (staging e2e fixtures) while proving T4550 on staging. Touches T4550's overlays.

### Classification hint
S/M-tier, frontend-only, 1 component + spec tightening. The fix is small; the value is a core-gesture
polish. Drive the real app to confirm the first drag registers.
