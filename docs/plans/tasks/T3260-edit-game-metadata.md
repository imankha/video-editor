# T3260: Edit Game Metadata Post-Upload

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-06-01
**Updated:** 2026-06-01

## Problem

Once a game is uploaded, there is no way to change its date, title, or other metadata. Users who enter the wrong date or want to update the title are stuck with the original values.

## Solution

Add an edit capability to game cards (or game detail view) that allows users to modify game metadata after upload. At minimum: date, title. Stretch: any other game-level fields (e.g., opponent, location if added later).

## Context

### Relevant Files
- `src/frontend/src/components/GameCard.jsx` - Game card UI (add edit trigger)
- `src/frontend/src/stores/gamesDataStore.js` - Games state management
- `src/backend/app/routers/games.py` - Games API endpoints (add PATCH/PUT endpoint)
- `src/backend/app/services/user_db.py` - SQLite game schema

### Related Tasks
- None

### Technical Notes
- Backend needs a PATCH endpoint for game metadata updates
- Frontend needs an edit UI (inline edit or modal)
- Must persist via gesture (edit confirm button), not reactively
- Date changes should update any derived display (game cards, clip labels)

## Acceptance Criteria

- [ ] User can edit game date after upload
- [ ] User can edit game title after upload
- [ ] Changes persist across page reload
- [ ] Changes reflect in all views that display game info
