# T16570: Staging check failed: T10990:C1 Switching portrait and landscape sends exactly one request.

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-15
**Updated:** 2026-11-15

## Problem

Found by the staging check after PR #773 merged (group g-t16480-4, 19c67ed4c). Impact and complexity are unscored defaults.

**Steps:** After PR #773 merged (19c67ed4c), run `npx playwright test e2e/checks/T10990.check.spec.js --grep 'T10990:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** Switching portrait and landscape sends exactly one request.

**Actual:** fail: [31mTest timeout of 240000ms exceeded.[39m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
