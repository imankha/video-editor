# T15940: Staging check failed: T15640:C2 Mark play near 0:00 yields a play of the normal

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the staging check after PR #736 merged (group g-t15430-4, 1a9a0749d). Impact and complexity are unscored defaults.

**Steps:** After PR #736 merged (1a9a0749d), run `npx playwright test e2e/checks/T15640.check.spec.js --grep 'T15640:C2'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** Mark play near 0:00 yields a play of the normal 8 s length.

**Actual:** fail: TimeoutError: locator.click: Timeout 5000ms exceeded.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
