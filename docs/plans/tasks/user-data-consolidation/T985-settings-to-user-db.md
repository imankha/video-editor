# T985: Move Settings from Profile DB to User DB

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-04-03
**Updated:** 2026-04-03

## Problem

User preferences (framing aspect ratio, audio toggle, overlay effect type, project filters) are stored in the per-profile `database.sqlite` `user_settings` table. This means:

- Switching profiles loads different settings
- Deleting a profile permanently loses those settings
- New profiles start with defaults instead of the user's established preferences

These are global user preferences, not profile-specific data.

### Expected Behavior
Settings persist across all profiles. Changing a preference on Profile A is reflected on Profile B.

### Actual Behavior
Each profile has its own independent `user_settings` row with a `settings_json` TEXT column. Settings don't carry over on profile switch.

## Current State

**Profile DB** (`database.sqlite`) has:
```sql
CREATE TABLE user_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  settings_json TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Settings JSON structure:**
```json
{
  "projectFilters": {"statusFilter": "uncompleted", "aspectFilter": "all", ...},
  "framing": {"includeAudio": true, "defaultAspectRatio": "9:16", ...},
  "overlay": {"highlightEffectType": "original"}
}
```

**Endpoints:** `GET /api/settings`, `PUT /api/settings`, `DELETE /api/settings`

**User DB** (`user.sqlite`) already has a `user_settings` table with key-value pairs (used for `selected_profile`). Can extend this or add a dedicated `preferences` table.

## Solution

1. Add a `preferences` key to the existing `user.sqlite` `user_settings` table (key='preferences', value=settings_json) — reuses existing key-value infrastructure
2. Update `GET /api/settings` to read from user.sqlite
3. Update `PUT /api/settings` to write to user.sqlite
4. Migration: on first access, if user.sqlite has no preferences, copy from active profile's database.sqlite (one-time, idempotent)
5. Remove `user_settings` table from profile database.sqlite schema (or leave as deprecated)

## Context

### Relevant Files
- `src/backend/app/routers/settings.py` (or wherever `/api/settings` is defined) — settings endpoints
- `src/backend/app/services/user_db.py` — user.sqlite operations
- `src/backend/app/database.py` — profile DB schema (current settings location)
- `src/frontend/src/stores/` — any settings store (frontend unchanged, just reads from same API)

### Related Tasks
- T960: Profiles to User DB (sibling — same epic)
- T970: User-Scoped Quest Achievements (sibling — same pattern)
