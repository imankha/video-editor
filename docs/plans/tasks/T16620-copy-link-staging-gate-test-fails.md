# T16620: copy-link staging gate test fails in strict mode: the 'Copy link' locator matches 9 buttons

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-16
**Updated:** 2026-11-16

## Problem

Found by the /dotask verifier on group g-t16600-1 at 905953f50, which judged it unrelated to that branch. Impact and complexity are unscored defaults.

**Steps:** Run E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api npx playwright test e2e/derisk-staging-endcard-copylink.qa.spec.js -g 'copy-link'

**Expected:** After the reel card's kebab opens, page.getByRole('button', {name: /^Copy link$/}) resolves to that card's menu item and the test asserts a single toast

**Actual:** The locator is page-scoped, not scoped to the reel card or its menu, and matches 9 buttons, so .evaluate() throws a strict-mode violation (the worker reported this in the commit message). The locator is the same on master, where the test never got this far.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
