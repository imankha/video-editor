# T12310: Re-run the first-time walkthrough on staging (milestone close)

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Milestone close](README.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

The milestone must prove the walkthrough that produced it now passes.

## Solution

Repeat the 2026-10-08 Playwright walkthrough on staging with a blank account and the same game video; for every finding in findings.md capture a screenshot showing it fixed (or file a follow-up). Check: no overlapping floating elements, main CTA first on every screen, a guide on every state in the guide table, no jargon from the findings list.

## Context

### Relevant Files (REQUIRED)

- `docs/plans/ux/2026-10-08-staging-qa-walkthrough/findings.md`

### Related Tasks

- All other tasks in the milestone.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12310:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Every finding B1-B8 and every guide row has a before/after screenshot or a filed follow-up
- [ ] Journey from blank account to finished highlight completes at 1440 and 390 widths
- [ ] Relevant tests pass and lint is clean
