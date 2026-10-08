# T12030: Overlay bar on CtaBar: Add text inside the bar, nothing collides

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

OverlayModeView.jsx:1336-1375 uses flex-col-reverse sm:flex-row: on desktop 'Add text' is a separate sm:w-52 cell far left and Generate sits centred in the remaining flex-1 (qa-23, B3b). The hidden lg:flex metadata row ('810x1440 0:03 30 fps', :1382-1398) renders after the sticky band and collides with it. The bar covers the bottom of the video and Overlay's play controls and timeline fall below the fold while the guide says 'Press Play spotlight' (qa-28).

## Solution

Thread the Add text card into the band as a secondary (ExportButtonView actionsAbove / CtaBar secondary), delete the w-52 cell, keep the overlay-add-text-button testid and FloatingCoach target; Generate highlight is primary and first (label 'Generate highlight', drop 'with overlay' per the vocabulary table); move the metadata row above the bar or drop it at lg; apply the same --cta-bar-h stage cap as T12020 so controls stay above the bar.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/components/ExportButtonView.jsx`

### Related Tasks

- T12010, T12020.

### Test first (red before green)

Playwright rect test: Add text card and Generate share the bar and do not intersect the metadata row (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12030:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Add text and Generate are one centred row with Generate first
- [ ] No collision with the metadata row
- [ ] The video bottom edge and the Play spotlight control sit above the bar's top edge
- [ ] Overlay added to cta-consistency.spec.js
- [ ] Relevant tests pass and lint is clean
