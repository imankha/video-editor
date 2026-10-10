# T12360: One copy for the spotlight pick pill wording

**Status:** WIP
**Impact:** 3
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** left open by [T12350](T12350-pick-guide-single-classifier.md)

**Decision RULED 2026-10-10: A** (pill copy wins; `GUIDE.overlay.pick` is the one copy and `EDITOR_PANELS.PICK_GUIDE_*` reads it).

## Problem

The pick pill's text exists twice and the copies differ. What users see is composed from
`EDITOR_PANELS.PICK_GUIDE_*` ("Tap your athlete" + "Moment 1 of 4" + "We'll show you a few moments so
the spotlight stays on them."). The resolver rules carry a second, single-string copy in
`GUIDE.overlay.pick.*` ("Tap your athlete. We'll show you a few moments ... (1 of {n})") that
production never renders. Done and the not-outlined hint already share one string; first, next,
at-marker and away do not. The two will drift again.

## Options for the user

- **A. Pill copy wins.** Rewrite `GUIDE.overlay.pick.first/next/atMarker/away` to match what the
  pill shows (title plus step) and have the pill read them, so `displayNames.js` holds one copy.
- **B. Resolver copy wins.** Change the pill to render the single-string messages, dropping the
  separate step label. Larger visible change (the step moves into the sentence).
- **C. Delete the unused resolver strings** for those four rules and keep the pill's copy, with the
  resolver returning ids and pulse only.

Recommendation: A. It keeps the UI users already tested and ends with one copy.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/config/displayNames.js` (`GUIDE.overlay.pick`, `EDITOR_PANELS.PICK_GUIDE_*`)
- `src/frontend/src/modes/overlay/components/SpotlightPickGuide.jsx`
- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/modes/overlay/components/SpotlightPickGuide.t12280.test.jsx`

### Related Tasks

- Follows: T12350 (the state id now comes from the resolver), T12280 (moment / athlete vocabulary).

## Acceptance Criteria

- [x] User ruled A, B or C (A)
- [x] Each pick state's visible text is defined in exactly one place
- [x] Banned-copy regex still passes (no tracker, box, frame N, em dash)
- [x] Relevant tests pass and lint is clean
