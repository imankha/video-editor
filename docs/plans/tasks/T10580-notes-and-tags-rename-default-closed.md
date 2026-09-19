# T10580: "Rate and Tag" disclosure renamed "Notes and Tags", defaults closed everywhere

**Status:** STAGING
**Impact:** 2
**Complexity:** 1
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

User request: rename the "Rate and Tag" disclosure to "Notes and Tags", and default
it to closed. Both were real staleness/UX gaps left over from the rating-badge work:
T10520 moved rating out of this disclosure entirely (it now holds only sport-when-
unset/tags/notes), so "Rate and Tag" had been describing content that no longer
lived there. Its desktop-open-by-default behavior (T10290) existed specifically so
the rating control — back when it lived here — was visible without an extra tap;
with rating gone, there was no remaining reason to force it open.

## Solution

- `ANNOTATE.DETAILS` (`displayNames.js`): `'Rate and Tag'` -> `'Notes and Tags'`.
  This one constant drives the label everywhere it's used (strip header toggle,
  formBody toggle, `AddDetailsPopup`'s dialog `aria-label`), so no other source
  changes were needed for the rename.
- `detailsOpen` initial state (`AnnotateFullscreenOverlay.jsx`): `useState(!isMobile)`
  -> `useState(false)`. Now closed by default on every layout, not just mobile.

## Context

### Relevant Files
- `src/frontend/src/config/displayNames.js` - `ANNOTATE.DETAILS`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - `detailsOpen` initial state
- Tests updated: `AnnotateFullscreenOverlay.details.test.jsx` (rewritten throughout),
  `.stripLayout.test.jsx`, `.keys.test.jsx` (3 tests), `.namePreservation.test.jsx`
  (2 tests), `.oneTap.test.jsx` (1 test) — every test that asserted the old
  "Rate and Tag" text or relied on the disclosure being open by default on desktop
  without an explicit click.

### Related Tasks
- Follow-up to T10520 (rating moved out of this disclosure).

## Implementation

### Steps
1. [x] Rename `ANNOTATE.DETAILS`
2. [x] `detailsOpen` defaults to `false` unconditionally
3. [x] Update every test asserting the old label or the old default-open desktop behavior
4. [x] Live-drive verified (screenshot: label reads "Notes and Tags", starts
       collapsed, opens on click)

### Progress Log

**2026-09-19**: Found via `vitest related` that this label rename + default-state
flip broke 8 tests across 5 files beyond the two with literal "Rate and Tag" text —
several asserted Notes/sport-prompt content was visible WITHOUT first clicking
`add-details-button`, relying on the old desktop-open-by-default. All rewritten (not
skipped) to open the disclosure explicitly first where the test's actual point
wasn't about the default-open state itself. Targeted run (6 files touching this
behavior) 63/63 green; full `vitest related` sweep on both changed source files also
exit 0. Lint clean. Live-drive verified in the real app.

## Acceptance Criteria

- [x] The disclosure toggle reads "Notes and Tags" (and the count suffix / mobile
      popup dialog name follow automatically, same constant)
- [x] The disclosure starts closed on every layout (desktop strip, desktop formBody,
      mobile)
- [x] Tests pass; live-verified
