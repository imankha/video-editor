# T15930: Staging check failed: T15550:C1 'Keep marking plays' returns to Annotate with the playhead after

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the staging check after PR #736 merged (group g-t15430-4, 1a9a0749d). Impact and complexity are unscored defaults.

**Steps:** After PR #736 merged (1a9a0749d), run `npx playwright test e2e/checks/T15550.check.spec.js --grep 'T15550:C1'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** 'Keep marking plays' returns to Annotate with the playhead after the marked play.

**Actual:** fail: TimeoutError: locator.click: Timeout 5000ms exceeded.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
