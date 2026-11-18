# T17320: Staging check failed: T17090:C1 C1: Adding and switching to a second profile on an

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #820 merged (group g-t17080-4, 08a772d17). Impact and complexity are unscored defaults.

**Steps:** After PR #820 merged (08a772d17), run `npx playwright test e2e/checks/T17090.check.spec.js --grep 'T17090:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: Adding and switching to a second profile on an existing account shows no "free credits" bubble, at 1440x900.

**Actual:** fail: [31mTest timeout of 180000ms exceeded.[39m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
