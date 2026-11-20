# T17900: Staging check failed: T17840:C1 C1: On Home, a highlight made from several plays shows,

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-20
**Updated:** 2026-11-20

## Problem

Found by the staging check after PR #846 merged (group g-t17840-1, ca3bcb74c). Impact and complexity are unscored defaults.

**Steps:** After PR #846 merged (ca3bcb74c), run `npx playwright test e2e/checks/T17840.check.spec.js --grep 'T17840:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: On Home, a highlight made from several plays shows, without any click, text saying highlights made from several plays are no longer supported for editing; its card shows no pencil edit button and no "In progress" badge.

**Actual:** fail: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
