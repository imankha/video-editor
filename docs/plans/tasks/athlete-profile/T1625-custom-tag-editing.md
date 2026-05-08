# T1625: Custom Tag Editing

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-05-08
**Updated:** 2026-05-08

## Problem

Users need to customize the tags available for their sport. Pre-canned tags
cover common highlight plays, but every sport and every athlete is different.
Users playing an unsupported sport have no tags at all until they can create
their own.

## Solution

### What Users Can Do

1. **Edit existing tags** -- rename, change description, reorder, delete
2. **Add new tags** -- to any position group in any sport
3. **Add/edit/remove position groups** -- optional organizational categories
4. **Create tags for custom sports** -- sports with no pre-canned tags start
   empty; user builds their own tag set

### Backend

CRUD endpoints for sport tags (all scoped to the user's database):

- `GET /api/profiles/sport-tags/{sport}` -- get all tags for a sport
- `PUT /api/profiles/sport-tags/{sport}` -- replace all tags for a sport
  (full-state save on explicit user action)
- `POST /api/profiles/sport-tags/{sport}/reset` -- reset to pre-canned
  defaults (only for supported sports)

The PUT endpoint receives the complete tag structure for the sport and
replaces all rows. This is a gesture-based full-state save (user clicks
"Save"), not reactive persistence.

### Frontend

Tag editing UI accessible from the profile settings (ManageProfilesModal or
a linked settings panel):

- List of position groups with their tags
- Inline editing of tag names and descriptions
- Add/remove tags within a position
- Add/remove position groups
- Drag-to-reorder (or move up/down buttons) for positions and tags
- "Reset to defaults" button for supported sports
- Save button commits changes

For custom/unsupported sports:
- Start with empty state and a prompt to add positions/tags
- Same editing UI, just starts blank

### UX Flow

1. User goes to profile settings
2. Clicks "Edit Tags" (or similar) next to the sport field
3. Sees current tag structure (pre-canned or custom)
4. Makes changes
5. Clicks Save -- PUT to backend
6. Next annotation session uses updated tags

## Relevant Files

- `src/backend/app/services/user_db.py` -- sport_tags table (from T1620)
- `src/backend/app/routers/profiles.py` -- profile API
- `src/frontend/src/components/ManageProfilesModal.jsx` -- profile settings UI
- `src/frontend/src/stores/profileStore.js` -- may need tag state

## Depends On

- T1610 (profile sport field)
- T1620 (sport_tags table and seed data)

## Acceptance Criteria

- [ ] Users can add, edit, and remove tags for any sport
- [ ] Users can add, edit, and remove position groups
- [ ] Users can reorder tags and positions
- [ ] Changes persist via explicit Save gesture
- [ ] Supported sports have a "Reset to defaults" option
- [ ] Custom sports start with empty tags and allow full editing
- [ ] Tag edits are reflected in the annotation UI on next session
