# T17990: Staging check failed: T17910:C9 C9: At 1440 wide, the gap between "Preview" and "Sharpen!"

**Status:** DONE
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-20
**Updated:** 2026-11-20

## Problem

Found by the staging check after PR #850 merged (group g-t17910-1, 8a3da1694). Impact and complexity are unscored defaults.

**Steps:** After PR #850 merged (8a3da1694), run `npx playwright test e2e/checks/T17910.check.spec.js --grep 'T17910:C9'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C9: At 1440 wide, the gap between "Preview" and "Sharpen!" is at least twice the gap between "Trim and slow motion" and "Preview".

**Actual:** fail: Error: no unsharpened play Frame can load among 2 unfinished projects

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.

## Resolution (2026-11-20)

Not a defect. The staging check ran as e2e-gate@test.local, whose only unsharpened plays belong to a game whose upload never finished (playback-url 409 source_uploading), so no Frame screen could load. Re-run against staging as e2e-gate3@test.local: C1-C9 passed (14 of 16 tests). C10's numbered coach steps need a new account; e2e-gate3 has 3+ finished highlights and correctly gets the experienced coach sentence instead. Closed at the owner's request.
