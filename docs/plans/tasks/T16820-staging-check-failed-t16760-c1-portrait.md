# T16820: Staging check failed: T16760:C1 Portrait preview and its controls fully visible above the action

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

Found by the staging check after PR #806 merged (group g-t16750-2, 3e14ab3a3). Impact and complexity are unscored defaults.

**Steps:** After PR #806 merged (3e14ab3a3), run `npx playwright test e2e/checks/T16760.check.spec.js --grep 'T16760:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** Portrait preview and its controls fully visible above the action bar at 1440x900 and 1366x768 (browser check on bounding boxes).

**Actual:** fail: [31mTest timeout of 300000ms exceeded.[39m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
