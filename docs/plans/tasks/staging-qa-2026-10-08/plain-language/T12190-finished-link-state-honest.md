# T12190: Finished result: 'Link ready' only when there is a link

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

PublishLinkFlow.jsx:83-95 shows LINK_READY while shareUrl is null, so LinkReadyCard.jsx:33-44 renders 'Get Link' (inline string) under 'Link ready' (qa-32): the heading contradicts the button. (Labels for the icon-only Copy link/Download are owned by T12090.)

## Solution

Show the 'Link ready' heading only when shareUrl exists; otherwise heading 'Share this highlight' and a button 'Create share link' (RESULT_PUBLISH.REVIEW_CONFIRM); remove the literal 'Get Link'.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/PublishLinkFlow.jsx`
- `src/frontend/src/components/LinkReadyCard.jsx`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- After T12110.

### Test first (red before green)

Unit: PublishLinkFlow with null shareUrl does not render 'Link ready' (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12190:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] 'Link ready' only with a URL
- [ ] No 'Get Link' literal
- [ ] Relevant tests pass and lint is clean
