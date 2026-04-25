# T1860: Reel Creation Player Filter

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

Reel creation (`GameClipSelectorModal`) filters by game, rating, and play type tags — but not by player. Once users tag clips with athletes, they need to filter by player when building a highlight reel. Currently all clips are implicitly "mine" so there's no need, but with player tagging a user may have clips tagged to multiple athletes.

## Solution

Add a "Player" filter to `GameClipSelectorModal`. Pre-selects the current user's athlete by default. User can change the selection to filter clips by any tagged player. OR logic: clips matching ANY selected player are included.

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- `src/frontend/src/components/GameClipSelectorModal.jsx` — Add player filter UI
- `src/frontend/src/stores/profileStore.js` — Current user's athlete email for default

**Backend:**
- `src/backend/app/routers/projects.py` — Update `ProjectFromClipsCreate` model and preview/creation queries to accept player email filter
- `src/backend/app/routers/clips.py` — Update clip list query to support player tag filtering

### Related Tasks
- Depends on: T1810 (player tag data model — clips must have player tags to filter by)

### Technical Notes

**Filter UI:**
- New section in GameClipSelectorModal: "Player" (below rating, above/beside play type tags)
- Default: current user's email pre-selected as a chip
- User can remove self, add other emails (from autocomplete or free-type)
- OR logic: clip included if tagged with ANY selected player
- Empty selection = no player filter (all clips, backward compatible)

**Backend query change:**
```sql
-- Current: filter by game + rating + play type tags
-- New: add JOIN to clip_player_tags
SELECT rc.* FROM raw_clips rc
JOIN clip_player_tags cpt ON cpt.raw_clip_id = rc.id
WHERE cpt.recipient_email IN (?, ?, ...)
  AND rc.rating >= ?
  AND ... (existing tag/game filters)
```

**Preview endpoint** (`POST /api/projects/preview-clips`):
- Add optional `player_emails: [str]` field to request body
- When provided, JOIN clip_player_tags and filter
- When empty/null, no player filter (backward compatible)

**Project creation** (`POST /api/projects/from-clips`):
- Same: accept optional `player_emails` in filter

## Implementation

### Steps
1. [ ] Backend: Add `player_emails` filter to preview-clips and from-clips endpoints
2. [ ] Backend: Update clip query to JOIN clip_player_tags when player filter provided
3. [ ] Frontend: Add "Player" filter section to GameClipSelectorModal
4. [ ] Frontend: Pre-select current user's email, allow add/remove
5. [ ] Frontend: Wire filter to preview endpoint for real-time clip count
6. [ ] Backward compatibility: no player filter = all clips (no breaking change)

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] "Player" filter visible in GameClipSelectorModal
- [ ] Current user's athlete pre-selected by default
- [ ] Can add/remove players from filter
- [ ] Clip count updates in real-time as player filter changes
- [ ] Created reel contains only clips matching selected players
- [ ] Empty player filter = all clips (backward compatible)
- [ ] Works with existing rating and play type tag filters (AND across filter types, OR within players)
