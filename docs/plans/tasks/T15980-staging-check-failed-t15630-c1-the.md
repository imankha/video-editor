# T15980: Staging check failed: T15630:C1 The sport is asked at most once per game, and

**Status:** STAGING
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

### Where to start (owner session, 2026-11-10)

The staging check failed on its FIRST `toBeVisible`, before it asserted anything about the behaviour: it expected the "What sport is this?" dialog on the first Mark play and did not see it. That points at the check's precondition, not necessarily at the fix. The seeded staging account `e2e-gate@test.local` may already have a sport on the game the check opens, so no dialog is due. First work out which it is: run the check against staging (E2E_BASE_URL, E2E_API_BASE and E2E_CHECK_EMAIL as in Steps) and read the game's sport through `checkApi`. If the account state is the cause, fix the check so it creates or picks a game with no sport (read every id from the API; never hard-code one; log in with `loginForCheck`) and keep it passing on the dev stack. If the dialog really does not appear for a game with no sport, that is a product bug in the T15630 fix: fix it at its root. Do not edit the acceptance criterion.

## Context

### Relevant Files (REQUIRED)

- To be found.
