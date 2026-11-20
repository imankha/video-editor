# T17940: Staging check failed: T17910:C3 C3: After tapping "Preview" the button reads "Close preview"; tapping

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-20
**Updated:** 2026-11-20

## Problem

Found by the staging check after PR #850 merged (group g-t17910-1, 8a3da1694). Impact and complexity are unscored defaults.

**Steps:** After PR #850 merged (8a3da1694), run `npx playwright test e2e/checks/T17910.check.spec.js --grep 'T17910:C3'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C3: After tapping "Preview" the button reads "Close preview"; tapping it returns to dragging the box and the button reads "Preview". "Back to full video" appears nowhere in Frame.

**Actual:** fail: Error: no unsharpened play Frame can load among 2 unfinished projects

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
