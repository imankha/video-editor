# T320: Mobile Video Preview

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-03-04
**Updated:** 2026-03-04

## Problem

The video preview component doesn't adapt well to mobile:
- When squeezed into a half-width column, the video is too small to see details
- The crop rectangle handles are too small to drag on touch
- Zoom controls are cut off ("Zoom:" visible but zoom-out button at edge)
- Overlay preview likely has similar issues

## Solution

- Video preview should use full viewport width on mobile (depends on T310 layout change)
- Ensure crop handles are touch-friendly (minimum 44px touch target)
- Zoom controls should be fully visible
- Consider pinch-to-zoom on mobile for crop adjustment

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/VideoPreview.jsx` - Video display + crop overlay
- `src/frontend/src/components/CropOverlay.jsx` - Crop rectangle handles
- `src/frontend/src/screens/OverlayScreen.jsx` - Overlay preview

### Related Tasks
- Part of: Mobile Responsive epic
- Depends on: T310 (layout must stack before preview can be full-width)

## Implementation

### Steps
1. [ ] After T310, verify video preview fills available width
2. [ ] Increase crop handle touch targets for mobile
3. [ ] Ensure zoom controls are visible and usable
4. [ ] Test drag-to-crop on touch devices
5. [ ] Verify overlay preview also works on mobile

## Acceptance Criteria

- [ ] Video preview fills screen width on mobile
- [ ] Crop handles are draggable via touch (min 44px target)
- [ ] Zoom controls fully visible
- [ ] Overlay preview usable on mobile
