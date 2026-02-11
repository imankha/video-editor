# T63: Project View Filter Persistence

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** LOW
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

Project view should:
1. Default to "Uncompleted" filter on first load
2. Remember the last used filter in the database
3. Use the stored filter on subsequent loads

## Solution

1. Set initial default filter to "Uncompleted"
2. Store the user's filter preference in the database when changed
3. Load the stored preference on app load

## Context

### Relevant Files
- `src/frontend/src/screens/` - Project listing screen
- `src/frontend/src/stores/` - State management
- `src/backend/app/` - User preferences endpoint
- Database schema - User preferences table

### Related Tasks
- May relate to T200 User Management for proper per-user storage

### Technical Notes
- For now, can store in existing user/session storage
- After T200, migrate to proper user preferences in database

## Implementation

### Steps
1. [ ] Find project filter implementation
2. [ ] Change default from current value to "Uncompleted"
3. [ ] Add API endpoint to store/retrieve filter preference
4. [ ] Update frontend to persist filter changes
5. [ ] Load stored filter on app initialization

## Acceptance Criteria

- [ ] Project view defaults to "Uncompleted" filter initially
- [ ] Filter changes are persisted to database
- [ ] Stored filter is loaded on subsequent visits
