# T12350: One classifier for the spotlight pick guide (resolver is the source)

**Status:** STAGING
**Impact:** 4
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** landmine found while doing T12340

## Problem

T12280 said the pick guide's message "comes from the resolver", but in production
`SpotlightPickGuide` chose its body from `phase` and a private `dragHintOpen` flag; the
`overlay.pick.*` resolver rules were only called from tests. Two classifiers drift. Concretely,
the component closed its "not outlined" hint on every step change (`useEffect(..., [step])`) while
the parent's `showPlayerBoxes` stayed off, so the hint and the boxes disagreed. T12340 added a box
pulse that reads the resolver, which made the split visible.

## Solution

- `resolvePickGuide(...)` in `resolveGuide.js` is the one call; the pulse and the component both use it.
- The component renders by the resolver's state id (`data-guide-id`); `boxed` (the parent's
  `showPlayerBoxes`) is the single source for the not-outlined state. Omitting `boxed` keeps the
  standalone harness behavior.

Left as is on purpose: the step pill wording for first / next / at-marker is still composed from
`EDITOR_PANELS.PICK_GUIDE_*` (a structured pill with step count and progress dots), not from the
single-string `GUIDE.overlay.pick.*` copy. Unifying that copy is a separate wording decision.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/modes/overlay/components/SpotlightPickGuide.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/modes/overlay/components/SpotlightPickGuide.t12350.test.jsx`

### Related Tasks

- Follows: T12280, T12340.

## Acceptance Criteria

- [x] The component's state id equals the resolver's for every pick state (test)
- [x] The not-outlined hint follows the parent's box visibility, including across a step change (test)
- [x] The pulse and the guide use the same `resolvePickGuide` call
- [ ] The pick pill wording is one copy (open, see Solution)
