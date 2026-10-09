# T12210: Share modal: 'Who can watch' with the default visible

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

ShareModal.jsx:216-235 (same toggle in CollectionShareModal.jsx:202): the switch 'Restricted to recipients' never says what the default is or what off means (qa-35).

## Solution

Replace the switch with a labelled two-option segmented control: label 'Who can watch'; buttons (flex-1 min-h-[40px] rounded-md text-sm, selected bg-blue-600 text-white) 'Only people I add' (Lock, default selected) and 'Anyone with the link' (Globe); helper line 'Only the people you add can watch.' (or RESULT_PUBLISH.REVIEW_BODY). Strings into displayNames.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ShareModal.jsx`
- `src/frontend/src/components/CollectionShareModal.jsx`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- Run after T12080 (same files).

### Test first (red before green)

Unit: ShareModal renders both options with 'Only people I add' selected (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12210:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Default visibly selected
- [ ] Both states have a helper line
- [ ] Same control in both modals
- [ ] Relevant tests pass and lint is clean
