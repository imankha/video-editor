# T16560: Staging check failed: T10540:C10 In the browser, on a fresh upload: mark and rate

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-15
**Updated:** 2026-11-15

## Problem

Found by the staging check after PR #767 merged (group g-t16470-4, caff1bd87). Impact and complexity are unscored defaults.

**Steps:** After PR #767 merged (caff1bd87), run `npx playwright test e2e/checks/T10540.check.spec.js --grep 'T10540:C10'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** In the browser, on a fresh upload: mark and rate a play, go Home, and the tile shows the play without a hard refresh.

**Actual:** fail: [31mTest timeout of 180000ms exceeded.[39m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
