---
name: keyframe-data-model
description: "Keyframe structure and state machine for crop/highlight animations. Frame-based (not time), with origin tracking. Apply when working with crop keyframes, highlight regions, or animation data."
license: MIT
author: video-editor
version: 1.0.0
---

# Keyframe Data Model

Frame-based keyframe system with origin tracking and state machine architecture.

## When to Apply
- Working with crop keyframes in Framing mode
- Working with highlight keyframes in Overlay mode
- Implementing animation interpolation
- Debugging keyframe persistence
- Understanding state transitions

## Keyframe Structure

```javascript
keyframe = {
  frame: number,                      // Frame number (NOT time in seconds)
  origin: 'permanent' | 'user' | 'trim',
  // + type-specific data:
  // Crop: x, y, width, height
  // Highlight: x, y, radiusX, radiusY, opacity, color
}
```

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Frame-Based | CRITICAL | `frame-` |
| 2 | Origin Tracking | HIGH | `origin-` |
| 3 | State Machine | HIGH | `state-` |
| 4 | Interpolation | MEDIUM | `interp-` |

## Quick Reference

### Frame-Based (CRITICAL)
- `frame-not-time` - Always use frame numbers, never time
- `frame-integer` - Frame must be an integer
- `frame-convert` - Convert time to frame: `Math.round(time * framerate)`

### Origin Tracking (HIGH)
- `origin-permanent` - Auto-generated at start/end of video
- `origin-user` - Created by user interaction
- `origin-trim` - Created when user adjusts trim range
- `origin-required` - Every keyframe must have an origin

### State Machine (HIGH)
- `state-uninitialized` - Before video metadata loaded
- `state-initialized` - Ready for editing
- `state-editing` - User actively modifying keyframes
- `state-trimming` - User adjusting trim range

### Interpolation (MEDIUM)
- `interp-linear` - Linear interpolation between keyframes
- `interp-find-surrounding` - Find keyframes before/after current frame
- `interp-tolerance` - Use `FRAME_TOLERANCE` for near-frame detection

---

## Origin Types

| Origin | Created When | Behavior |
|--------|--------------|----------|
| `permanent` | Video loads | Auto at frame 0 and last frame, never deleted |
| `user` | User clicks/drags | Can be added/updated/deleted by user |
| `trim` | Trim range changes | Created at trim boundaries, cleaned up when trim ends |

---

## State Machine

```
                    ┌─────────────────┐
                    │  UNINITIALIZED  │
                    └────────┬────────┘
                             │ INITIALIZE
                             ▼
                    ┌─────────────────┐
          ┌────────│   INITIALIZED   │────────┐
          │        └─────────────────┘        │
          │ ADD/UPDATE/REMOVE                 │ START_TRIM
          ▼                                   ▼
    ┌──────────┐                      ┌────────────┐
    │ EDITING  │                      │  TRIMMING  │
    └────┬─────┘                      └──────┬─────┘
         │                                   │
         └───────► RESET ◄───────────────────┘
```

---

## Actions

```javascript
// Lifecycle
{ type: 'INITIALIZE', payload: { startKeyframe, endKeyframe, endFrame, framerate } }
{ type: 'RESET' }
{ type: 'RESTORE_KEYFRAMES', payload: { keyframes, endFrame } }

// Keyframe operations
{ type: 'ADD_KEYFRAME', payload: { frame, ...data } }
{ type: 'UPDATE_KEYFRAME', payload: { frame, ...updates } }
{ type: 'REMOVE_KEYFRAME', payload: { frame } }
{ type: 'DELETE_KEYFRAMES_IN_RANGE', payload: { startFrame, endFrame } }

// Trim operations
{ type: 'START_TRIM', payload: { startFrame, endFrame } }
{ type: 'END_TRIM' }
{ type: 'CLEANUP_TRIM_KEYFRAMES' }

// Copy/paste
{ type: 'COPY_KEYFRAME', payload: { data } }
{ type: 'PASTE_KEYFRAME', payload: { frame } }
```

---

## Invariants

Every keyframe state must satisfy:
1. All keyframes have `origin` property
2. All keyframes have integer `frame` property
3. Keyframes are sorted by frame ascending
4. No duplicate frames (within tolerance)
5. Permanent keyframes at frame 0 and endFrame always exist

---

## Interpolation

```javascript
function interpolateAtFrame(keyframes, frame) {
  const before = findLastKeyframeBefore(keyframes, frame);
  const after = findFirstKeyframeAfter(keyframes, frame);

  if (!before && !after) return null;
  if (!after) return before;
  if (!before) return after;

  const t = (frame - before.frame) / (after.frame - before.frame);
  return lerpKeyframe(before, after, t);
}
```

---

## Complete Rules

See individual rule files in `rules/` directory.
See also: `src/frontend/src/controllers/keyframeController.js`
