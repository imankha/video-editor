# T15970: Staging check failed: T15750:C2 Opening Edit play does not start playback.

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the staging check after PR #741 merged (group g-t15750-4, 9634b6862). Impact and complexity are unscored defaults.

**Steps:** After PR #741 merged (9634b6862), run `npx playwright test e2e/checks/T15750.check.spec.js --grep 'T15750:C2'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** Opening Edit play does not start playback.

**Actual:** fail: Error: dev-accounts/full failed (404): {"detail":"Not Found"}

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
