# T245: Fix Pre-existing Test Failure in useHighlightRegions

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

`useHighlightRegions.test.js > calculateDefaultHighlight > calculates centered ellipse based on video dimensions` fails on both master and feature branches. The test expects `highlight.color` to be `'#FFFF00'` but gets `'none'`.

## Solution

Investigate why `calculateDefaultHighlight` returns `color: 'none'` instead of `'#FFFF00'`. Either the default color changed in the implementation without updating the test, or the test setup is missing required state.

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.test.js:799` - Failing assertion
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` - Implementation

### Technical Notes
- Fails identically on master - not a regression from any feature branch
- All other 52 tests in the file pass

## Acceptance Criteria

- [ ] Test passes
- [ ] No other tests broken
