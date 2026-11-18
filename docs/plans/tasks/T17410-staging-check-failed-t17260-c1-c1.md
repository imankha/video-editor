# T17410: Staging check failed: T17260:C1 C1: The Add profile window and the profile list both

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #824 merged (group g-t17070-4, 11f49c147). Impact and complexity are unscored defaults.

**Steps:** After PR #824 merged (11f49c147), run `npx playwright test e2e/checks/T17260.check.spec.js --grep 'T17260:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: The Add profile window and the profile list both say a profile is for each athlete, sport and season.

**Actual:** fail: TimeoutError: locator.click: Timeout 60000ms exceeded.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
