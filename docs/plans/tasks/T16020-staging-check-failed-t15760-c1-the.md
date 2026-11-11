# T16020: Staging check failed: T15760:C1 The finished player has its own URL that cold-loads to

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-11
**Updated:** 2026-11-11

## Problem

Found by the staging check after PR #742 merged (group g-t15570-4, 21b798036). Impact and complexity are unscored defaults.

**Steps:** After PR #742 merged (21b798036), run `npx playwright test e2e/checks/T15760.check.spec.js --grep 'T15760:C1'` in src/frontend with E2E_BASE_URL=https://reel-ballers-staging.pages.dev E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** The finished player has its own URL that cold-loads to the same highlight.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
