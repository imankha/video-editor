# T12300: Guidance default: on until the first export

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q16 (see [decision register](../README.md#decision-register)). Implement the option the user ruled; the text below states the recommended option.

## Problem

Guidance is ON for everyone forever. The 2026-09-17 T7630 ruling said ON only until the first export. The toggle location is handled by T11950.

## Solution

Per decision Q16: recommended 'on until the first export, then off', derived read-only from 'has exported' and never written reactively (setting only changes through the user's toggle gesture); the user can always turn it back on.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/stores/settingsStore.js`
- `src/frontend/src/components/instructions/GuidanceToggle.jsx`

### Related Tasks

- Decision Q16. T11950.

### Test first (red before green)

Unit: derived default is on with zero exports and off after one (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12300:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] A user with a finished export starts with Guidance off unless they turned it on
- [ ] No reactive persistence write
- [ ] Relevant tests pass and lint is clean
