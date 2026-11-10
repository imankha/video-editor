# T15980: Staging check failed: T15630:C1 The sport is asked at most once per game, and

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the staging check after PR #741 merged (group g-t15750-4, 9634b6862). Impact and complexity are unscored defaults.

**Steps:** After PR #741 merged (9634b6862), run `npx playwright test e2e/checks/T15630.check.spec.js --grep 'T15630:C1'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** The sport is asked at most once per game, and a skip is remembered for that game.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
