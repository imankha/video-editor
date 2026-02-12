# T73: Project Card Shows Wrong Clip Count

**Status:** TODO
**Impact:** LOW
**Complexity:** LOW
**Created:** 2026-02-12

## Problem

The "Great Dribbeling" project has 1 clip but the project card displays "2 clips".

## Expected Behavior

Project card should show the correct number of clips in the project.

## Investigation Areas

- `src/frontend/src/components/ProjectCard.jsx` - Where clip count is displayed
- Backend API response - Check if `clip_count` field is correct
- Database query - Verify counting logic for working_clips

## Acceptance Criteria

- [ ] Project card displays correct clip count
- [ ] Count matches actual clips in project
