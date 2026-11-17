# T16800: Staging check failed: T16730:C1 The steps above give the expected result.

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

Found by the staging check after PR #803 merged (group g-t16730-1, 788b8f73e). Impact and complexity are unscored defaults.

**Steps:** After PR #803 merged (788b8f73e), run `npx playwright test e2e/checks/T16730.check.spec.js --grep 'T16730:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** The steps above give the expected result.

**Actual:** fail: TimeoutError: locator.waitFor: Timeout 480000ms exceeded.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
