# T86: Add Missing FK Cascades on raw_clips

**Status:** TESTING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

The `raw_clips` table has two foreign keys without `ON DELETE CASCADE`:

1. `game_id REFERENCES games(id)` - When a game is deleted, raw clips are NOT cleaned up, leaving orphaned records.
2. `auto_project_id REFERENCES projects(id)` - When an auto-created project is deleted, raw clips still reference it via stale `auto_project_id`.

Other tables in the schema correctly use cascades (e.g., `game_videos`, `export_jobs`, `modal_tasks`), so this is inconsistent.

## Solution

Add `ON DELETE CASCADE` to `raw_clips.game_id` and `ON DELETE SET NULL` to `raw_clips.auto_project_id` via schema migration.

- `game_id`: CASCADE - when a game is deleted, its clips should be deleted too
- `auto_project_id`: SET NULL - when an auto-project is deleted, the clip still exists but loses its project reference

## Context

### Relevant Files
- `src/backend/app/database.py:461-462` - raw_clips FK definitions
- `src/backend/app/routers/games.py:630-644` - delete_game (currently only deletes games row)
- `src/backend/app/routers/games.py:893-918` - _delete_auto_project_if_unmodified

### Technical Notes
- SQLite doesn't support `ALTER TABLE ... ALTER COLUMN` for FK changes
- Must recreate the table or add a migration that creates a new table with correct FKs and copies data
- The existing migration system uses `ALTER TABLE ADD COLUMN` statements in `database.py`
- Consider using SQLite's `PRAGMA foreign_keys = ON` to ensure enforcement (check if already enabled)

## Implementation

### Steps
1. [ ] Check if `PRAGMA foreign_keys = ON` is set in database.py
2. [ ] Add migration to recreate raw_clips with correct FK cascades
3. [ ] Verify delete_game properly cascades to raw_clips
4. [ ] Verify auto-project deletion sets auto_project_id to NULL
5. [ ] Run backend tests

## Acceptance Criteria

- [ ] `raw_clips.game_id` has `ON DELETE CASCADE`
- [ ] `raw_clips.auto_project_id` has `ON DELETE SET NULL`
- [ ] Deleting a game removes its raw clips
- [ ] Deleting an auto-project nulls the reference on raw clips
- [ ] Backend tests pass
