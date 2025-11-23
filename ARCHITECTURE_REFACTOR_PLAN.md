# Architecture Refactor Plan: Keyframe State Management

This document outlines a comprehensive plan for improving the keyframe state management architecture in the video editor. These changes are intended for a future PR to minimize risk.

## Current Issues Identified

### 1. Tightly Coupled Components
- App.jsx acts as both controller and view, managing ~1000 lines of mixed concerns
- Keyframe state management is interleaved with UI logic
- Handler functions are defined inline within App.jsx

### 2. Inconsistent State Ownership
- Some state is managed in hooks (useKeyframes), some in App.jsx
- Selection state was previously managed separately from keyframe state (now fixed via derived state)
- TrimRange affects keyframes but is managed separately

### 3. Missing Test Coverage
- Only utility functions have tests (keyframeUtils.js)
- No tests for hook behavior (useKeyframes, useCrop, useHighlight)
- No integration tests for trim-keyframe interactions

## Proposed Architecture

### Phase 1: Extract Keyframe Controller

Create a dedicated keyframe controller that manages all keyframe-related state and operations:

```
/src
  /controllers
    keyframeController.js    # Centralized keyframe state machine
  /hooks
    useKeyframeController.js # React hook wrapper for controller
```

**Benefits:**
- Pure functions for state transitions (testable)
- Single source of truth for keyframe state
- Clear separation of state logic from React rendering

### Phase 2: Implement State Machine Pattern

Model keyframe state as a finite state machine:

```javascript
// Possible states
const KeyframeStates = {
  UNINITIALIZED: 'uninitialized',
  INITIALIZED: 'initialized',
  EDITING: 'editing',
  TRIMMING: 'trimming'
};

// State transitions
const transitions = {
  [UNINITIALIZED]: {
    LOAD_VIDEO: INITIALIZED
  },
  [INITIALIZED]: {
    START_EDIT: EDITING,
    START_TRIM: TRIMMING,
    RESET: UNINITIALIZED
  },
  // ...
};
```

**Benefits:**
- Explicit state transitions prevent invalid states
- Easier to test all transitions
- Clear documentation of valid operations per state

### Phase 3: Event-Driven Updates

Replace direct state manipulation with events:

```javascript
// Instead of:
setKeyframes(prev => [...prev, newKeyframe]);

// Use events:
dispatch({ type: 'ADD_KEYFRAME', payload: { time, data } });
```

**Implementation Options:**
1. **useReducer** - Built-in React solution
2. **Zustand** - Lightweight state management
3. **Custom event bus** - More control, more code

**Recommended: useReducer** for simplicity and React compatibility.

### Phase 4: Add Comprehensive Tests

#### Unit Tests
- `keyframeController.test.js` - Test all state transitions
- `useKeyframes.test.js` - Test hook behavior (using @testing-library/react-hooks)

#### Integration Tests
- Trim + keyframe interaction tests
- Selection derivation tests
- Export format conversion tests

#### Test Scenarios to Cover
1. **Initialization**
   - [ ] Initialize with default keyframes at frame 0 and end frame
   - [ ] Skip initialization when trimRange is set
   - [ ] Handle stale keyframes (end frame mismatch)

2. **Keyframe Operations**
   - [ ] Add keyframe at new position
   - [ ] Update existing keyframe
   - [ ] Remove non-permanent keyframe
   - [ ] Reject removal of permanent keyframe
   - [ ] Mirror start to end when end not explicit

3. **Trim Operations**
   - [ ] Delete keyframes in trim range
   - [ ] Preserve keyframes at start boundary
   - [ ] Delete keyframes at end boundary (old end being removed)
   - [ ] Create trim-origin keyframes at boundaries
   - [ ] Cleanup trim keyframes when trim cleared

4. **Selection (Derived State)**
   - [ ] Selection derived from playhead + keyframes
   - [ ] Selection null when no keyframe in tolerance
   - [ ] Selection updates automatically on seek

## Migration Strategy

### Step 1: Add Tests First
Before any refactoring, add comprehensive tests for current behavior:
```
npm test -- --coverage
```
Target: 80% coverage on keyframe-related code.

### Step 2: Extract Controller (Non-Breaking)
Create the controller alongside existing code, ensure parity through tests.

### Step 3: Migrate Gradually
Update components one at a time to use the controller, keeping old code paths available.

### Step 4: Remove Old Code
Once all components migrated and tests pass, remove old implementations.

## Files to Modify

### Primary Changes
| File | Change | Risk |
|------|--------|------|
| `App.jsx` | Extract handlers to controller | Medium |
| `useKeyframes.js` | Refactor to use state machine | Medium |
| `useCrop.js` | Use shared controller | Low |
| `useHighlight.js` | Use shared controller | Low |

### New Files
| File | Purpose |
|------|---------|
| `src/controllers/keyframeController.js` | State machine logic |
| `src/hooks/useKeyframeController.js` | React wrapper |
| `src/controllers/keyframeController.test.js` | Controller tests |
| `src/hooks/useKeyframes.test.js` | Hook tests |

## Success Criteria

1. **All existing functionality works unchanged**
   - Trim operations preserve boundary keyframes
   - Selection updates automatically on seek
   - Copy/paste works correctly
   - Export produces correct format

2. **Test coverage > 80%** on keyframe-related code

3. **App.jsx reduced by 40%+** through extraction

4. **Clear state flow** documented and enforced

## Timeline Estimate

This is a significant refactor. Suggested approach:
1. Phase 1 (Tests) - First PR
2. Phase 2-3 (Controller + State Machine) - Second PR
3. Phase 4 (Migration) - Third PR

Each PR should be independently deployable with no regressions.

## Completed Work (This PR)

The following improvements have already been made in this PR:

1. **Fixed dependency arrays** - useCrop/useHighlight now use primitive values to avoid unnecessary re-renders

2. **Derived selection state** - Selection is now computed via useMemo from playhead position and keyframes, eliminating race conditions

3. **Extracted utility functions** - Common keyframe search operations are now in `keyframeUtils.js` with full test coverage

4. **Added test framework** - vitest is now configured with working tests for utility functions
