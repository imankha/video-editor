# T6040: A corner-resize drag can exit circle-edit in mobile fullscreen

**Status:** TODO
**Impact:** 5
**Complexity:** 1
**Created:** 2026-07-27
**Found by:** T6000 (merged 2026-07-27) while adding real-browser corner-drag coverage

## The defect

`HighlightOverlay.jsx` swallows the synthetic click on the ellipse **body** so a tap-to-toggle
never also reaches the video's tap-nav:

```js
const stopClick = (e) => e.stopPropagation();               // :204
const bodyPointerProps = editable ? {
  onPointerDown: handleEllipsePointerDown,
  onClick: tapToToggle ? stopClick : undefined,             // :339
} : { className: 'pointer-events-none' };
```

The four **corner handles** do not:

```js
<circle
  data-testid={`highlight-corner-${c.id}`}                  // :587
  onPointerDown={(e) => handleResizePointerDown(e, c.id)}   // :588  <-- no onClick
/>
```

`OverlayModeView.jsx:628` binds `onClick={mobileFs ? handleVideoAreaTap : undefined}`, so in
**mobile fullscreen** a click bubbling out of a corner handle reaches `handleVideoAreaTap` and
**dismisses circle-edit mode right after the user finishes resizing**.

## Blast radius — read before deciding this is urgent

Narrow, and that is why it is Impact 5 rather than 8. A real **touch** drag does not synthesize a
click, so typical phones are unaffected. It bites where a pointer drag DOES synthesize a trailing
click: desktop browsers in mobile-fullscreen layout, device-emulation, and input stacks that
synthesize compatibility mouse events. Verify the exact set yourself rather than trusting this
sentence — the fix is trivial, but the *test* has to reproduce the real path or it proves nothing.

## What to do

1. **Reproduce first, in a real browser.** A test that has never been seen to fail proves nothing
   here. Drive `/overlaydiag-t5610` (or the mobileFs path in the app) and show edit mode being
   lost after a corner drag. jsdom is explicitly insufficient for this class — T5390's first
   attempt passed jsdom and failed on real touch.
2. Fix by giving the corner handles the same click-swallow the body already has. Match the body's
   existing conditional shape rather than inventing a new one — if the body only swallows when
   `tapToToggle`, understand why before copying or diverging, and say which you chose.
3. **Check the move lever too.** `:535` already has `onClick={stopClick}`. Confirm every
   interactive child of the overlay that starts a drag either swallows its trailing click or has
   a stated reason not to. Do not blanket-add — state the per-element reasoning.

## Watch out for

- This is a hot pointer path. A stray `stopPropagation` can break tap-to-dismiss, tap-nav, or the
  tracking-layer pass-through (`pointer-events-none` when not editable). Re-run the whole T5610
  suite, not just your new test.
- `public/overlaydiag-sample.mp4` is created in `beforeAll` and deleted in `afterAll`, SHARED with
  T5450/T5643, safe only because `workers: 1`. Do not add a second lifecycle.
- These specs are `dev-harness` registered (T5980): relative paths + `skipOnDeployedTarget`. Keep
  that; do not re-hardcode `http://localhost:5173`.
- Pre-existing failures in this family, present on master — report before/after so yours are
  distinguishable and do NOT claim them fixed: `T5610` test 3 (both pointer contexts) and the
  `T5450` loop-button test, all playback/autoplay flakes.

## Acceptance criteria

1. A real-browser test that FAILS on master (edit mode lost after a corner drag) and passes after
   the fix, with both runs shown.
2. The fix, with a per-element note on which overlay children swallow their trailing click and why.
3. Full `T5610` suite re-run, before/after counts stated, no new failures.
4. Deployed-target run still skips correctly (T5980's convention not regressed).
