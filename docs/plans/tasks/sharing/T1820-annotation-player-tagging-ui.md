# T1820: Annotation Player Tagging UI

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

Users annotating game footage can only tag play types (Goal, Assist, etc.). There's no way to say "this clip features Johnny" or tag clips for teammates.

## Solution

Add a "Players" section to the add clip dialog (`AnnotateFullscreenOverlay`). For 4+ star clips, auto-tag the current user's athlete. User can add teammates via the UserPicker component.

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — Add player tag section
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — Add player tags to edit sidebar
- `src/frontend/src/containers/AnnotateContainer.jsx` — Wire player tag persistence
- `src/frontend/src/components/shared/UserPicker.jsx` — Reuse (from T1800)

**Backend:**
- `src/backend/app/routers/clips.py` — Player tag endpoints (from T1810)

### Related Tasks
- Depends on: T1800 (UserPicker), T1810 (data model), T1610 (athlete profiles for auto-tag identity)
- Blocks: T1840 (delivery triggered by player tags)

### Technical Notes

**UI placement:** Below the existing play type tag selector, add a "Players" section:
- Label: "Players" (visually distinct from "Play Type" tags)
- Auto-populated: current user's athlete email as a chip (for rating >= 4)
- User can remove self-tag or add others via UserPicker
- Compact: chips with email/name, "+" button to open UserPicker input

**Auto-tag behavior:**
- Rating >= 4: user's own email auto-added to player tags
- Rating < 4: player tag section still visible but empty (user can manually add)
- Changing rating from 4+ to 3-: self-tag remains (don't remove — user may want it)
- The auto-tag uses the authenticated user's email (from auth context)

**Persistence:**
- Player tags saved via `PUT /api/clips/raw/{id}/player-tags` as a gesture action
- Called from the save handler, not reactively from state changes
- On edit: load existing player tags from clip response

## Implementation

### Steps
1. [ ] Add "Players" section UI to AnnotateFullscreenOverlay (below play type tags)
2. [ ] Auto-tag logic: populate with user's email when rating >= 4
3. [ ] Integrate UserPicker for adding teammates
4. [ ] Wire save: call PUT player-tags endpoint from clip save handler
5. [ ] Add player tags to ClipDetailsEditor (edit mode in sidebar)
6. [ ] Load existing player tags when editing a clip

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] "Players" section visible in add clip dialog
- [ ] User's athlete auto-tagged for 4+ star clips
- [ ] Can add teammates via UserPicker (with autocomplete + green/yellow status)
- [ ] Can remove any player tag (including self)
- [ ] Player tags persist on save via gesture-based API call
- [ ] Existing player tags load when editing a clip
- [ ] Player tags visually distinct from play type tags
