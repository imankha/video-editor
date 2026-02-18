# T244: Game Card Clip Statistics & View Progress

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

Game cards in the ProjectManager currently only show total clip count and date. Users have no at-a-glance view of clip quality distribution or whether they've reviewed a game's footage.

## Solution

Add two features to game cards:

### 1. Clip Statistics (data already available)

Display on each game card:
- Brilliant count (5-star clips) with `!!` notation
- Good count (4-star clips) with `!` notation
- Total clip count
- Composite score using user-specified weights:
  - 1-star = -2
  - 2-star = -1
  - 3-star = 0
  - 4-star = +2
  - 5-star = +3

**Note:** The backend currently uses a different scoring formula (5=10, 4=5, 3=2, 2=-2, 1=-5). Either:
- Add a new `composite_score` field with the user's formula, OR
- Compute the composite score on the frontend from the per-rating counts (preferred - no backend change)

### 2. View Progress Indicator (new feature)

Show whether a game has been:
- **Not viewed** - Never opened in annotate mode
- **Partially viewed** - Opened but not all footage reviewed (show percentage)
- **Fully viewed** - All footage has been reviewed

This requires tracking how much of the game video the user has watched/scrubbed through in annotate mode.

## Context

### Relevant Files

**Frontend (clip stats - no changes needed to backend):**
- `src/frontend/src/components/ProjectManager.jsx:1049-1093` - GameCard component (currently shows only `clip_count` + date)
- `src/frontend/src/components/shared/clipConstants.js` - `RATING_NOTATION`, `RATING_BADGE_COLORS`, `getRatingDisplay()` helper
- `src/frontend/src/hooks/useGames.js` - `fetchGames()` calls `GET /api/games`, returns full aggregate data

**Frontend (view progress - new tracking):**
- `src/frontend/src/screens/AnnotateScreen.jsx:107-114` - `handleBackToProjects()` calls `finishAnnotation()`
- `src/frontend/src/modes/annotate/AnnotateContainer.jsx:844-857` - Debounced auto-save pattern (500ms)
- `src/frontend/src/hooks/useVideo.js:371-401` - RAF-based currentTime tracking during playback
- `src/frontend/src/hooks/useGames.js:315-330` - `saveAnnotationsDebounced` pattern to follow

**Backend:**
- `src/backend/app/routers/games.py:428-482` - `list_games()` already returns all aggregate counts
- `src/backend/app/routers/games.py:921-939` - `finish-annotation` endpoint (currently a no-op, good place to persist view progress)
- `src/backend/app/database.py:529-553` - Games table schema (needs `viewed_duration` column)
- `src/backend/app/constants.py` - `RATING_ADJECTIVES`, `RATING_NOTATION` mappings

### Backend Data Already Available
The `GET /api/games` endpoint already returns per-game:
- `clip_count`, `brilliant_count`, `good_count`, `interesting_count`, `mistake_count`, `blunder_count`, `aggregate_score`

The frontend `GameCard` currently ignores all of these except `clip_count`.

The `GET /api/games` endpoint does NOT currently return `video_duration` (needed for view % calculation). The detail endpoint `GET /api/games/{id}` does return it.

### View Progress - New Tracking Needed
No watch progress tracking exists. Recommended approach:
- Add `viewed_duration REAL DEFAULT 0` column to games table
- Track high-water mark of `currentTime` in annotate mode (from `useVideo` hook RAF loop)
- Send debounced updates following the existing `saveAnnotationsDebounced` pattern (500ms)
- Either extend the `finish-annotation` endpoint (currently a no-op) or add a new `PUT /api/games/{id}/view-progress` endpoint
- Add `video_duration` to `list_games()` response so frontend can compute percentage
- Frontend computes: `viewedPercent = (viewed_duration / video_duration) * 100`

### Related Tasks
- None

### Technical Notes
- Composite score computed on frontend from per-rating counts: `brilliant*3 + good*2 + interesting*0 + mistake*(-1) + blunder*(-2)`. No backend change needed.
- View progress tracking follows the existing debounce pattern in `useGames.js:315-330`
- `last_accessed_at` exists on games table but only tracks "was opened", not "how much was viewed"
- For multi-video games (T82), `video_duration` is the sum of all video durations (already computed in `AnnotateContainer.jsx:203-204`)
- Badge patterns to follow: see `ProjectCard` in `ProjectManager.jsx:1366-1374` (Star icon, CheckCircle icon patterns)

## Implementation

### Steps
1. [ ] **Frontend: Display clip stats on GameCard** - Use the already-returned `brilliant_count`, `good_count`, `clip_count` from the API. Compute composite score client-side.
2. [ ] **Frontend: Add composite score display** - Small badge or number showing the score (formula: 5-star=+3, 4-star=+2, 3-star=0, 2-star=-1, 1-star=-2)
3. [ ] **Backend: Add `viewed_duration` column to games table** - Track high-water mark of video watched
4. [ ] **Backend: Add endpoint or extend existing to update viewed_duration** - Called from annotate mode as user plays/scrubs video
5. [ ] **Frontend: Send view progress updates from annotate mode** - Debounced updates as user watches video
6. [ ] **Frontend: Display view progress indicator on GameCard** - Not viewed / Partially (X%) / Fully viewed

## Acceptance Criteria

- [ ] Game cards show brilliant count (!! badge) and good count (! badge)
- [ ] Game cards show composite score with the specified weights
- [ ] Game cards show view progress (not viewed / partial % / fully viewed)
- [ ] View progress updates as user watches game in annotate mode
- [ ] No backend changes needed for clip stats (use existing data)
- [ ] Tests pass
