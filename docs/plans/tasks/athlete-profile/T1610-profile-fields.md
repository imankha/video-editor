# T1610: Profile Fields — Nickname, Team Name, Sport

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-20
**Updated:** 2026-05-08

## Problem

Profiles only store `name` and `color`. There's no way to record the athlete's
real name, their team, or what sport they play. This data is needed for
downstream features (overlays, quest copy, sport-specific tags).

## Solution

Add three fields to the profile:

1. **athlete_name** (TEXT, nullable) -- the athlete's nickname (not real name, avoids PII)
2. **team_name** (TEXT, nullable) -- the team they play for
3. **sport** (TEXT, NOT NULL, default 'soccer') -- free-text field, not an enum

### Backend

- Add columns to the `profiles` table in `user.sqlite` (via migration script)
- Add/update API endpoints in `profiles.py` to accept and return the new fields
- Existing profiles default to sport='soccer'

### Frontend

- Profile settings UI: text inputs for athlete name and team name
- Sport selector: combobox dropdown listing the six supported sports (Soccer,
  Flag Football, American Football, Basketball, Lacrosse, Rugby) with the
  ability to type any custom sport name
- Default selection is Soccer
- Sport is editable at any time from the profile settings
- Store sport in profileStore for downstream consumption

### Supported Sports (pre-canned tags)

These appear in the dropdown. Users can also type any other sport name.

1. Soccer (default)
2. Flag Football
3. American Football
4. Basketball
5. Lacrosse
6. Rugby

## Relevant Files

- `src/backend/app/services/user_db.py` -- profile schema, CRUD queries
- `src/backend/app/routers/profiles.py` -- profile API endpoints
- `src/frontend/src/stores/profileStore.js` -- Zustand profile store
- `src/frontend/src/components/ManageProfilesModal.jsx` -- profile UI

## Acceptance Criteria

- [ ] `profiles` table has athlete_name, team_name, sport columns
- [ ] Migration script backfills existing profiles with sport='soccer'
- [ ] API returns and accepts all three new fields
- [ ] Frontend UI allows editing all three fields
- [ ] Sport combobox shows six supported sports + allows custom text entry
- [ ] Existing profiles work without changes (backward compatible)
