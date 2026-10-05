# T11905: `overlayDraft.js` e2e helper permanently skips in every environment

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-10-04
**Decision gate:** none (test infra bug fix)

## Problem

Found by T11740's reviewer while adding an Overlay case to a new e2e spec: the shared helper
`src/frontend/e2e/helpers/overlayDraft.js:95` looks for a filter chip with text matching
`/^In Spotlight \(\d+\)$/`, but `ProjectManager.jsx`'s Phase filter chip actually renders
`{ value: 'overlay', label: 'In Overlay' }` — visible text "In Overlay (N)". T9320 (`b049ddee2`,
2026-09-10) renamed the helper's regex from "In Overlay" to "In Spotlight" during a copy pass
but never updated the actual chip label, so the helper has returned `ok:false` ("filter is
absent in the UI") in EVERY environment, including staging, since that commit — not just in a
missing-fixture-data sense; the selector itself can never match.

This silently turns every caller into a permanent skip, not a real pass:
- `bug38`
- `T4550`
- `T5676`
- `T6510`
- `T9270` (both specs)
- `T10310`
- `T10820`
- `T11740`

Branch CI never runs Playwright, so none of this has been visible in CI — only live local runs
would show the skip, and apparently none were scrutinized closely enough to catch it (each
caller likely assumed "no loadable draft in this environment" rather than "the selector itself
is broken").

## Solution

Either:
- Revert the helper's regex to match "In Overlay" (if "In Overlay" is the correct, current
  chip label — confirm against `ProjectManager.jsx`'s current filter definitions before
  changing), or
- Rename the chip label to "In Spotlight" if that's actually the intended current vocabulary
  (check against the milestone's "Spotlight" vs "Overlay" terminology decisions, e.g.
  `docs/plans/tasks/parent-usability-audit/status-truth/T11790-one-status-ladder.md`, since
  renaming the chip could itself belong to that status-ladder sweep rather than here).

Whichever direction, re-run every listed caller locally once fixed and confirm each now
actually exercises its Overlay-dependent assertions instead of skipping.

## Relevant Files

- `src/frontend/e2e/helpers/overlayDraft.js:95`
- `src/frontend/src/components/ProjectManager.jsx` (Phase filter chip definitions)
- Callers: `bug38*.spec.js`, `T4550*.spec.js`, `T5676*.spec.js`, `T6510*.spec.js`,
  `T9270*.spec.js` (both), `T10310*.spec.js`, `T10820*.spec.js`,
  `T11740-editor-header-no-overflow.qa.spec.js`

## Acceptance Criteria

1. The helper's selector matches the real, current chip label.
2. Every listed caller, run locally, actually opens an Overlay draft rather than skipping (in
   an environment where one exists).

## Tests

Run each affected spec locally before and after the fix (Branch CI does not run Playwright).
