# T242: Rename Project from Project Card

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

Currently there's no easy way to rename a project from the project card on the Projects screen. Users need to go into the project to change its name, which is cumbersome for a simple rename operation.

## Solution

Add inline rename functionality to project cards:

- Double-click on project name to edit inline, OR
- Add a rename option to project card menu/context menu, OR
- Add a small edit icon next to the project name

## Context

### Relevant Files
- `src/frontend/src/screens/ProjectsScreen.jsx` - Projects listing
- `src/frontend/src/components/ProjectCard.jsx` - Individual project card (if exists)
- `src/frontend/src/components/ProjectManager.jsx` - Project management logic
- `src/backend/app/routers/projects.py` - Project update endpoint

### Related Tasks
- None

### Technical Notes
- Check existing UI patterns for inline editing in the app
- Consider keyboard support (Enter to save, Escape to cancel)
- Need to handle empty/whitespace names

## Implementation

### Steps
1. [ ] Audit current project card UI and interactions
2. [ ] Choose rename UX pattern (inline edit, modal, or menu)
3. [ ] Implement rename UI on project card
4. [ ] Wire up to backend project update endpoint
5. [ ] Add keyboard support and validation

### Progress Log

*No progress yet*

## Acceptance Criteria

- [ ] Can rename project directly from project card
- [ ] No need to open project to rename it
- [ ] Enter saves, Escape cancels (if inline edit)
- [ ] Empty names are rejected with feedback
