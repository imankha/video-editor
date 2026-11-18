# T17400: Staging check failed: T17250:C2 C2: Paying for a pack with the test card shows

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #824 merged (group g-t17070-4, 11f49c147). Impact and complexity are unscored defaults.

**Steps:** After PR #824 merged (11f49c147), run `npx playwright test e2e/checks/T17250.check.spec.js --grep 'T17250:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C2: Paying for a pack with the test card shows the credits-added message with the new balance, at 390x844 and 1440x900.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
