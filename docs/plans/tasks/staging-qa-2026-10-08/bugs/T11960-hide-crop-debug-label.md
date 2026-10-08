# T11960: Hide the crop debug label outside local dev

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 1: Bugs](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

CropOverlay.jsx:700 shows the WxH @ (x, y) debug label whenever versionInfo.environment !== 'production', so staging (the QA environment) shows '410x730 @ (867, 175)' to users while dragging the crop box (qa-16). It has been there since bd9ef200e.

## Solution

Gate it on import.meta.env.DEV. The separate 'too small for upscale' warning at line 712 stays.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/focus/overlays/CropOverlay.jsx`
- `src/frontend/e2e/T5674-overlap-overflow.qa.spec.js (runs on local dev, still sees the label)`

### Related Tasks

- None

### Test first (red before green)

Vitest with vi.stubEnv('DEV', false), environment staging, keyframe selected: assert the label is absent. Fails today.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T11960:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] With DEV false and environment 'staging', selecting a keyframe renders no '@ (' label
- [ ] Local dev still shows it
- [ ] Relevant tests pass and lint is clean
