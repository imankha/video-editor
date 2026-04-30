# T2110: Player Profile Data Model

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

Parents must re-enter their kid's name and jersey number for every reel. This is the highest-friction point for repeat usage. The spec identifies Player Profile as the "highest-leverage piece for retention -- once a parent has set up their kid, the next reel is one click instead of three."

## Solution

Account-level player profiles stored as JSON blobs, reusable across all reels.

1. **Data model** -- `player_profiles` table in user DB: id, name, jersey_number, team_name, team_color, position, created_at, updated_at
2. **CRUD API** -- endpoints to create/read/update/delete profiles
3. **Profile selector UI** -- when adding a player label overlay, pick from saved profiles or create new
4. **Persistence** -- profiles sync to R2 with the user's DB (existing sync infrastructure)

### Schema

```sql
CREATE TABLE player_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    jersey_number TEXT,
    team_name TEXT,
    team_color TEXT DEFAULT '#ffffff',
    position TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

## Context

### Relevant Files
- `src/backend/app/storage/` -- DB operations
- `src/backend/app/routers/` -- API endpoints
- `src/frontend/src/stores/` -- Zustand stores
- Athlete Profile Epic (tasks/athlete-profile/) -- related but separate; that epic covers sport-specific tags. This task covers overlay-specific player identity.

### Related Tasks
- Depends on: None (can be built independently)
- Blocks: T2130 (player label uses profile data)
- Related: T1610 (Athlete Profile Fields) -- may share or extend the same DB table

### Technical Notes
- Consider whether this merges with the Athlete Profile epic (T1610). If T1610 lands first, extend that table with team_color. If this lands first, T1610 extends this table with sport.
- Profile data is account-level, not per-reel or per-clip.
- Nice-to-have: OCR on jersey numbers from YOLO bbox to auto-suggest number during profile setup.

## Acceptance Criteria

- [ ] player_profiles table created with migration
- [ ] CRUD API endpoints for profiles
- [ ] Frontend profile management UI (create/edit/delete)
- [ ] Profile selector available when adding player overlays
- [ ] Profiles persist across sessions and reels
