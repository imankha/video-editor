# T860: Keyframe Invariant Violations Cause Infinite Render Loop

**Status:** TESTING
**Impact:** 9
**Complexity:** 5
**Created:** 2026-04-01
**Updated:** 2026-04-01

## Problem

When opening a project in framing mode, the console floods with hundreds of "Keyframe invariant violations: Array(1)" errors. This appears to be an infinite re-render loop in the keyframe controller that makes the framing screen unresponsive.

The invariant check in `useKeyframeController.js:34-38` runs on every render (it's in the component body, not a useEffect). When the violation triggers a state update (e.g., trying to fix the invariant), it causes another render, which checks the invariant again, creating an infinite loop.

### Observed Behavior
- Console fills with 500+ identical "Keyframe invariant violations: Array(1)" errors
- Framing screen becomes sluggish/unresponsive
- May prevent framing edits from working correctly

### Likely Cause
A clip's keyframe state doesn't satisfy the invariant check (e.g., missing permanent keyframes at boundaries, keyframes out of range). When the clip is loaded from the DB, the state may not have been properly initialized with `ensurePermanentKeyframes`.

## Context

### Relevant Files
- `src/frontend/src/hooks/useKeyframeController.js` — Lines 34-38: invariant check in render body
- `src/frontend/src/screens/FramingScreen.jsx` — clip loading and state restoration

### Related Tasks
- T790: Multiple changes to clip loading flow may have exposed this
