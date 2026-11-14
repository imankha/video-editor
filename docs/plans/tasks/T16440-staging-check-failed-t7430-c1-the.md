# T16440: Staging check failed: T7430:C1 The Retention chart renders on demand from live data as

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-13
**Updated:** 2026-11-13

## Problem

Found by the staging check after PR #753 merged (group g-t16070-3, 422624215). Impact and complexity are unscored defaults.

**Steps:** After PR #753 merged (422624215), run `npx playwright test e2e/checks/T7430.check.spec.js --grep 'T7430:C1'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** The Retention chart renders on demand from live data as one large chart with no table on screen; unbounded/classic and weekly/monthly toggles work, and hovering any point shows its exact percent and counts (ruling 2026-11-13)

**Actual:** fail: Error: [2mexpect([22m[31mreceived[39m[2m).[22mnot[2m.[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
