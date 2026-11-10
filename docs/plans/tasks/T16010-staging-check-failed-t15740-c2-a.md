# T16010: Staging check failed: T15740:C2 A dismissed toast stays dismissed after reload.

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the staging check after PR #739 merged (group g-t15400-4, 0380d8ca8). Impact and complexity are unscored defaults.

**Steps:** After PR #739 merged (0380d8ca8), run `npx playwright test e2e/checks/T15740.check.spec.js --grep 'T15740:C2'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** A dismissed toast stays dismissed after reload.

**Actual:** fail: Error: page.evaluate: TypeError: Failed to fetch dynamically imported module: https://reel-ballers-staging.pages.dev/src/stores/exportStore.js

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
