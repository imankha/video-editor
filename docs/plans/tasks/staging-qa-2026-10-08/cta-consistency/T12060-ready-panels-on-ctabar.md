# T12060: Both 'Your highlight is ready' panels on one CtaBar panel

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

FocusPublishActionBar.jsx:190-228 and OverlayPublishActionBar.jsx:179-210 duplicate about 170 lines of tile code. The exit is a bordered button on the Focus panel ('Done for now', :219-227) and a plain ghost link on the Overlay panel (:207). Icon disc sizes differ by variant (h-14 vs h-12 at lg) so icons and titles sit at different heights (qa-22, qa-30). The panel also overlaps the bottom of the portrait video.

## Solution

Both render CtaBar layout=panel: primary first, one exit style (ghost), equal disc size; delete the two Tile copies; keep the T8390 minmax(min-content,1fr) no-overflow invariant, data-tutorial-target='focus-publish' and T11810 copy; panel never overlaps the video.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/FocusPublishActionBar.jsx`
- `src/frontend/src/components/OverlayPublishActionBar.jsx`
- `their tests`

### Related Tasks

- T12010.

### Test first (red before green)

Spec: both panels' first cta-role is primary and exit style matches (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12060:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] One exit style on both panels
- [ ] Icons and titles align across tiles
- [ ] Both panels added to cta-consistency.spec.js
- [ ] Net diff is mostly deletion
- [ ] Relevant tests pass and lint is clean
