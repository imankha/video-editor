# T15560: Visit to sign-up gate says not instrumented while the Journey shows visits

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: admin desktop.

**Steps:** Admin > Spend readiness, gate 1; compare with the Journey's Visited node.

**Expected:** Gate 1 reads the same visit data the Journey shows.

**Actual:** Gate 1: 'not instrumented: no visit beacon (visit_daily missing)'. Journey Visited: 25 to 68 visits since 2026-11-08. The gate blocks the measurement flight ('first: Visit to sign-up').

## Acceptance Criteria

- [ ] With visit beacon data present, gate 1 is judged from it (not 'not instrumented').

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T7410, T14910, T14960

### Relevant Files (REQUIRED)
- To be found.
