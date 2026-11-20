# T17960: Staging check failed: T17910:C5 C5: The "Sharpen!" button shows the wand icon, not the

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-20
**Updated:** 2026-11-20

## Problem

Found by the staging check after PR #850 merged (group g-t17910-1, 8a3da1694). Impact and complexity are unscored defaults.

**Steps:** After PR #850 merged (8a3da1694), run `npx playwright test e2e/checks/T17910.check.spec.js --grep 'T17910:C5'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C5: The "Sharpen!" button shows the wand icon, not the download arrow and not the Spotlight sparkles, at 1440 wide and in the landscape phone rail.

**Actual:** fail: Error: no unsharpened play Frame can load among 2 unfinished projects

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
