# T251: Game View Progress Tracking

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-02-27
**Updated:** 2026-02-27

## Problem

Users have no way to tell which games they've already reviewed and how much footage they've watched. Games they've fully annotated look identical to ones they've never opened.

## Solution

Track how much of a game's video the user has watched/scrubbed through in annotate mode, and display progress on the game card:
- **Not viewed** — Never opened in annotate mode
- **Partially viewed** — Opened but not all footage reviewed (show percentage)
- **Fully viewed** — All footage has been reviewed

## Context

### Relevant Files

**Backend:**
- `src/backend/app/database.py:549-573` — Games table schema (needs `viewed_duration` column)
- `src/backend/app/routers/games.py:921-939` — `finish-annotation` endpoint (currently a no-op, good place to persist view progress)
- `src/backend/app/routers/games.py:428-482` — `list_games()` needs to include `video_duration` in response

**Frontend:**
- `src/frontend/src/components/ProjectManager.jsx:1062-1106` — GameCard component (display progress indicator)
- `src/frontend/src/screens/AnnotateScreen.jsx:107-114` — `handleBackToProjects()` calls `finishAnnotation()`
- `src/frontend/src/modes/annotate/AnnotateContainer.jsx:844-857` — Debounced auto-save pattern (500ms)
- `src/frontend/src/hooks/useVideo.js:371-401` — RAF-based currentTime tracking during playback
- `src/frontend/src/stores/gamesDataStore.js` — Store for game data

### Existing Infrastructure
- `last_accessed_at` exists on games table but only tracks "was opened", not "how much was viewed"
- `finish-annotation` endpoint is a no-op — good place to persist final view progress
- `useVideo` hook already tracks `currentTime` via RAF loop during playback
- Debounced save pattern in `AnnotateContainer` can be followed for progress updates

### Related Tasks
- Split from original T244 (clip stats + view progress)
- T244: Game Card Clip Statistics (the other half)

### Technical Notes
- Add `viewed_duration REAL DEFAULT 0` column to games table
- Track high-water mark of `currentTime` in annotate mode (max of all positions reached)
- Send debounced updates following existing `saveAnnotationsDebounced` pattern (500ms)
- Either extend `finish-annotation` endpoint or add new `PUT /api/games/{id}/view-progress` endpoint
- Add `video_duration` to `list_games()` response so frontend can compute percentage
- Frontend computes: `viewedPercent = (viewed_duration / video_duration) * 100`
- For multi-video games (T82), `video_duration` is the sum of all video durations (already computed in `AnnotateContainer.jsx:203-204`)

## Implementation

### Steps
1. [ ] **Backend: Add `viewed_duration` column to games table** — Track high-water mark of video watched
2. [ ] **Backend: Add endpoint to update viewed_duration** — Extend `finish-annotation` or new endpoint
3. [ ] **Backend: Add `video_duration` to `list_games()` response** — Needed for percentage calculation
4. [ ] **Frontend: Track high-water mark in annotate mode** — Follow existing debounce pattern
5. [ ] **Frontend: Display view progress indicator on GameCard** — Not viewed / partial % / fully viewed

## Acceptance Criteria

- [ ] Game cards show view progress (not viewed / partial % / fully viewed)
- [ ] View progress updates as user watches/scrubs game in annotate mode
- [ ] Multi-video games track combined progress correctly
- [ ] Tests pass
