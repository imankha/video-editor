# T54: Fix useOverlayState Test Failures

**Status:** DONE
**Impact:** LOW
**Complexity:** LOW
**Created:** 2026-02-10
**Updated:** 2026-02-10

## Problem

Two tests in `useOverlayState.test.js` are failing due to test isolation issues with localStorage:

```
FAIL src/modes/overlay/hooks/useOverlayState.test.js > useOverlayState > initial state > loads effect type from localStorage if present
AssertionError: expected 'dark_overlay' to be 'brightness_boost'

FAIL src/modes/overlay/hooks/useOverlayState.test.js > useOverlayState > resetOverlayState > clears all state
AssertionError: expected 'dark_overlay' to be 'brightness_boost'
```

## Cause

Tests were outdated. The hook was changed to use backend as source of truth for effect type persistence, but tests still expected localStorage behavior.

## Solution

Updated tests to match actual implementation - the hook uses `dark_overlay` as default and ignores localStorage.

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/hooks/useOverlayState.test.js`
- `src/frontend/src/modes/overlay/hooks/useOverlayState.js`

## Implementation

### Steps
1. [x] Review test setup/teardown in useOverlayState.test.js
2. [x] Identify root cause: tests expected localStorage behavior, hook uses backend
3. [x] Update tests to match actual implementation
4. [x] Run full test suite to confirm no regressions (378/378 pass)

## Acceptance Criteria

- [x] All useOverlayState tests pass (25/25)
- [x] Tests pass when run individually and as full suite
- [x] Full test suite passes (378/378)
