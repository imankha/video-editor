# T16450: Staging check failed: T16210:C1 C1: Each of the eleven listed controls measures at least

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-14
**Updated:** 2026-11-14

## Problem

Found by the staging check after PR #755 merged (group g-t16210-3, 8a2e461ab). Impact and complexity are unscored defaults.

**Steps:** After PR #755 merged (8a2e461ab), run `npx playwright test e2e/checks/T16210.check.spec.js --grep 'T16210:C1'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: Each of the eleven listed controls measures at least 44x44 px on iPhone 14 and iPad, proven by a browser check that reaches it as a parent would.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
