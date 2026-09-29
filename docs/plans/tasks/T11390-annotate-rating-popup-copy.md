# T11390: Clarify Annotate highlight and required-rating actions

**Status:** DONE
**Impact:** 5
**Complexity:** 1
**Created:** 2026-09-28
**Updated:** 2026-09-28
**Reported environment:** Production build 5870, Annotate

## Problem

The Highlight choice card calls its return action “Back to Editing,” even though the user is
returning to Annotate. The required-rating gate also offers a visible “Keep editing” action that
competes with the rating choice even though the gate's purpose is to require a rating before the
requested exit proceeds.

## Solution

- Rename the Highlight choice action to **Keep Annotating**.
- Remove the visible **Keep editing** button from the required-rating gate.
- Retain Escape as the keyboard-only way to return to the editor and retain the inert backdrop.

## Context

### Relevant Files

- `src/frontend/src/config/displayNames.js` — canonical Annotate copy.
- `src/frontend/src/modes/annotate/components/RateThisPlayModal.jsx` — required-rating gate.
- `src/frontend/src/modes/annotate/components/RateThisPlayModal.test.jsx` — gate behavior/copy.
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.highlightChoice.test.jsx` — Highlight choice copy/behavior.

### Related Tasks

- Related: T11400 (remove the post-rating wait without weakening persistence).
- Related: T11410 (keep the normal rating picker visible in fullscreen).

## Implementation

### Steps

1. [x] Add red tests for the new copy and removal of the competing button.
2. [x] Update the canonical copy and required-rating modal.
3. [x] Run the curated Annotate tests and lint.
4. [x] Commit the finished change.

### Progress Log

**2026-09-28:** Started from the production screenshots. The focused tests failed against the
pre-change source for exactly the two requested differences.

**2026-09-28:** Implementation complete. Curated result: 29/29 tests passed across the modal,
fullscreen Escape interaction, Highlight choice, and container gate flows. ESLint passed on every
changed frontend source/test file. Waiting only for landing/review disposition.

**2026-09-29:** Merged in PR #535 (`9933d20a`) after green Branch CI and deployed to production
as frontend build 5874. `app.reelballers.com` returned HTTP 200 after deployment.

## Acceptance Criteria

- [x] The Highlight choice card says **Keep Annotating**.
- [x] The required-rating gate has no visible **Keep editing** action.
- [x] The five rating choices remain available and selecting one still invokes `onPick`.
- [x] Backdrop clicks remain inert; Escape remains the keyboard-only return path.
- [x] Focused tests and lint pass.
