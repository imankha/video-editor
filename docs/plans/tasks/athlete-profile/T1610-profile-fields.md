# T1610: Profile Fields — Athlete Name, Team Name, Sport

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-20
**Updated:** 2026-04-20

## Problem

Profiles only store `name` and `color`. There's no way to record the athlete's
real name, their team, or what sport they play. This data is needed for
downstream features (overlays, quest copy, sport-specific tags).

## Solution

Add three fields to the profile:

1. **athlete_name** (TEXT, nullable) -- the athlete's display name
2. **team_name** (TEXT, nullable) -- the team they play for
3. **sport** (TEXT, NOT NULL, default 'soccer') -- enum: soccer, american_football,
   basketball, lacrosse, rugby

### Backend

- Add columns to the `profiles` table in `user.sqlite` (via migration script)
- Add/update API endpoints in `profiles.py` to accept and return the new fields
- Existing profiles default to sport='soccer'

### Frontend

- Profile settings UI: text inputs for athlete name and team name
- Sport dropdown with five options: Soccer, American Football, Basketball,
  Lacrosse, Rugby
- Store sport in profileStore for downstream consumption

## Relevant Files

- `src/backend/app/services/user_db.py` -- profile schema, CRUD queries
- `src/backend/app/routers/profiles.py` -- profile API endpoints
- `src/frontend/src/stores/profileStore.js` -- Zustand profile store
- Profile UI components (to be identified)

## Acceptance Criteria

- [ ] `profiles` table has athlete_name, team_name, sport columns
- [ ] Migration script backfills existing profiles with sport='soccer'
- [ ] API returns and accepts all three new fields
- [ ] Frontend UI allows editing all three fields
- [ ] Sport dropdown shows all five options
- [ ] Existing profiles work without changes (backward compatible)
