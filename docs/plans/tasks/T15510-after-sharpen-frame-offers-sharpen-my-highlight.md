# T15510: After Sharpen, Frame offers Sharpen my highlight again with its credit cost, and spends credits with no confirm

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPhone 14, iPad.

**Steps:** Sharpen a highlight in Frame and wait for it to finish.

**Expected:** The screen shows it's done and moves on; spending credits is clearly confirmed.

**Actual:** Frame shows 'Sharpen my highlight' and '~8 credits' again (a second tap likely charges 8 more); the only done signal is a toast. The first Sharpen spent 8 credits with no confirm step; the cost is a small grey line ('~8 credits · balance 86').

## Acceptance Criteria

- [ ] After a successful Sharpen the primary button is the next step, not Sharpen again.
- [ ] The credit cost is visible next to the button before the first spend.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T14620, T14830

### Relevant Files (REQUIRED)
- To be found.
