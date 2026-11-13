# T15990: Staging check failed: T15400:C2 Every button of the 'Switch to landscape?' dialog is tappable

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the staging check after PR #739 merged (group g-t15400-4, 0380d8ca8). Impact and complexity are unscored defaults.

**Steps:** After PR #739 merged (0380d8ca8), run `npx playwright test e2e/checks/T15400.check.spec.js --grep 'T15400:C2'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** Every button of the 'Switch to landscape?' dialog is tappable on iPhone 14 (elementFromPoint at its centre returns the button).

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
