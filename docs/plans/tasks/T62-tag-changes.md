# T62: Tag Changes

**Status:** TODO
**Impact:** LOW
**Complexity:** LOW
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

Tag system needs updates:
1. Add new tag: "Contro" -> "Transition"
2. Rename tag: "1v1 Save" -> "Save"
3. Remove 1 tag from each category: Movement, Possession, 1v1 Defense, Command

## Solution

Update the tag configuration to:
- Add "Transition" tag (renamed from "Contro")
- Rename "1v1 Save" to "Save"
- Remove one tag from each specified category

## Context

### Relevant Files
- `src/frontend/src/` - Look for tag definitions/constants
- `src/backend/app/` - Check for tag definitions in backend
- Database schema may need migration if tags are stored

### Technical Notes
- Need to identify where tags are defined (constants file, database, or both)
- Consider impact on existing clips that use removed tags
- May need migration strategy for renamed tags

## Implementation

### Steps
1. [ ] Find tag definitions in codebase
2. [ ] Add "Transition" tag
3. [ ] Rename "1v1 Save" to "Save"
4. [ ] Identify which tag to remove from Movement category
5. [ ] Identify which tag to remove from Possession category
6. [ ] Identify which tag to remove from 1v1 Defense category
7. [ ] Identify which tag to remove from Command category
8. [ ] Update tag definitions
9. [ ] Handle migration for existing clips if needed

## Acceptance Criteria

- [ ] "Transition" tag available
- [ ] "1v1 Save" renamed to "Save"
- [ ] One tag removed from Movement category
- [ ] One tag removed from Possession category
- [ ] One tag removed from 1v1 Defense category
- [ ] One tag removed from Command category
- [ ] Existing clips handled appropriately
