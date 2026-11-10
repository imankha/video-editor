# T15920: Staging check failed: T15430:C1 In landscape fullscreen Annotate at 844x390, elementFromPoint at Mark's centre

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the staging check after PR #736 merged (group g-t15430-4, 1a9a0749d). Impact and complexity are unscored defaults.

**Steps:** After PR #736 merged (1a9a0749d), run `npx playwright test e2e/checks/T15430.check.spec.js --grep 'T15430:C1'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** In landscape fullscreen Annotate at 844x390, elementFromPoint at Mark's centre returns Mark, and no floating control overlaps it.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
