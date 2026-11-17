# T16710: Staging check failed: T16640:C2 C2: In Trim mode the Normal speed track is fully

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

Found by the staging check after PR #798 merged (group g-t16630-3, 27d192127). Impact and complexity are unscored defaults.

**Steps:** After PR #798 merged (27d192127), run `npx playwright test e2e/checks/T16640.check.spec.js --grep 'T16640:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C2: In Trim mode the Normal speed track is fully visible.

**Actual:** fail: Error: speed track fully visible

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
