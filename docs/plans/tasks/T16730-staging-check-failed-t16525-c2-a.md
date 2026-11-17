# T16730: Staging check failed: T16525:C2 A parent who returns later sees the same message and

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

Found by the staging check after PR #796 merged (group g-t16525-1, 94928afa1). Impact and complexity are unscored defaults.

**Steps:** After PR #796 merged (94928afa1), run `npx playwright test e2e/checks/T16525.check.spec.js --grep 'T16525:C2'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** A parent who returns later sees the same message and finds the highlight in Highlights.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
