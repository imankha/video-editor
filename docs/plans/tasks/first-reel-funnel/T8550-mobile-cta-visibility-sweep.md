# T8550: Mobile CTA visibility sweep (primary buttons above the fold)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source)

## Problem

User report 2026-09-03: export buttons sometimes sit below the scroll line. The
2026-09-02 walkthrough was desktop-first with only home/annotate mobile spot checks;
the export surfaces (Focus settings panel, Add Play sheet, Overlay controls) were not
audited at phone sizes. Prod context: 6 of 28 real users are mobile-only, and T8140
already found the clip form's Save below the fold once.

## The audit matrix

Widths x heights: 320x568 (iPhone SE1-class floor), 375x667, 390x844, 428x926.
Keyboard states where text inputs exist (Add Play name/notes, Add Game opponent):
keyboard closed AND open (simulate by asserting with the bottom ~40% of the viewport
treated as unavailable - Playwright cannot open a real soft keyboard; use the reduced
effective viewport as the assertion box and note it in the spec).

Surfaces + their primary CTAs (component refs verified):

| Surface | Primary CTA | Component |
|---|---|---|
| Add Game modal | submit "Add Game" + dropzone | `components/GameDetailsModal.jsx` (post-T8500 order) |
| Add Play sheet | "Save" | `modes/annotate/components/AnnotateFullscreenOverlay.jsx` (T8140 shipped a sticky Save - VERIFY it held, incl. with T8490's caption added) |
| Focus panel | "Export Focused Video" + its reason caption | `components/ExportButtonView.jsx` (post-T8510) |
| Export-complete choice | "Add Overlay" + "Skip - my reel is ready" | T8520's card |
| Ready board tile | "Publish to Highlight Reels" | `components/DraftTile.jsx` (post-T8530 label) |
| Reel player | "Share" | `components/collections/CollectionPlayer.jsx` (post-T8540) |
| Highlights tab (T8545: was a drawer) | "Create Highlight Reel" | `components/DownloadsPanel.jsx` |

## Existing tooling to build on (do not invent new harnesses)

- `src/frontend/e2e/screen-usability.spec.js` - the real-user usability matrix, with
  `screen-usability.selfcheck.spec.js` proving the audit is not vacuous (read its
  header comment). EXTEND this spec family; the CTA-visibility assertions belong here.
- `src/frontend/e2e/helpers/qa.js` line ~60 - existing viewport-loop helper
  (`page.setViewportSize` per vp in a list). Reuse its viewport list or extend it with
  the 4 widths above.
- Viewport declaration patterns in the suite: `test.use({ viewport: { width: 390,
  height: 844 } })` (collection-share.spec.js line 19), per-test
  `page.setViewportSize` (collections.spec.js line 70).
- Auth: `e2e/helpers/realAuth.js` (`loginAsRealUser`, `openGameInAnnotate`) for
  data-bearing surfaces; `POST /api/auth/test-login` for empty-account surfaces.

## The assertion helper

Add to `e2e/helpers/qa.js`:

```js
export async function assertCtaInViewport(page, locator, { keyboardOpen = false } = {}) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  const usableHeight = keyboardOpen ? Math.floor(vp.height * 0.6) : vp.height;
  expect(box, 'CTA not rendered').toBeTruthy();
  expect(box.y + box.height, 'CTA below the fold').toBeLessThanOrEqual(usableHeight);
  expect(box.y, 'CTA above the viewport').toBeGreaterThanOrEqual(0);
  expect(box.x >= 0 && box.x + box.width <= vp.width, 'CTA horizontally clipped').toBe(true);
}
```

"Without scrolling" means: assert immediately after the surface renders, before any
programmatic scroll.

## Fix policy (when an assertion fails)

Prefer pinning over squeezing, copying existing patterns:
1. Sticky action bar: the T8140 sticky-Save pattern in AnnotateFullscreenOverlay is
   the reference implementation - find its wrapper classes and reuse them (sticky
   bottom-0 + background + top border, safe-area padding).
2. Scrollable body + fixed footer for modals: body gets `overflow-y-auto` with the
   footer outside the scroll container (GameDetailsModal likely needs exactly this
   after T8500 adds the collapsed section).
3. Only as a last resort: shrink paddings/font at the narrow breakpoints per the
   responsiveness skill.
Never hide content to make room; never rely on the browser scrolling a focused input
into view as the "fix".

## Steps

1. [ ] Land AFTER T8500/T8510/T8520/T8530/T8540 (this task audits their surfaces) -
       it is deliberately last-but-one in the epic (T8560 follows)
2. [ ] Add `assertCtaInViewport` + the 4-viewport list to qa.js
3. [ ] Write `e2e/cta-visibility.spec.js` covering the 7-surface matrix (login via
       realAuth; drive to each surface; assert per viewport; keyboard-open variant for
       the two input surfaces)
4. [ ] Run headed at each width, screenshot each surface x width into the task folder
       (evidence per the workers-QA rule), fix failures per the policy above
5. [ ] Record the final matrix (surface x width -> pass) in this file's Progress Log;
       T7640 (tutorial screen-size matrix) reuses it

## Context

### Relevant Files (REQUIRED)
- `src/frontend/e2e/helpers/qa.js`, `e2e/screen-usability.spec.js` + selfcheck
- New: `src/frontend/e2e/cta-visibility.spec.js`
- Fix targets as found (expected: GameDetailsModal, ExportButtonView's panel container,
  DraftTile, CollectionPlayer toolbar)
- responsiveness skill (src/frontend/.claude/skills) - testing workflow reference

### Related Tasks
- Depends on: T8500, T8510, T8520, T8530, T8540 (their surfaces/labels)
- Feeds: T7640's screen-size matrix
- Real-browser rule: jsdom is banned for these fixes (real-browser-for-pointer-fixes
  memory); Playwright headed verification required

## Acceptance Criteria

- [ ] assertCtaInViewport helper exists and is used by a 7-surface x 4-width spec
- [ ] Every journey-primary CTA passes without scrolling at all four widths
- [ ] Keyboard-open variants pass for Add Play and Add Game
- [ ] Fixes follow the pinning policy (no hidden content, no squeezed-only fixes)
- [ ] Evidence screenshots + final matrix recorded in this file
