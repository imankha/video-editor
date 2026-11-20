# T17890: Staging check failed: T17860:C2 C2: Tapping it again hides the track and restores "Trim

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-20
**Updated:** 2026-11-20

## Problem

Found by the staging check after PR #847 merged (group g-t17860-1, a55f681e7). Impact and complexity are unscored defaults.

**Steps:** After PR #847 merged (a55f681e7), run `npx playwright test e2e/checks/T17860.check.spec.js --grep 'T17860:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C2: Tapping it again hides the track and restores "Trim and slow motion", the scissors and aria-expanded="false"; trim and speed edits made while open still apply (highlight length unchanged by closing).

**Actual:** fail: TimeoutError: page.waitForResponse: Timeout 30000ms exceeded while waiting for event "response"

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
