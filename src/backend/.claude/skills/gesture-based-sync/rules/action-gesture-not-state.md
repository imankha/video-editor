# action-gesture-not-state

**Priority:** CRITICAL
**Category:** Action Design

## Rule
Send the user gesture (what they did), not the resulting state (what it looks like now). The backend computes the new state.

## Rationale
When you send full state:
1. **Race conditions**: Two components sending full state = one overwrites other
2. **Wasted bandwidth**: Sending 50 keyframes when only 1 changed
3. **No merge possible**: Can only do "last write wins"
4. **Hard to debug**: What actually changed?

When you send gestures:
1. **Atomic operations**: Each gesture is one DB change
2. **Efficient**: Only send what changed
3. **Mergeable**: Non-conflicting gestures can be combined
4. **Auditable**: Clear log of what happened

## Incorrect Example

```javascript
// User adds one keyframe, but we send ALL keyframes
const handleAddKeyframe = (newKeyframe) => {
  const allKeyframes = [...currentKeyframes, newKeyframe];
  setCurrentKeyframes(allKeyframes);

  // BAD: Sending entire state
  await fetch(`/api/clips/${clipId}`, {
    method: 'PUT',
    body: JSON.stringify({
      crop_data: JSON.stringify(allKeyframes)  // All 50 keyframes!
    })
  });
};
```

**Why this is wrong:**
- If another component is also saving, one overwrites the other
- Sending all data when only one item changed
- Backend can't tell what actually changed

## Correct Example

```javascript
// User adds one keyframe, we send just that action
const handleAddKeyframe = async (newKeyframe) => {
  // Optimistic UI update
  setCurrentKeyframes(prev => [...prev, newKeyframe]);

  // GOOD: Send just the action
  const response = await fetch(`/api/clips/${clipId}/actions`, {
    method: 'POST',
    body: JSON.stringify({
      action: 'add_crop_keyframe',
      data: newKeyframe  // Just the new keyframe!
    })
  });

  if (!response.ok) {
    // Rollback on failure
    setCurrentKeyframes(prev => prev.filter(k => k.frame !== newKeyframe.frame));
  }
};
```

## Backend Handling

```python
@router.post("/clips/{clip_id}/actions")
async def clip_action(clip_id: int, action: ClipAction):
    if action.action == "add_crop_keyframe":
        # Backend modifies state atomically
        current = get_clip_crop_data(clip_id)
        current.append(action.data)
        current.sort(key=lambda k: k["frame"])
        save_clip_crop_data(clip_id, current)
        return {"success": True, "version": increment_version()}
```

## Gesture Examples

| User Action | Gesture to Send |
|-------------|-----------------|
| Add keyframe at frame 100 | `{action: "add_crop_keyframe", data: {frame: 100, ...}}` |
| Move keyframe from 100 to 120 | `{action: "move_crop_keyframe", target: {frame: 100}, data: {new_frame: 120}}` |
| Delete keyframe | `{action: "delete_crop_keyframe", target: {frame: 100}}` |
| Update crop position | `{action: "update_crop_keyframe", target: {frame: 100}, data: {x: 60}}` |

## Additional Context

This pattern enables:
- **Undo/redo**: Store action history, replay backward/forward
- **Offline support**: Queue actions, sync when online
- **Conflict resolution**: Detect which specific actions conflict
- **Debugging**: "User added keyframe at frame 100 at 2:30pm"
