# T12370: Repoint e2e specs from annotate-primary-cta to annotate-mark-play-button

**Status:** STAGING (PR #591 merged)
**Impact:** 6
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Milestone:** [Staging QA Walkthrough](staging-qa-2026-10-08/README.md) (runs BEFORE T12310)
**Found by:** [T12320](T12320-restore-frontend-unit-tests-green.md) item 1

## Problem

After the CTA/guidance unification (3662653a0, 31b50fab5), `[data-testid="annotate-primary-cta"]` is only the Edit play button. The Mark/Add play button is `annotate-mark-play-button`. 24 uses across 13 Playwright specs still target the old id for the Mark/Add button, so they click the wrong element or time out. Branch CI never runs Playwright, so nobody has seen these fail.

## Solution

For each use, decide whether it means Mark/Add play (change to `annotate-mark-play-button`) or Edit play (leave). Then run the 13 specs against a real dev stack and fix anything else that drifted.

## Context

### Relevant Files (REQUIRED)

Under `src/frontend/e2e/`: clip-selection-state-machine, cta-visibility, T10710, T10800, T11110, T11150, T8490, T8600, T8760, T8900, T8960, T9480, T9580.

### Related Tasks

- Source: T12320 item 1. Should land before T12310 so the walkthrough starts from known-good specs.
- Refactoring rule 7: grep `e2e/` and `scripts/`, not just `src/`.

## Implementation

### Steps

1. [ ] Grep every `annotate-primary-cta` use in `src/frontend/e2e/`; classify Mark/Add vs Edit
2. [ ] Repoint the Mark/Add uses
3. [ ] Run the 13 specs with a real Playwright run (dev stack, see drive-app-as-user); fix other drift found
4. [ ] Commit with subject starting `T12370:`

## Acceptance Criteria

- [ ] No e2e spec uses `annotate-primary-cta` for the Mark/Add button
- [ ] The 13 specs pass in a real Playwright run (raw log kept), or each remaining failure is filed
