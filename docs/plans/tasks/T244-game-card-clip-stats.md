# T244: Game Card Clip Statistics

**Status:** DONE
**Impact:** 5
**Complexity:** 1
**Created:** 2026-02-17
**Updated:** 2026-02-27

## Problem

Game cards in the ProjectManager currently only show total clip count and date. Users have no at-a-glance view of clip quality distribution.

## Solution

Display clip rating breakdown on each game card using data the API already returns:
- Brilliant count (5-star clips) with `!!` notation
- Good count (4-star clips) with `!` notation
- Total clip count
- Composite score using user-specified weights:
  - 1-star = -2
  - 2-star = -1
  - 3-star = 0
  - 4-star = +2
  - 5-star = +3

**No backend changes needed** — `GET /api/games` already returns `brilliant_count`, `good_count`, `interesting_count`, `mistake_count`, `blunder_count`, `aggregate_score`. The frontend GameCard ignores all of these except `clip_count`.

## Context

### Relevant Files

- `src/frontend/src/components/ProjectManager.jsx:1062-1106` - GameCard component (currently shows only `clip_count` + date)
- `src/frontend/src/components/shared/clipConstants.js` - `RATING_NOTATION`, `RATING_BADGE_COLORS`, `getRatingDisplay()` helper
- `src/frontend/src/stores/gamesDataStore.js` - Store already holds all aggregate fields

### Related Tasks
- Split from original T244 (clip stats + view progress)
- T251: Game View Progress Tracking (the other half)

### Technical Notes
- Composite score computed on frontend from per-rating counts: `brilliant*3 + good*2 + interesting*0 + mistake*(-1) + blunder*(-2)`. No backend change needed.
- Badge patterns to follow: see `ProjectCard` in `ProjectManager.jsx:1366-1374` (Star icon, CheckCircle icon patterns)

## Implementation

### Steps
1. [ ] **Display clip stats on GameCard** - Use the already-returned `brilliant_count`, `good_count`, `clip_count` from the API
2. [ ] **Add composite score display** - Small badge or number showing the score

## Acceptance Criteria

- [ ] Game cards show brilliant count (!! badge) and good count (! badge)
- [ ] Game cards show composite score with the specified weights
- [ ] No backend changes needed (use existing data)
- [ ] Tests pass
