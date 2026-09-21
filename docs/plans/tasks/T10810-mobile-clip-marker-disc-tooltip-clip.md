# T10810: Mobile Annotate plays track: full-size disc markers + tooltip hides off-screen; drop the side-panel Clip row

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Problem

Three items from the user's staging phone screenshots (2026-09-20), fixed inline in one branch.

1. **Tooltip shown while its play is off-screen.** With the mobile 3x zoom (T10780) the plays
   track scrolls. A selected play's tooltip (`28:42 | 2. boring clip`) stayed pinned at the
   left edge of the phone after the marker had scrolled out of the window (under the opaque
   lane-label column). Mechanism: the tooltip is portalled to `<body>` at the marker's
   `getBoundingClientRect()`, and a bounding rect ignores clipping, so a scrolled-out marker
   still reports a screen position. Same on desktop with zoom + scroll.
2. **Mobile markers were narrow pills.** `ClipRegionLayer` had an `sm:hidden` "fit all clips
   without overlap" bar (4-12px wide) that predates the mobile zoom. With the zoom there is
   room for the desktop rating disc; the user wants mobile to look like desktop: disc with the
   start..end span bar under it.
3. **Side-panel `Clip | Frame` row (desktop Clip Details) is redundant.** The strip under the
   video already carries the big Frame / Apply Spotlight / View Final CTA; the panel row was
   the same stage CTA a second time (its NO_PROJECT create half was already removed
   2026-09-20).

## Solution

- `ClipRegionLayer.jsx`: `visibleAnchorRect(el)` returns null when the marker's center is
  outside the horizontal viewport of the nearest `.timeline-scroll-container`; both anchor
  recompute paths (state effect + capture-phase scroll listener) use it. Deleted the mobile
  bar branch and its width formula; the rating disc renders on every viewport (the T10430
  span bar already did).
- `ClipDetailsEditor.jsx`: removed the stage/open-project row, `handleOpenStage`, the
  `getClipStage` derivation and the `onOpenInFocus` / `onOpenInOverlay` / `onAwaitWrites`
  props; `ClipsSidePanel.jsx` and `AnnotateScreen.jsx` stop threading them. The strip CTA
  (`AnnotateFullscreenOverlay`) still uses `getClipStage`, which keeps its own tests.

## Evidence

- Unit: 3 new tests in `ClipRegionLayer.tooltipReposition.test.jsx` (in-view renders; left
  and right out-of-view hide). Red on master (2 failed), green with the fix.
- Real browser (393x852, touch, dev fixture account, 62-play game):
  `e2e/T10810-mobile-marker-disc.qa.spec.js`: disc >= 20px with span bar; select a marker
  in view -> tooltip; drag the touch scrollbar to the far end -> marker out of view, tooltip
  gone; drag back -> tooltip returns. Passed.
- Deleted tests that existed only for the removed row: `ClipDetailsEditor.reel.test.jsx`,
  `ClipsSidePanel.focusButton.test.jsx`. Stage logic coverage stays in `clipStage.test.js`.

## Related
- T10780 (mobile zoom, root of 1 and 2), T10430 (span bar), T6400 (portalled tooltip),
  T10510 (scroll re-anchor), T9330 (getClipStage), T10820 (mobile settings drawer, same sweep).
