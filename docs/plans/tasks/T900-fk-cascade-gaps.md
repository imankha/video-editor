# T900: FK Cascade Gaps

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-02

## Problem

Several foreign keys in the SQLite schema lack ON DELETE CASCADE/SET NULL, requiring manual DELETE statements in route handlers. This is fragile — any new delete path that forgets the manual cleanup creates orphaned records.

## Missing Cascades

| Table.Column | References | Current | Should Be | Risk |
|-------------|-----------|---------|-----------|------|
| `working_clips.project_id` | projects(id) | NONE | CASCADE | Orphaned working_clips on project delete |
| `working_clips.raw_clip_id` | raw_clips(id) | NONE | CASCADE | Orphaned working_clips on clip delete |
| `working_videos.project_id` | projects(id) | NONE | CASCADE | Orphaned working_videos on project delete |
| `projects.working_video_id` | working_videos(id) | NONE | SET NULL | FK violation on working_video delete |
| `projects.final_video_id` | final_videos(id) | NONE | SET NULL | FK violation on final_video delete |

## Already Correct

| Table.Column | References | Cascade |
|-------------|-----------|---------|
| `raw_clips.game_id` | games(id) | CASCADE |
| `raw_clips.auto_project_id` | projects(id) | SET NULL |
| `export_jobs.project_id` | projects(id) | CASCADE |
| `before_after_tracks.final_video_id` | final_videos(id) | CASCADE |
| `modal_tasks.raw_clip_id` | raw_clips(id) | CASCADE |
| `modal_tasks.project_id` | projects(id) | CASCADE |
| `modal_tasks.game_id` | games(id) | CASCADE |
| `game_videos.game_id` | games(id) | CASCADE |

## Solution

SQLite doesn't support ALTER TABLE to add/modify foreign key constraints. The fix requires:

1. **Migration approach**: Create new table with correct FKs, copy data, drop old, rename new
2. **Add migrations** to `database.py` migration section (lines 673-771)
3. **Simplify delete handlers** in `games.py`, `clips.py`, `projects.py` — remove manual DELETEs that cascades now handle
4. **Remove dead DELETE** — `games.py` deletes from `ratings` table which doesn't exist in schema
5. **Update FK cascade tests** in `tests/test_fk_cascades.py`

## Relevant Files

- `src/backend/app/database.py` — Lines 494-992: schema definitions, Lines 673-771: migrations
- `src/backend/app/routers/games.py` — Lines 694-713: manual cascade DELETE
- `src/backend/app/routers/clips.py` — Lines 658-688: `_delete_auto_project()`, Lines 960-975: clip deletion
- `src/backend/app/routers/projects.py` — Lines 823-850: project deletion
- `src/backend/tests/test_fk_cascades.py` — Existing cascade tests

## Acceptance Criteria

- [ ] All 5 missing cascade/set-null constraints added via migration
- [ ] Manual DELETE loops simplified to rely on cascades
- [ ] Dead `ratings` DELETE removed
- [ ] FK cascade tests updated to cover all relationships
- [ ] Existing E2E tests still pass (cascades should be backward-compatible)
