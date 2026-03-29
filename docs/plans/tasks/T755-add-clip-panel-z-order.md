# T755: Add Clip Panel Z-Order Fix

**Status:** DONE
**Impact:** 6
**Complexity:** 4
**Created:** 2026-03-28
**Updated:** 2026-03-28

## Problem

The "Add Clip" panel (`AnnotateFullscreenOverlay`) renders inside the video player container but the `<video>` element paints on top of it due to hardware-accelerated GPU compositing. The panel is interactive (click events work via `elementFromPoint`) but visually obscured by the video at the overlap edge.

### What we tried (and why it failed)

1. **z-index on sidebar wrapper** (`z-20` on sidebar, `z-0` on main content) — Wrong element. The panel isn't in the sidebar; it's an overlay inside the VideoPlayer's `video-container`.

2. **z-index on video transform wrapper** (`z-0` class) — Didn't help. The `<video>` element's GPU compositing layer ignores CSS z-index of sibling elements within the same container.

3. **`transform: translateZ(0)`** on overlay — Attempted to promote the overlay to its own GPU layer. No effect — Chromium still composites `<video>` on top.

4. **`will-change: transform`** on overlay panel — Same approach, same result.

5. **`visibility: hidden` on video when overlay shown** — Successfully hid the video, but the user rejected this because it completely removes the video (user wants to see the video behind the panel, or at least not have it disappear entirely). **UPDATE: Actually this was reverted because it "completely broke" the view — need to investigate why.**

### Root cause

`<video>` elements with hardware acceleration are composited on a separate GPU layer by Chromium. This layer paints above CSS-positioned siblings regardless of z-index, because GPU compositing happens after the CSS paint phase. This is a well-known browser behavior, not a CSS bug.

### Key diagnostic findings

- `elementFromPoint` at the overlap zone returns the panel (not the video) — the DOM hit-testing is correct
- The video transform wrapper has `transform: translate(...)` which creates a stacking context
- The overlay is `absolute inset-0 z-50` — correct CSS, just ignored by GPU compositor
- The `video-container` has `overflow-hidden` — clips content but doesn't affect compositing

## Solution

The panel should act as a **full overlay on top of everything**, not as a child of the video container. Several approaches to evaluate:

### Approach A: Portal the overlay outside the video container

Move `AnnotateFullscreenOverlay` out of the VideoPlayer's `overlays` prop and render it as a sibling or portal at a higher level in the DOM tree (e.g., at the AnnotateScreen level or via React Portal to `document.body`). This completely avoids the GPU compositing conflict.

**Pros:** Clean separation, no GPU hacks, overlay can be positioned anywhere
**Cons:** Need to pass through coordinates/sizing, may need to recalculate position relative to video area

### Approach B: Render overlay outside VideoPlayer but inside AnnotateModeView

Instead of passing the overlay via `VideoPlayer`'s `overlays` prop, render it as a sibling AFTER the VideoPlayer in `AnnotateModeView`. Position it absolutely relative to the video container's parent (which has `position: relative`). Since it's not a child of the `video-container` div, it won't compete with the `<video>` element's GPU layer.

```jsx
{/* In AnnotateModeView, AFTER <VideoPlayer> */}
{showAnnotateOverlay && (
  <div className="absolute inset-0 z-50 ...">
    <AnnotateFullscreenOverlay ... />
  </div>
)}
```

**Pros:** Minimal refactor, overlay stays visually positioned over video area, no portal complexity
**Cons:** Must ensure the parent container is `position: relative` and properly sized

### Approach C: CSS `contain` or `isolation` on video wrapper

Use `contain: strict` or `isolation: isolate` on the video transform wrapper to force the browser to treat it as a flat compositing layer. This may prevent the `<video>` from escaping its stacking context.

**Pros:** Minimal code change
**Cons:** May not work in all browsers, `contain: strict` can have side effects on layout

### Recommended: Approach B

Approach B is the simplest — just move where `AnnotateFullscreenOverlay` is rendered. It stays in the same visual position but is no longer a DOM child of the video container, so GPU compositing of `<video>` can't paint over it.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` — passes overlay via `VideoPlayer` `overlays` prop (lines 364-381); should render it as a sibling instead
- `src/frontend/src/components/VideoPlayer.jsx` — renders overlays inside `video-container` (line 235); overlay needs to move out
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — the "Add Clip" / "Edit Clip" panel (line 259); currently `absolute inset-0 z-50`
- `src/frontend/src/screens/AnnotateScreen.jsx` — parent layout (alternative portal target)

### Diagnostic data (from Playwright investigation)
- Video container bounds: left=451, right=1905 (1454px wide)
- Overlay panel bounds: left=467, right=915 (448px wide, `max-w-md`)
- Video element bounds: left=557, right=1798
- Overlap zone: 557-915 (video paints over panel in this region)
- `elementFromPoint` in overlap zone returns panel (DOM is correct, paint order is wrong)

### Related Tasks
- Investigated during T415 implementation

## Acceptance Criteria

- [ ] Add Clip panel renders fully visible on top of the video
- [ ] Video is still visible (not hidden) while panel is open
- [ ] Panel is interactive (clicks, keyboard input work)
- [ ] Fullscreen annotate mode still works correctly
- [ ] No visual regression in normal annotation mode (no overlay shown)
- [ ] Mobile sidebar overlay still works correctly
