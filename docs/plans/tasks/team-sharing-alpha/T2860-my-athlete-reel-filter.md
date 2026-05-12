# T2860: My Athlete Filter in New Reel

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2800 (data model -- `my_athlete` column)
**Supersedes:** T1860 (Reel Creation Teammate Filter -- simplified)

## Problem

When creating a reel (highlight video), users browse clips from their games to select which ones to include. Users tag some clips as "teammate" plays during annotation (my_athlete=false). When building a reel for their own kid, they don't want to comb through teammate clips.

## Solution

### Filter in GameClipSelectorModal

Add a filter toggle/dropdown to the clip selector used in the New Reel flow:

- **Options**: "All Clips" | "My Athlete" (default)
- "My Athlete" filters to `my_athlete = 1` clips only
- "All Clips" shows everything

### Backend Support

The clips endpoint used by the reel creator should accept an optional `my_athlete` query parameter:

```
GET /api/profiles/{profile_id}/games/{game_id}/clips?my_athlete=1
```

- `my_athlete=1` -> only clips where `my_athlete = 1`
- Omitted -> all clips (backward compatible)

### Default Behavior

- Filter defaults to "My Athlete" so users see only their kid's clips by default
- Users can switch to "All Clips" if they want to include teammate plays in a reel
- Filter state is session-only (not persisted)

## UI Layout

In the clip selector modal header, alongside existing rating/tag filters:

```
+------------------------------------------+
|  Select Clips for Reel                   |
|  [My Athlete v] [Rating: All v] [Tags v] |
|                                          |
|  [Clip 1: Quick Goal !!!!!]             |
|  [Clip 2: Great Save !!!]               |
|  ...                                     |
+------------------------------------------+
```

## Test Scope

- Frontend unit test for filter toggle rendering and state
- Backend unit test for `my_athlete` query parameter filtering
- E2E: create clips with mixed my_athlete values, verify filter works in reel creation

## Files Affected

- `src/frontend/src/components/GameClipSelectorModal.jsx` (or equivalent) -- add filter
- `src/backend/app/routers/games.py` -- accept `my_athlete` query param on clips endpoint

## Estimate

~60 LOC frontend, ~20 LOC backend, ~40 LOC tests
