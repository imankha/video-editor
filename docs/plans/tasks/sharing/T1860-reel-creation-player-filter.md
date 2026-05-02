# T1860: Reel Creation Teammate Filter

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-05-02

## Problem

Reel creation (`GameClipSelectorModal`) filters by game, rating, and play type tags — but not by athlete type. Once users mark clips as "My Athlete" or "Teammate" (T1820), they need to filter by this distinction when building a highlight reel. Without filtering, teammate clips mix with their own athlete's clips.

## Solution

Add a "Player" filter to `GameClipSelectorModal` with options: "All", "My Athlete", "Teammate". Defaults to "My Athlete" so reels naturally contain the user's own athlete's clips unless they explicitly include teammates.

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- `src/frontend/src/components/GameClipSelectorModal.jsx` — Add player filter UI

**Backend:**
- `src/backend/app/routers/projects.py` — Update preview/creation queries to accept `is_teammate` filter
- `src/backend/app/routers/clips.py` — Already supports `is_teammate` filter from T1810

### Related Tasks
- Depends on: T1810 (is_teammate field on raw_clips)

### Technical Notes

**Filter UI:**
- New section in GameClipSelectorModal: segmented control or dropdown
- Options: "All" | "My Athlete" | "Teammate"
- Default: "My Athlete"
- Works alongside existing rating and play type tag filters (AND across filter types)

**Backend query change:**
```sql
-- Add WHERE clause when filter is not "All"
SELECT rc.* FROM raw_clips rc
WHERE rc.is_teammate = ?   -- 0 for "My Athlete", 1 for "Teammate"
  AND rc.rating >= ?
  AND ... (existing tag/game filters)
```

**Preview endpoint** (`POST /api/projects/preview-clips`):
- Add optional `is_teammate: bool | null` field to request body
- null = no filter (All), false = My Athlete, true = Teammate

## Implementation

### Steps
1. [ ] Frontend: Add "Player" filter to GameClipSelectorModal
2. [ ] Frontend: Default to "My Athlete", wire to preview endpoint
3. [ ] Backend: Add `is_teammate` filter to preview-clips and from-clips endpoints
4. [ ] Clip count updates in real-time as filter changes

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] "Player" filter visible in GameClipSelectorModal
- [ ] Defaults to "My Athlete"
- [ ] Can switch to "Teammate" or "All"
- [ ] Clip count updates in real-time as filter changes
- [ ] Created reel contains only clips matching the filter
- [ ] Works with existing rating and play type tag filters
