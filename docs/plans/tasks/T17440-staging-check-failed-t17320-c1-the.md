# T17440: Staging check failed: T17320:C1 The steps above give the expected result.

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #826 merged (group g-t17290-4, 856db5712). Impact and complexity are unscored defaults.

**Steps:** After PR #826 merged (856db5712), run `npx playwright test e2e/checks/T17320.check.spec.js --grep 'T17320:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** The steps above give the expected result.

**Actual:** fail: [31mTest timeout of 180000ms exceeded.[39m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
