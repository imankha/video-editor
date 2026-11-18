# T17620: Staging check failed: T17380:C2 C2: Retrying after buying credits completes the upload.

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## Problem

Found by the staging check after PR #828 merged (group g-t17370-2, 2b784daed). Impact and complexity are unscored defaults.

**Steps:** After PR #828 merged (2b784daed), run `npx playwright test e2e/checks/T17380.check.spec.js --grep 'T17380:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C2: Retrying after buying credits completes the upload.

**Actual:** fail: Error: balance is below the 2-credit upload cost

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
