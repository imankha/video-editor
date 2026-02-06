# origin-required

**Priority:** HIGH
**Category:** Origin Tracking

## Rule
Every keyframe must have an `origin` property with value `'permanent'`, `'user'`, or `'trim'`. This is enforced by state machine invariants.

## Rationale
Origin tracking enables:
1. **Different behaviors**: Permanent keyframes can't be deleted
2. **Cleanup logic**: Trim keyframes are removed when trim mode ends
3. **Debugging**: Know where each keyframe came from
4. **Persistence**: Only save user-created keyframes

## Origin Types

| Origin | Created When | Can Delete? | Persisted? |
|--------|--------------|-------------|------------|
| `permanent` | Video initialization | No | No (auto-created) |
| `user` | User clicks/drags | Yes | Yes |
| `trim` | Trim range changes | Auto-cleanup | No |

## Incorrect Example

```javascript
// BAD: Missing origin
const newKeyframe = {
  frame: 100,
  x: 50,
  y: 50,
  width: 640,
  height: 360
  // No origin! Invariant violation
};

dispatch({ type: 'ADD_KEYFRAME', payload: newKeyframe });
// Will fail invariant check in development
```

## Correct Example

```javascript
// GOOD: User-created keyframe
const newKeyframe = {
  frame: 100,
  origin: 'user',
  x: 50,
  y: 50,
  width: 640,
  height: 360
};

dispatch({ type: 'ADD_KEYFRAME', payload: newKeyframe });

// GOOD: Permanent keyframes at video bounds
const initializeKeyframes = (metadata) => {
  const startKeyframe = {
    frame: 0,
    origin: 'permanent',
    ...defaultCropForMetadata(metadata)
  };

  const endKeyframe = {
    frame: metadata.totalFrames - 1,
    origin: 'permanent',
    ...defaultCropForMetadata(metadata)
  };

  dispatch({
    type: 'INITIALIZE',
    payload: { startKeyframe, endKeyframe, endFrame: metadata.totalFrames - 1 }
  });
};

// GOOD: Trim keyframes for trim boundaries
const startTrim = (startFrame, endFrame) => {
  dispatch({
    type: 'START_TRIM',
    payload: { startFrame, endFrame }
    // Reducer creates keyframes with origin: 'trim'
  });
};
```

## Invariant Check

```javascript
// In keyframeController.js
export function validateInvariants(state) {
  const violations = [];

  // All keyframes must have an origin
  const missingOrigin = state.keyframes.filter(kf => !kf.origin);
  if (missingOrigin.length > 0) {
    violations.push(`Keyframes missing origin: ${JSON.stringify(missingOrigin)}`);
  }

  return violations;
}
```

## Additional Context

The reducer automatically adds `origin: 'user'` if not provided in `ADD_KEYFRAME`, but it's better practice to be explicit.

When loading keyframes from persistence:
```javascript
const loadedKeyframes = savedKeyframes.map(kf => ({
  ...kf,
  origin: kf.origin || 'user'  // Fallback for legacy data
}));
```
