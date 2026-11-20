# T17950: Staging check failed: T17910:C4 C4: At 1440 wide with nothing in progress, the bar

**Status:** DONE
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-20
**Updated:** 2026-11-20

## Problem

Found by the staging check after PR #850 merged (group g-t17910-1, 8a3da1694). Impact and complexity are unscored defaults.

**Steps:** After PR #850 merged (8a3da1694), run `npx playwright test e2e/checks/T17910.check.spec.js --grep 'T17910:C4'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C4: At 1440 wide with nothing in progress, the bar shows "Trim and Preview are optional. When your athlete stays in the box, tap Sharpen!" to the left of the buttons; at 390 wide that line is not shown.

**Actual:** fail: Error: no unsharpened play Frame can load among 2 unfinished projects

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.

## Resolution (2026-11-20)

Not a defect. The staging check ran as e2e-gate@test.local, whose only unsharpened plays belong to a game whose upload never finished (playback-url 409 source_uploading), so no Frame screen could load. Re-run against staging as e2e-gate3@test.local: C1-C9 passed (14 of 16 tests). C10's numbered coach steps need a new account; e2e-gate3 has 3+ finished highlights and correctly gets the experienced coach sentence instead. Closed at the owner's request.
