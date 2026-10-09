# T12090: Empty states and Finished card actions on the shared look

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

Clips empty state (qa-36): gray 'Go to Games' then green 'Upload highlight' with the colours inverted on the alternative (EmptyTabGuide.jsx:150-177); Games empty is a green Button success (:111-121). Finished card (JustPublishedCard.jsx:140-167): cyan Share, then icon-only Copy link and Download below 44px.

## Solution

One primary per empty state per Q2 (with a game present Go to Games is the main path, default D7), no green/gray inversion; Copy link and Download get labels (hidden sm:inline) and are 44px on coarse pointers; Share is the shared cyan primary.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/shared/EmptyTabGuide.jsx`
- `src/frontend/src/components/collections/JustPublishedCard.jsx`

### Related Tasks

- T12010. T12190 owns the PublishLinkFlow copy; T12220 owns Clips copy.

### Test first (red before green)

Unit: JustPublishedCard Copy link and Download have accessible visible labels (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12090:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] One primary per empty state, no colour inversion
- [ ] Copy link and Download labelled and 44px on touch
- [ ] Relevant tests pass and lint is clean
