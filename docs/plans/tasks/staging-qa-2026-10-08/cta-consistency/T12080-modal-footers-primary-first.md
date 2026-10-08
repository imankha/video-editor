# T12080: Modal footers: primary first, one colour

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q2,Q18 (see [decision register](../README.md#decision-register)). Implement the option the user ruled; the text below states the recommended option.

## Problem

Six modal footers use justify-end with Cancel then a purple Share: ShareModal.jsx:360-380 (qa-35), CollectionShareModal.jsx:232-235, ShareWithTeammatesModal.jsx:335, SharePlaybackDialog.jsx:135, ShareGameModal.jsx:168 and :476. The user's principle is main CTA first, which for modals reverses the usual convention.

## Solution

Per decision Q18 (apply the principle to modals?) and Q2 (colour): footer becomes CtaBar layout=modal, primary first and leftmost on desktop, full width and on top on mobile; Cancel/Done is the exit; no backdrop close (house rule). If Q2 repoints Button variant=primary app-wide (23 call sites), do it here or in T12010.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ShareModal.jsx`
- `src/frontend/src/components/CollectionShareModal.jsx`
- `src/frontend/src/components/ShareWithTeammatesModal.jsx`
- `src/frontend/src/components/SharePlaybackDialog.jsx`
- `src/frontend/src/components/ShareGameModal.jsx`
- `src/frontend/src/components/shared/Button.jsx`

### Related Tasks

- T12010. Decisions Q2, Q18. Touches the same files as T12210 (copy); run sequentially.

### Test first (red before green)

Spec: share modal footer's first cta-role is primary (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12080:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] All six footers: primary first, one colour
- [ ] Share modal added to cta-consistency.spec.js
- [ ] Relevant tests pass and lint is clean
