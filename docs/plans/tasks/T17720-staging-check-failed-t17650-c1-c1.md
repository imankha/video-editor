# T17720: Staging check failed: T17650:C1 C1: The steps above allow deleting the split while keeping

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-19
**Updated:** 2026-11-19

## Problem

Found by the staging check after PR #836 merged (group g-t17660-2, 6390f2693). Impact and complexity are unscored defaults.

**Steps:** After PR #836 merged (6390f2693), run `npx playwright test e2e/checks/T17650.check.spec.js --grep 'T17650:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** C1: The steps above allow deleting the split while keeping the end trimmed at 1440 x 900.

**Actual:** fail: Error: Timeout 90000ms exceeded while waiting on the predicate

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
