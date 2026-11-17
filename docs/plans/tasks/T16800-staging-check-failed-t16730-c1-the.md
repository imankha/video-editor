# T16800: Staging check failed: T16730:C1 The steps above give the expected result.

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

Found by the staging check after PR #803 merged (group g-t16730-1, 788b8f73e). Impact and complexity are unscored defaults.

**Steps:** After PR #803 merged (788b8f73e), run `npx playwright test e2e/checks/T16730.check.spec.js --grep 'T16730:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** The steps above give the expected result.

**Actual:** fail: TimeoutError: locator.waitFor: Timeout 480000ms exceeded.

### Where it stops (2026-11-17)

The check never reached the part T16730 fixed (the returning-parent card). It timed out at
`page.getByTestId('focus-publish-action-bar').waitFor({ timeout: 480000 })` in
`src/frontend/e2e/checks/T16730.check.spec.js`: after clicking Sharpen on staging, the ready panel did not appear
within 8 minutes. T16525:C2 failed on staging at the same place before. Find out first whether the staging sharpen
job finished (Modal run time, export row status for `e2e-gate@test.local`) and the panel failed to show, or the job
itself took longer than 8 minutes. If the first, that is a real bug in how Frame learns a sharpen finished; if the
second, the check's wait is wrong for staging, not the app.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
