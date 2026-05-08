# T1610 Kickoff: Profile Fields -- Athlete Nickname, Team Name, Sport

## What You're Building

Add three fields to user profiles: **nickname** (the athlete's display name), **team name**, and **sport**. Sport drives which annotation tags are available (wired up in T1630, not this task). This task adds the fields, API support, and UI.

Read CLAUDE.md before starting -- it has task classification rules, workflow stages, coding standards, and commit requirements you must follow.

## Epic Context

This is task 1 of 3 in the Athlete Profile epic (`docs/plans/tasks/athlete-profile/EPIC.md`). T1605 already created a `tagRegistry.js` that decouples the tag system from hardcoded soccer -- sport selection here will feed into that registry in T1630.

The task file is at `docs/plans/tasks/athlete-profile/T1610-profile-fields.md`.

## Key Design Decisions (Already Made)

- **Nickname, not first/last name.** Single `athlete_name` TEXT field, labeled "Nickname" in the UI. Avoids collecting unnecessary PII.
- **Sport is free-text, NOT an enum.** Stored as TEXT in the DB. The UI shows a combobox dropdown with 6 supported sports, but users can type any sport name.
- **Default sport is 'soccer'** for new profiles and existing profiles (backfill).
- **Supported sports** (appear in dropdown): Soccer, Flag Football, American Football, Basketball, Lacrosse, Rugby.
- **Both new fields (nickname, team) are nullable.** Sport is NOT NULL with default 'soccer'.

## Current Implementation (What Exists Today)

### Database Schema (`src/backend/app/services/user_db.py`)

The profiles table in `_USER_DB_SCHEMA` (line 78):
```sql
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,          -- profile display name (e.g., "Jordan")
    color TEXT NOT NULL,         -- profile color hex
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
```

Profile CRUD functions (all use `get_user_db_connection(user_id)` context manager):
- `get_profiles(user_id)` (line 643) -- SELECT id, name, color, is_default, created_at
- `create_profile(user_id, profile_id, name, color, is_default=False)` (line 751)
- `update_profile(user_id, profile_id, name=None, color=None)` (line 762) -- partial update pattern
- `delete_profile(user_id, profile_id)` (line 772)
- `set_default_profile(user_id, profile_id)` (line 780)

### API Endpoints (`src/backend/app/routers/profiles.py`)

Pydantic models (line 49):
```python
class CreateProfileRequest(BaseModel):
    name: str
    color: str

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
```

Endpoints:
- `GET /api/profiles` (line 67) -- returns `{"profiles": [{id, name, color, isDefault, isCurrent}]}`
- `POST /api/profiles` (line 89) -- creates profile, auto-switches to it
- `PUT /api/profiles/{id}` (line 147) -- updates name/color, duplicate name check
- `PUT /api/profiles/current` (line 121) -- switches active profile
- `DELETE /api/profiles/{id}` (line 180) -- deletes profile + data

Note: Response uses **camelCase** (`isDefault`, `isCurrent`) while DB uses **snake_case** (`is_default`). Follow this pattern for new fields: store as `athlete_name` in DB, return as `athleteName` in API responses.

### Frontend Store (`src/frontend/src/stores/profileStore.js`)

Zustand store. State shape:
```javascript
{ profiles: [], currentProfileId: null, isLoading: false, isInitialized: false, error: null }
```

Actions call API then refetch: `createProfile(name, color)`, `updateProfile(profileId, updates)`, `deleteProfile(profileId)`, `switchProfile(profileId)`, `fetchProfiles()`.

The store sends `updates` as a plain object to `PUT /api/profiles/{id}` -- adding new fields to `UpdateProfileRequest` on the backend is sufficient; the store already forwards whatever object it receives.

### Frontend UI (`src/frontend/src/components/ManageProfilesModal.jsx`)

`ProfileForm` component (line 56) handles both add and edit. Props:
```javascript
{ title, initialName, initialColor, usedColors, existingNames, onSubmit, onCancel, submitLabel }
```

Currently has two fields: name (text input) and color (color selector circles). The `onSubmit` callback receives `(name, color)`.

The modal has three modes: `'list'` (profile cards), `'add'` (ProfileForm), `'edit'` (ProfileForm).

### Tag Registry (`src/frontend/src/modes/annotate/constants/tagRegistry.js`)

Already exports `DEFAULT_SPORT = 'soccer'`. The supported sports list should be defined here (or co-located) so T1630 can reference it. Currently only has soccer in `TAG_SETS`.

### Migration Pattern (`scripts/migrate-schema.py`)

Add columns to the `MIGRATIONS` list between the markers:
```python
# PENDING_MIGRATIONS_START
MIGRATIONS = [
    ("profiles", "athlete_name TEXT"),
    ("profiles", "team_name TEXT"),
    ("profiles", "sport TEXT NOT NULL DEFAULT 'soccer'"),
]
# PENDING_MIGRATIONS_END
```

The script iterates user DBs (R2 + local) and runs `ALTER TABLE {table} ADD COLUMN {col_def}`. It catches `OperationalError` for idempotency (column already exists).

**Also update `_USER_DB_SCHEMA` in `user_db.py`** so new user databases get the columns on creation.

## Implementation Plan

### Backend

1. **Schema** -- Add 3 columns to `_USER_DB_SCHEMA` profiles table in `user_db.py` (line 78):
   - `athlete_name TEXT` (nullable)
   - `team_name TEXT` (nullable)
   - `sport TEXT NOT NULL DEFAULT 'soccer'`

2. **Migration** -- Add 3 entries to `MIGRATIONS` in `scripts/migrate-schema.py`

3. **CRUD functions** in `user_db.py`:
   - `get_profiles()` -- add new columns to SELECT
   - `create_profile()` -- accept `athlete_name=None, team_name=None, sport='soccer'` params, include in INSERT
   - `update_profile()` -- accept `athlete_name`, `team_name`, `sport` as optional params, same partial-update pattern

4. **API models** in `profiles.py`:
   - `CreateProfileRequest` -- add optional `athleteName`, `teamName`, `sport` fields
   - `UpdateProfileRequest` -- add optional `athleteName`, `teamName`, `sport` fields
   - List endpoint response -- add `athleteName`, `teamName`, `sport` to each profile dict
   - Create/update responses -- include new fields

5. **Import check** -- Run `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"` after changes

### Frontend

6. **Supported sports constant** -- Define `SUPPORTED_SPORTS` list somewhere accessible (e.g., in `tagRegistry.js` or a shared constants file):
   ```javascript
   export const SUPPORTED_SPORTS = [
     { id: 'soccer', name: 'Soccer' },
     { id: 'flag_football', name: 'Flag Football' },
     { id: 'american_football', name: 'American Football' },
     { id: 'basketball', name: 'Basketball' },
     { id: 'lacrosse', name: 'Lacrosse' },
     { id: 'rugby', name: 'Rugby' },
   ];
   ```

7. **ProfileForm** in `ManageProfilesModal.jsx`:
   - Add "Nickname" text input (optional, placeholder "e.g. Lightning")
   - Add "Team Name" text input (optional, placeholder "e.g. FC United")
   - Add "Sport" combobox -- dropdown of SUPPORTED_SPORTS with ability to type a custom sport. Default to "Soccer" for new profiles.
   - Update `onSubmit` to pass all fields: `onSubmit(name, color, athleteName, teamName, sport)`
   - Update `initialName`-style props for new fields when editing

8. **Store** -- `profileStore.js` doesn't need structural changes. The `createProfile` and `updateProfile` actions already forward objects to the API. Just update `createProfile(name, color)` call sites to include new fields. The profile objects returned by `fetchProfiles` will automatically include the new fields since they come from the API response.

9. **ManageProfilesModal** handlers:
   - `handleAddProfile` -- pass new fields to `createProfile`
   - `handleEditProfile` -- pass new fields to `updateProfile`
   - Profile list cards in `'list'` mode -- optionally show nickname/team if set

### Sport Combobox UX

The sport selector should be a combobox (not a plain dropdown):
- Shows the 6 supported sports as selectable options
- User can also type a custom sport name in the input
- Typing filters the dropdown list
- Selecting from dropdown or typing + blur/enter sets the value
- This can be built with a text input + datalist, or a custom combobox component
- Consider using an HTML `<input>` with a `<datalist>` element for simplicity

## What NOT to Do

- Don't wire sport to the tag system yet -- that's T1630
- Don't add a DB table for tags -- tags stay as static JS files
- Don't add reactive persistence (useEffect watching state to write) -- all saves are gesture-based (user clicks Save)
- Don't add console.logs in committed code
- Don't use localStorage -- all persistence via SQLite + R2
- Don't create a separate settings page -- the fields go in the existing ProfileForm

## Acceptance Criteria

- [ ] `profiles` table has athlete_name, team_name, sport columns
- [ ] `_USER_DB_SCHEMA` updated for new user databases
- [ ] Migration entries added to `scripts/migrate-schema.py`
- [ ] API returns and accepts `athleteName`, `teamName`, `sport` (camelCase)
- [ ] Existing profiles get sport='soccer' via migration default
- [ ] Frontend ProfileForm shows Nickname, Team Name, and Sport fields
- [ ] Sport combobox lists 6 supported sports + allows custom text entry
- [ ] New profiles default to Soccer
- [ ] Editing a profile preserves all fields
- [ ] Backend import check passes: `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`
- [ ] Frontend build passes: `cd src/frontend && npx vite build --mode development`
- [ ] Existing frontend tests pass: `cd src/frontend && npx vitest run`

## Test Plan

1. Start dev servers (`npm run dev` + `uvicorn app.main:app --reload`)
2. Open Manage Profiles modal
3. Edit existing profile -- verify Nickname and Team Name are empty, Sport shows "Soccer"
4. Set nickname to "Lightning", team to "FC United", sport to "Basketball" -- save
5. Reopen edit -- verify all three fields persisted
6. Create a new profile -- verify Sport defaults to Soccer
7. Edit the new profile, type a custom sport "Water Polo" -- save and verify it persists
8. Switch between profiles -- verify fields are independent per profile
