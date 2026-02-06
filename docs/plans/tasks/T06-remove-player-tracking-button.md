# T06: Move Player Tracking Toggle to Layer Icon

**Status:** TODO
**Impact:** LOW
**Complexity:** LOW
**Created:** 2026-02-06
**Updated:** 2026-02-06

## Problem

The player tracking on/off toggle is a separate button. It should be integrated into the layer icon for cleaner UX.

## Solution

1. Remove the separate player tracking toggle button
2. Make the layer icon clickable to toggle tracking on/off
3. When tracking is OFF, show a slash through the layer icon (like a "hidden layer" indicator)

## Reference

See `screenshots/player tracking.png` - the circled layer icon should become the toggle.

## Context

### Relevant Files
- TBD - Need to locate the layer icon and tracking button components

### Progress Log

**2026-02-06**: Task created. Clarified: not removing tracking functionality, just moving the toggle to the layer icon with visual feedback (slash when off).

## Implementation

1. [ ] Locate the current player tracking toggle button
2. [ ] Locate the layer icon component
3. [ ] Add click handler to layer icon that toggles tracking
4. [ ] Add visual state: slash through icon when tracking is OFF
5. [ ] Remove the old separate toggle button
6. [ ] Test toggle behavior works correctly

## Acceptance Criteria

- [ ] Clicking layer icon toggles player tracking on/off
- [ ] Layer icon shows slash when tracking is OFF
- [ ] Layer icon shows normal (no slash) when tracking is ON
- [ ] Old separate toggle button is removed
- [ ] Tracking functionality works same as before
