# T1900: Explicit "Create Reel" Toggle on Clips

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-26
**Updated:** 2026-04-26

## Problem

Currently, 5-star clips automatically get a reel (project) created for them. This is confusing because:
1. Users don't understand why a reel appeared — the connection between rating and reel creation is invisible
2. Users may want reels for non-5-star clips but have no way to trigger it
3. Users may not want a reel for a 5-star clip but can't prevent it

The automatic behavior removes user agency and creates confusion.

## Solution

Replace the implicit 5-star → auto-project logic with an explicit **"Create Reel"** on/off toggle in the add/edit clip dialog.

### Toggle behavior

- **Default state:** ON for 5-star clips, OFF for all others (preserves the useful default without hiding the action)
- **New clip:** If toggle is ON when saving, create the reel immediately
- **Existing clip (no reel yet):** User flips toggle to ON → create reel on save
- **Existing clip (reel exists):** Toggle is ON and **disabled** — can't un-create a reel that already exists
- **Clip rating changed:** If a clip with an existing reel has its rating changed, the reel persists (no auto-delete). If a clip without a reel is re-rated to 5 stars, toggle defaults back to ON but user can override before saving.

### Key difference from current behavior

| Scenario | Current | New |
|----------|---------|-----|
| Rate clip 5 stars | Reel silently created | Toggle defaults ON, user sees it and can turn OFF before save |
| Rate clip 4 stars | No reel | Toggle defaults OFF, user can turn ON |
| Change 5-star to 3-star | Reel auto-deleted if unmodified | Reel persists, toggle disabled (already created) |
| User wants reel for 3-star clip | Not possible | Turn toggle ON |

## Context

### Relevant Files (REQUIRED)

**Backend:**
- `src/backend/app/routers/clips.py` — Lines 821-832: current 5-star auto-project sync logic; Lines 854-859: new clip auto-project creation; Lines 662-700: `_create_auto_project_for_clip()`, `_delete_auto_project()`
- `src/backend/app/routers/clips.py` — `RawClipSave` model: add `create_project: Optional[bool]` field
- `src/backend/app/routers/clips.py` — `update_raw_clip` PUT endpoint: similar 5-star sync logic around line 877

**Frontend:**
- `src/frontend/src/modes/annotate/components/AnnotateControls.jsx` — Add clip dialog (or wherever the rating + save controls live)
- `src/frontend/src/hooks/useClipManager.js` — Clip save logic, sends `create_project` to backend

### Related Tasks
- None blocking. This replaces existing auto-project behavior.
- **Game deletion already handles project cleanup:** `delete_game` in `games.py` now deletes any project whose working_clips all came from the deleted game (not just auto-created ones). This works correctly with both the old auto-project behavior and the new explicit toggle — no changes needed there.

### Technical Notes

**Backend changes:**
- Add `create_project: Optional[bool] = None` to `RawClipSave` and `RawClipUpdate` models
- In save/update handlers: use `create_project` field instead of `rating == 5` to decide project creation
- Remove the auto-delete logic for rating changes (reel persists once created)
- Keep `_create_auto_project_for_clip()` — just change what triggers it
- Keep `is_auto_created` flag on projects for analytics
- `delete_game` already cleans up orphaned projects (auto or manual) — no changes needed there

**Frontend changes:**
- Add "Create Reel" toggle (switch component) to the add/edit clip dialog
- Toggle default: `rating === 5` → ON, else → OFF
- When rating changes in the dialog, update toggle default (but don't override if user manually set it)
- If clip already has `auto_project_id`, toggle is ON + disabled with tooltip "Reel already created"
- Send `create_project` boolean in the save API call

## Implementation

### Steps
1. [ ] Backend: Add `create_project` field to `RawClipSave` and `RawClipUpdate` models
2. [ ] Backend: Modify save handler — use `create_project` instead of `rating == 5` for new clips
3. [ ] Backend: Modify update handler — create reel when `create_project=true` and no reel exists; never auto-delete
4. [ ] Backend: Remove auto-delete logic (lines 830-832) — reels persist once created
5. [ ] Frontend: Add "Create Reel" toggle to add/edit clip dialog
6. [ ] Frontend: Default toggle based on rating (5=ON, else=OFF), disable if reel already exists
7. [ ] Frontend: Send `create_project` in save/update API calls
8. [ ] Backend tests: verify toggle-based creation, no auto-delete, disabled state for existing reels

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] "Create Reel" toggle visible in add clip dialog
- [ ] Toggle defaults to ON for 5-star clips, OFF for others
- [ ] Saving with toggle ON creates a reel (project)
- [ ] Saving with toggle OFF does not create a reel, even for 5-star clips
- [ ] Flipping toggle ON for an existing clip without a reel creates the reel on save
- [ ] Toggle is disabled (ON) when clip already has a reel — tooltip explains why
- [ ] Changing rating from 5 to lower does NOT delete an existing reel
- [ ] Changing rating to 5 updates toggle default to ON (if user hasn't manually set it)
- [ ] No behavior change for clips that already have auto-created reels
