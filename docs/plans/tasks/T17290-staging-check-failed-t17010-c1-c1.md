# T17290: Staging check failed: T17010:C1 C1: At 390x844 with Guidance on, the "Tags and Notes"

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #817 merged (group g-t17040-4, 5aa21f2dc). Impact and complexity are unscored defaults.

**Steps:** After PR #817 merged (5aa21f2dc), run `npx playwright test e2e/checks/T17010.check.spec.js --grep 'T17010:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: At 390x844 with Guidance on, the "Tags and Notes" sheet's close X is not covered by the Guidance switch and a tap on it closes the sheet.

**Actual:** fail: [31mTest timeout of 480000ms exceeded.[39m

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
