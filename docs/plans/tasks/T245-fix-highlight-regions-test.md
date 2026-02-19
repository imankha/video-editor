# T245: Fix Pre-existing Test Failure in useHighlightRegions

**Status:** DONE
**Impact:** 3
**Complexity:** 1
**Created:** 2026-02-17
**Updated:** 2026-02-18

## Problem

`useHighlightRegions.test.js > calculateDefaultHighlight > calculates centered ellipse based on video dimensions` fails on both master and feature branches. The test expects `highlight.color` to be `'#FFFF00'` but gets `'none'`.

## Root Cause

The highlight color system was changed to support two modes: **dim outside** (brightness boost, no color) and **bright inside** (user picks a color). The default mode is "dim outside", stored as `'none'` in the overlay store.

The chain:
1. `overlayStore.js:23` — `highlightColor` defaults to `'none'`
2. `useHighlightRegions.js:42` — `useOverlayHighlightColor()` returns `'none'` from the store
3. `useHighlightRegions.js:98` — `const color = highlightColor || HighlightColor.YELLOW` — `'none'` is truthy, so the `||` fallback doesn't activate
4. `calculateDefaultHighlight` returns `{ color: 'none' }`
5. Test at line 799 expects `'#FFFF00'` (the old hardcoded yellow) → **fails**

The test was written before the color system refactor. It also uses the old yellow hex `#FFFF00` — the constant was updated to `#FFEB3B` in `highlightColors.js`.

## Solution

Update the test assertion at `useHighlightRegions.test.js:799` to expect `'none'` instead of `'#FFFF00'`, since the default highlight mode is now "dim outside" (no color stroke).

```javascript
// Before (wrong):
expect(highlight.color).toBe('#FFFF00');

// After (correct):
expect(highlight.color).toBe('none');
```

Consider adding a second test case that verifies when a color IS selected in the store, `calculateDefaultHighlight` returns that color.

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.test.js:799` — Failing assertion
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js:96-117` — `calculateDefaultHighlight` implementation
- `src/frontend/src/stores/overlayStore.js:23` — Default `highlightColor: 'none'`
- `src/frontend/src/constants/highlightColors.js` — `HighlightColor` constants (YELLOW is `#FFEB3B`, NONE is `'none'`)

### Technical Notes
- Fails identically on master — not a regression from any feature branch
- All other 52 tests in the file pass
- The test has no mock for `overlayStore`, so it uses the real store with its default `'none'` value
- No mock is needed — the default behavior is correct; the test expectation is simply stale

## Acceptance Criteria

- [ ] Test at line 799 updated to expect `'none'`
- [ ] All 53 tests in the file pass
- [ ] No other tests broken
