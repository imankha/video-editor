# T2710: Keyframe Invariant Violations on Restore

**Status:** TESTING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-05-11
**Updated:** 2026-05-11

## Problem

On the framing screen, the browser console shows:
```
Keyframe invariant violations: Array(1)
[Keyframe] State dump: Object
```

This is a development-only validation check that fires when keyframe state violates guarantees the system depends on. The violations indicate real state integrity issues during clip loading/restoration -- likely missing `origin` fields or boundary keyframes not being set correctly on restore.

While dev-only (won't appear in production), it signals that the framing pipeline can enter invalid states. Invalid keyframe state can cause incorrect crop behavior, missing boundary keyframes, or corrupted saved data.

## Root Cause Analysis

### Validation logic

The `useKeyframeController` hook (`useKeyframeController.js:37-56`) runs a `useEffect` in development mode that calls `validateInvariants(state)`:

```javascript
useEffect(() => {
  if (process.env.NODE_ENV === 'development') {
    const violations = validateInvariants(state);
    if (violations.length > 0) {
      // Log violations (deduplicated by content)
      console.error('Keyframe invariant violations:', violations);
      console.warn('[Keyframe] State dump:', { ... });
    }
  }
}, [state]);
```

### What invariants are checked

`validateInvariants()` in `keyframeController.js:88-129` checks:

1. All keyframes must have an `origin` property (`'permanent' | 'user' | 'trim'`)
2. All keyframes must have a `frame` number (integer)
3. Keyframes must be sorted by frame (ascending order)
4. If initialized: must have at least 2 keyframes (start + end boundaries)
5. If initialized: first keyframe must be permanent at frame 0
6. If initialized: last keyframe must be permanent

### Likely trigger

The violation occurs when entering the framing screen (FramingScreen.jsx:33 in the component stack). This points to the **keyframe restoration path** -- when saved keyframes are loaded from the database for a clip:

- `RESTORE_KEYFRAMES` action (`keyframeController.js:277-317`) receives saved keyframes and calls `ensurePermanentKeyframes()` to add boundaries
- If the saved data is missing `origin` fields (e.g., older clips saved before origin tracking was added), restoration may produce invalid state
- `ensurePermanentKeyframes()` may not fully cover all edge cases in the restore path
- T2000 (Overlapping Crop Keyframes, DONE) fixed a similar issue where `ensurePermanentKeyframes` duplicated frame-0 keyframes on restore, but there may be remaining edge cases

## Solution

Investigate the specific violation(s) firing and fix the root cause in the restoration path.

## Context

### Relevant Files

- `src/frontend/src/hooks/useKeyframeController.js` -- Validation useEffect
  - Lines 37-56: Dev-mode invariant checking with deduplication
- `src/frontend/src/controllers/keyframeController.js` -- State machine + validation
  - Lines 88-129: `validateInvariants()` function (6 invariant checks)
  - Lines 277-317: `RESTORE_KEYFRAMES` action (restoration path)
  - `ensurePermanentKeyframes()` -- adds boundary keyframes at start/end
- `src/frontend/src/screens/FramingScreen.jsx` -- Where violations fire (line 33)

### Related Tasks
- T2000 (Overlapping Crop Keyframes) -- DONE, fixed duplicate frame-0 on restore
- T1400 (Framing Keyframe Dedup) -- DONE, snap-to-nearby within MIN_KEYFRAME_SPACING
- T1660 (Framing Gesture Persistence) -- DONE, fixed fire-and-forget API calls

### Technical Notes

- Validation is **dev-only** -- wrapped in `process.env.NODE_ENV === 'development'` check
- Violations are **deduplicated** -- only logs when violation content changes (avoids render spam)
- The validation was moved from render to `useEffect` in T860 to reduce console noise
- Need to reproduce: enter framing screen for any clip, check console for the specific violation message (the Array(1) contains the violation description string)

## Implementation

### Steps
1. [ ] Reproduce the violation -- enter framing for a clip, read the exact violation string from `Array(1)`
2. [ ] Trace which invariant fails (missing origin? wrong boundary? not sorted?)
3. [ ] Check the saved keyframe data in the database for the affected clip (are origins missing?)
4. [ ] Fix the restoration path (`RESTORE_KEYFRAMES` action) or `ensurePermanentKeyframes()` to handle the edge case
5. [ ] If the issue is legacy data (clips saved without origins), add a migration/normalization step in the restore path
6. [ ] Verify no violations fire on any clip after the fix

### Progress Log

**2026-05-11**: Task created. Violation observed during T1190 manual testing on localhost. Console showed `Keyframe invariant violations: Array(1)` with component stack pointing to FramingScreen.jsx:33. Exact violation type not yet identified -- need to reproduce and read the array content.

**2026-05-11**: Root cause identified and fixed. The violation is invariant 4: "Initialized state should have at least 2 keyframes, has 1". Occurs when `RESTORE_KEYFRAMES` receives degenerate data (e.g., single keyframe at frame 0) where `ensurePermanentKeyframes` produces only 1 keyframe because endFrame collapses to the same position as the start boundary. Fix: guard both `RESTORE_KEYFRAMES` and `SET_END_FRAME` — if result has < 2 keyframes, skip and let auto-init create proper defaults. Added 3 unit tests. All 461 frontend tests pass.

## Acceptance Criteria

- [ ] No keyframe invariant violations fire in dev console when entering framing
- [ ] Restoration handles legacy clips (possibly missing origin fields) without producing invalid state
- [ ] Existing T2000 dedup fix still works (no regression)
- [ ] All permanent boundary invariants hold after restore
