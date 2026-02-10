# T54: Fix useOverlayState Test Failures

**Status:** TODO
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

localStorage state is leaking between tests. The tests expect `brightness_boost` (set in the test) but receive `dark_overlay` (likely the default or from a previous test).

## Solution

Fix test isolation by properly clearing localStorage before each test or mocking localStorage.

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/hooks/useOverlayState.test.js`
- `src/frontend/src/modes/overlay/hooks/useOverlayState.js`

## Implementation

### Steps
1. [ ] Review test setup/teardown in useOverlayState.test.js
2. [ ] Add proper localStorage cleanup in beforeEach/afterEach
3. [ ] Verify all tests pass in isolation and together
4. [ ] Run full test suite to confirm no regressions

## Acceptance Criteria

- [ ] All useOverlayState tests pass
- [ ] Tests pass when run individually and as full suite
- [ ] No localStorage leakage between tests
