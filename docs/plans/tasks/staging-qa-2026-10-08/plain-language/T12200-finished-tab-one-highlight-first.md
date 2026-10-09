# T12200: Finished tab: the user's highlight first, locked gauges demoted

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q11,Q17 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

The Finished tab leads with a locked 'Ranking Progress' gauge (ConfidenceBanner.jsx:83-114, rendered first at PublishedReelsPanel.jsx:781), then the highlight, then locked 'Top Plays' and 'Game Highlights' cards each at 3s/30s (SmartLockedCard.jsx:7, RatioUnlockGroup.jsx:9) (qa-34). 'Sort your highlights head-to-head' is jargon and the locked gauges outrank the one thing the parent just made.

## Solution

Per decision Q11. Recommended B: highlight card first, then one consolidated 'Unlocks as you make more' card (rounded-xl border border-gray-700 bg-gray-800/40 p-3) with three small chips (Trophy Ranking, Star Top Plays, Film Game Highlights, each with a Lock 12), one shared amber bar and '3s of 30s'; tapping opens the existing LockedReasonModal.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/collections/PublishedReelsPanel.jsx`
- `src/frontend/src/components/ranking/ConfidenceBanner.jsx`
- `src/frontend/src/components/collections/CollectionsTab.jsx`
- `src/frontend/src/components/collections/SmartLockedCard.jsx`
- `src/frontend/src/components/collections/RatioUnlockGroup.jsx`

### Related Tasks

- Decision Q11. Headline copy change needs Q17.

### Test first (red before green)

Unit: with one highlight the first rendered card is the highlight (fails today, the gauge is first).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12200:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] The first highlight is the first and only full-weight card
- [ ] Locked items per the ruling
- [ ] Relevant tests pass and lint is clean
