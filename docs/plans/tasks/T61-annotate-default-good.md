# T61: Annotate Mode Default to "Good"

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-02-11
**Updated:** 2026-02-12

## Problem

In Annotate mode, when creating a new clip/annotation, the quality/rating field should default to "Good" (rating 4) rather than requiring manual selection.

## Solution

Set the default value for the clip quality/rating to 4 ("Good") in the Annotate mode form.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/constants/soccerTags.js` - Contains `ratingAdjectives` (4 = 'Good')
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` - Likely where defaults are set
- `src/frontend/src/screens/AnnotateScreen.jsx`

### Technical Notes
- Rating 4 = "Good" per `ratingAdjectives` in soccerTags.js
- Simple default value change
- Should apply to new clips only, not affect existing clips

## Implementation

### Steps
1. [ ] Find where clip/annotation rating default is set (likely in useAnnotate.js)
2. [ ] Change default rating from current value to 4
3. [ ] Verify existing clips are not affected

## Acceptance Criteria

- [ ] New clips in Annotate mode default to rating 4 ("Good")
- [ ] Existing clips retain their original values
