# T7390: CropOverlay drag/resize preventDefault silently no-ops on touch

**Status:** WIP
**Impact:** 4
**Complexity:** 3
**Created:** 2026-08-20
**Updated:** 2026-08-20

## Problem

Found via a user-supplied browser console log after a Framing export: repeated
`Unable to preventDefault inside passive event listener invocation.` warnings from
`CropOverlay.jsx:339` and `:324`.

Root cause: `handleCropPointerDown` (~L321) and `handleResizePointerDown` (~L338) are bound via
`onTouchStart` JSX props (`:617`, `:671`). React has attached `touchstart` as a **passive**
listener at its delegation root since React 17 (matching browser scroll-perf guidance), so
`e.preventDefault()` inside those handlers is a silent no-op — the browser default touch
behavior (page scroll / elastic bounce) is genuinely NOT being blocked while dragging the crop
box or a resize handle on a touch device, not just a noisy warning.

The same file already has the correct fix pattern for this exact class of problem:
`handleStraightenPointerDown` (~L374) uses `onPointerDown` + `setPointerCapture` +
(CSS) `touch-action: none`, called out in a comment as the established "T5640 straighten tool —
Pointer Events (real-browser rule: touch-action:none + setPointerCapture + pointerId filter;
precedent T5644/T5450)" pattern. The crop-drag/resize-handle code predates that migration and
was never moved over.

## Solution

Convert `handleCropPointerDown`/`handleResizePointerDown` and the window-level
`attachDragListeners`/`handlePointerMove`/`handlePointerUp` drag machinery from the dual
mouse+touch handler style to Pointer Events (`onPointerDown`/`onPointerMove`/`onPointerUp` +
`setPointerCapture`), matching the straighten-tool pattern already in this file, and add
`touch-action: none` to the crop rect + resize handle elements so the browser never contests
the drag in the first place.

## Context

### Relevant Files
- `src/frontend/src/modes/framing/overlays/CropOverlay.jsx` — `handleCropPointerDown` (~L321),
  `handleResizePointerDown` (~L338), `attachDragListeners` (~L311), `handlePointerMove`
  (~L2xx), `handlePointerUp` (~L279); JSX bindings ~L616-617, ~L670-671

### Related Tasks
- Precedent: T5640 (straighten tool), T5644, T5450 — same Pointer Events pattern already
  established in this codebase for touch-drag interactions
- Found alongside T7380 from the same user log-review session; unrelated bug, no shared code

## Implementation

### Steps
1. [x] Replace `onMouseDown`/`onTouchStart` pair on the crop rect + resize handles with a single
       `onPointerDown`, using `setPointerCapture`/`releasePointerCapture` instead of
       window-level mouse/touch listener attach-detach
2. [x] Add `touch-action: none` (CSS) to the crop rect and resize-handle elements
3. [x] Verify no `Unable to preventDefault inside passive event listener` warning in a real
       browser drag (jsdom does not reproduce passive-listener behavior — must verify live per
       this project's real-browser-for-pointer-fixes rule)
4. [ ] Relevant test set green (frontend unit + the responsiveness/E2E touch-drag coverage this
       file already has)

### Progress Log

**2026-08-20**: Found via a user-supplied browser log after a live Framing export test.
Root-caused via grep against the existing T5640 precedent in the same file. Fixed directly, no
branch (small, single-file, interactive session).

## Acceptance Criteria

- [ ] No `Unable to preventDefault inside passive event listener invocation` warning when
      dragging the crop box or a resize handle on a touch device
- [ ] Crop drag / resize behavior is unchanged on mouse and touch (verified live in a real
      browser, not just unit tests)
