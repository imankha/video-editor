# T17810: Staging check failed: T17780:C1 C1: A browser check at the stated real-touch sizes confirms

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-19
**Updated:** 2026-11-19

## Problem

Found by the staging check after PR #840 merged (group g-t17780-3, 7f0328136). Impact and complexity are unscored defaults.

**Steps:** After PR #840 merged (7f0328136), run `npx playwright test e2e/checks/T17780.check.spec.js --grep 'T17780:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: A browser check at the stated real-touch sizes confirms every listed control is at least 44 x 44 pixels.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeEnabled[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
