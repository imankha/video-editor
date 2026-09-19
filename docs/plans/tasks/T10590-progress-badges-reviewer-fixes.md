# T10590: Fresh Reviewer pass on the play-progress-badges feature (T10410-T10580) + fixes

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

User asked to "review the diff and then merge" for the whole play-progress-badges body of
work (T10410 through T10580 — badges, rating popup, mobile bottom sheet, bigger discs,
Notes-and-Tags rename), all committed directly to master across this session with no
open branch/PR. Per CLAUDE.md's M-tier pipeline, this needed a fresh-context Reviewer
pass before the work could be called done.

## Solution

Spawned a fresh-context `reviewer` subagent against the full diff. It returned 1 BLOCKING,
3 MAJOR, and 2 MINOR-groups of findings — all real, none false positives. Fixed all of them
in `PlayProgressBadges.jsx` and `AnnotateFullscreenOverlay.jsx`, updated/added tests, fixed
a stale `.claude/knowledge/annotate.md` doc section, then re-verified with the full related
test sweep, lint, and a live Playwright pass at both mobile (390×844) and desktop (1440×900)
viewports.

## Findings and fixes

1. **BLOCKING — Escape key double-handled, discarding the whole editor.** `RatingBadge`'s
   own `document`-level Escape listener didn't call `stopPropagation()`, so pressing Escape
   while the rating picker was open ALSO reached `AnnotateFullscreenOverlay`'s `window`-level
   Escape handler and closed/discarded the entire unsaved play. Fixed by adding
   `e.stopPropagation()` before `setOpen(false)` (bubble order: `document` listeners fire
   before `window` listeners for the same event). New regression test in
   `AnnotateFullscreenOverlay.keys.test.jsx` — critically, dispatched via
   `fireEvent.keyDown(document, ...)`, not `window` (jsdom's `fireEvent` on `window` skips
   `document`-level `addEventListener` listeners entirely, so the bug was untestable with
   every other test in that file's convention).

2. **MAJOR — Mobile/desktop split used the wrong breakpoint.** The rating popup used
   Tailwind's `max-sm:`/`sm:` (640px) to decide bottom-sheet vs. dropdown, but the app's
   real mobile detection is `useIsMobile()` (max-width 1023px OR coarse pointer) — a
   640-1023px window, or any touch tablet, would get the desktop dropdown rendered inside
   an already-mobile editor, clipping off-screen. Fixed by threading a real `isMobile`
   boolean prop down (`AnnotateFullscreenOverlay` → `PlayProgressBadges` → `RatingBadge`,
   keyed off the same `useIsMobile()` instance the parent already owns) and replacing every
   CSS-breakpoint class with a JS ternary on that prop.

3. **MAJOR — Mobile sheet's backdrop closed on tap, violating the project's standing
   no-backdrop-close rule** (documented in `AddDetailsPopup.jsx` and user memory
   `feedback_no_backdrop_close`). Removed the backdrop's `onClick`; added an explicit `X`
   close button in the sheet's header (new `lucide-react` `X` import).

4. **MAJOR — `RatingBadge` not keyed on clip identity.** Its `open` popup state could
   survive across a real clip switch (stale heading/rows shown for the wrong play), because
   `AnnotateFullscreenOverlay` re-mounts on genuinely new clips only if something forces it
   to. Added `key={existingClip?.id ?? 'create'}` on the `<PlayProgressBadges>` element —
   remounts (resetting `open`) on a real id change, stays mounted (preserving `open`) across
   the same-play identity churn a surgical update causes (region objects get new references
   on every write, same id).

5. **MINOR-group — accessibility.** `aria-live="polite"` was on the whole 4-badge row,
   causing screen readers to re-announce all 5 rating-popup rows every time it opened
   (scoped down to just the clip badge's own label span, the only badge that ever changes
   its visible label). Duplicate announcement: a visible heading `<div>` AND a separate
   `aria-label` on the radiogroup said the same string twice (added `useId()`-based
   `aria-labelledby` instead). `aria-haspopup="true"` (resolves to `menu` semantics) changed
   to `aria-haspopup="dialog"` (what the control actually opens).

## Self-caught issues (during my own fix verification, not from the Reviewer)

- The `key` fix (finding 4) broke a pre-existing test that relied on the popup staying open
  across a rerender with a DIFFERENT clip id while asserting the heading text updated live.
  Split into two tests: one for the same-clip/layer-toggle-flip case (popup stays open,
  correct), one new test locking in that a genuine clip switch now closes the popup.
- My first version of that new test used `screen.queryByRole('radiogroup')` unscoped, which
  collided with the page's OTHER `role="radiogroup"` (`LayerSegmentedControl`'s "Play
  category" toggle, which stays mounted through the clip switch). Switched to
  `screen.queryByTestId('rating-picker')` to scope precisely to the rating popup's own
  container.
- Also fixed two pre-existing test-quality issues the Reviewer flagged in the same files:
  a vacuous "DetailsFields no longer carries a duplicate Rating row" test that never
  actually opened the details disclosure (stale from before T10580 flipped the default to
  closed), and inverted comments in `layer.test.jsx` left over from the same default flip.

## Verification

- Targeted: 3 directly-modified test files, 46/46 tests green.
- Broad: `npx vitest related --run` across `PlayProgressBadges.jsx` +
  `AnnotateFullscreenOverlay.jsx` — full related set green (only pre-existing, unrelated
  `act()` warnings in stderr, no failures).
- Lint: 0 errors on the 5 changed source/test files (3 pre-existing unrelated warnings).
- Live-drive (Playwright, real browser, real account imankh@gmail.com, real clip "adf"):
  - 390×844: bottom sheet renders with the bold heading ("Rate your athlete's play"),
    grabber bar, and glyph-annotated rows; a `mousedown`/`click` dispatched at the
    backdrop's top-left corner (clearly outside the sheet) leaves the picker open;
    clicking the `X` closes it.
  - Escape while the picker is open closes the picker only — the "Edit play" heading
    (i.e. the whole editor) is still present afterward, confirming the BLOCKING fix live.
  - 1440×900: the rated badge opens the anchored desktop dropdown (not a fixed sheet),
    correctly positioned below the badge.

## Relevant Files

- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.progressBadges.test.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.keys.test.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.layer.test.jsx`
- `.claude/knowledge/annotate.md`

## Acceptance Criteria

- [x] Fresh-context Reviewer findings all addressed (1 BLOCKING, 3 MAJOR, 2 MINOR-groups)
- [x] Full related test sweep green
- [x] Lint clean
- [x] Live-browser verification at mobile and desktop viewports
