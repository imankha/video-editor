# T58: Visually Disable Tracking Squares When Layer Off

**Status:** DONE
**Impact:** LOW
**Complexity:** LOW
**Created:** 2026-02-11

## Problem

When the tracking layer is turned off in Overlay mode, the green tracking squares should visually indicate they're disabled (dimmed/grayed out) rather than just disappearing or staying the same.

## Expected Behavior

- When tracking layer is enabled: Green squares at full opacity
- When tracking layer is disabled: Squares dimmed/grayed out (e.g., 30% opacity, gray color)

This provides better UX feedback about the layer state.

## Approach

1. Find where tracking squares are rendered (PlayerDetectionOverlay)
2. Check the layer enabled/disabled state
3. Apply dimmed styling when disabled (reduced opacity or gray color)

## Files to Check

```
src/frontend/src/modes/overlay/PlayerDetectionOverlay.jsx
src/frontend/src/modes/overlay/OverlayMode.jsx
```

## Acceptance Criteria

- [ ] Tracking squares appear dimmed when tracking layer is off
- [ ] Tracking squares return to full green when layer is on
- [ ] Visual change is clear and immediate
