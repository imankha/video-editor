# T300: Mobile Annotate Screen

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-03-04
**Updated:** 2026-03-04

## Problem

The annotate/clips screen has content bleeding off the right edge on mobile:
- A scrollbar is visible and "Resc..." text is clipped on the right
- The right side appears to have timeline/video content partially visible behind the clip details panel
- Home icon floats on the right side, looks out of place

The clip details panel itself (rating, tags, name, times, notes) is actually fairly readable — the issue is the surrounding layout.

## Solution

On mobile, the annotate screen should show one panel at a time:
- Clip details panel takes full width (already mostly does)
- Timeline/video area should be hidden or accessible via tab/toggle
- Ensure no horizontal overflow

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/AnnotateScreen.jsx` - Annotate layout
- `src/frontend/src/components/ClipDetails.jsx` - Clip details panel
- `src/frontend/src/components/Timeline.jsx` - Timeline component

### Related Tasks
- Part of: Mobile Responsive epic

## Implementation

### Steps
1. [ ] Identify what's causing the right-side overflow
2. [ ] Add responsive layout: full-width clip details on mobile
3. [ ] Handle timeline/video access on mobile (tab, toggle, or stacked)
4. [ ] Test on 360px and 428px

## Acceptance Criteria

- [ ] No horizontal overflow on annotate screen
- [ ] Clip details fully visible and editable
- [ ] Timeline/video accessible (even if behind a toggle)
