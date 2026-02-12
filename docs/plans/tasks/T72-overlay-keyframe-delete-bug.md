# T72: Cannot Delete Overlay Keyframe Outside Region

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-02-12
**Updated:** 2026-02-12

## Problem

Users cannot delete overlay keyframes that are positioned outside of an overlay region. This restricts editing flexibility - users should be able to delete any keyframe regardless of its position relative to overlay regions.

## Solution

Investigate and fix the deletion logic to allow keyframe deletion regardless of whether the keyframe is inside an overlay region.

## Context

### Relevant Files
- TBD - needs investigation

### Related Tasks
- None

### Technical Notes
- Likely a conditional check that restricts deletion based on region position
- May be in keyframe handling or overlay state management

## Implementation

### Steps
1. [ ] Identify the deletion logic for overlay keyframes
2. [ ] Find the condition preventing deletion outside regions
3. [ ] Fix the logic to allow deletion
4. [ ] Test deletion in various scenarios

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Can delete overlay keyframes that are outside overlay regions
- [ ] Can still delete overlay keyframes that are inside overlay regions
- [ ] No regression in other keyframe operations
