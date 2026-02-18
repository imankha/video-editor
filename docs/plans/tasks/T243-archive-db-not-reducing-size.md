# T243: Archive Database Not Reducing Main DB Size

**Status:** TESTING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-02-17
**Updated:** 2026-02-18

## Problem

The database sync is slow (0.5-0.6s per request) and the main database has grown to 776KB, approaching the 1MB migration threshold.

```
[SLOW DB SYNC] PUT /api/clips/raw/278 - sync took 0.61s (threshold: 0.5s)
Database size notice: 776.0KB - approaching 1MB migration threshold
```

We implemented an archive system (T66: Database Completed Projects Split) that was supposed to:
- Move completed projects to an "archive" R2 folder/database
- Keep the main DB under 400KB
- Reduce sync times

**The archive system is not working as expected.** Either:
1. Projects aren't being moved to archive when completed
2. The archive trigger conditions aren't being met
3. The archive logic has a bug
4. Something else is contributing to DB size growth

## Solution

Investigate why the archive system isn't keeping the main DB small:

1. Verify archive migration is being triggered
2. Check what's taking up space in the main DB
3. Fix whatever is preventing proper archival
4. **Update logging** - remove outdated "migration threshold" messages since migration is complete

## Context

### Relevant Files
- `src/backend/app/database.py` - DB models and archive logic
- `src/backend/app/middleware/db_sync.py` - Sync middleware with size warnings
- `src/backend/app/storage.py` - R2 storage including archive folder

### Related Tasks
- Related to: T66 (Database Completed Projects Split) - the original implementation

### Technical Notes
- Archive was implemented to solve this exact problem
- Need to check: when does archive trigger? What conditions?
- May need to manually inspect what's in the main DB vs archive
- Consider: are games/clips being archived, or just projects?

## Investigation Steps

1. [x] Check T66 implementation - what triggers archive migration?
2. [x] Verify if any projects have been archived (check R2 archive folder)
3. [x] Analyze main DB contents - what's taking up 776KB?
4. [x] Check if archive conditions are being met for completed projects
5. [x] Fix the root cause
6. [x] Remove outdated "migration threshold" log messages (migration already done)

### Progress Log

**2026-02-18:** Investigation complete. Root cause identified:

The T66 archive system works correctly for completed projects, but the DB bloat comes from two sources unrelated to archiving:

| Source | Size | % of DB | Root Cause |
|--------|------|---------|------------|
| `working_videos.highlights_data` | 436 KB | 55% | 19 old versions kept for project #64 (only latest needed) |
| `export_jobs.input_data` | 66 KB | 8% | 198 completed/error jobs never cleaned up |
| SQLite overhead | 216 KB | 27% | Proportional to data size |

The 2 active projects (#42, #64) have never been exported (`final_video_id = None`), so the archive trigger (overlay export completion) never fires for them. The real fix is pruning accumulated data.

**Fix implemented:**
- `cleanup_database_bloat()` in `project_archive.py`: Prunes old working_video versions (keep latest per project) and export_jobs older than 7 days
- Called on app startup from `ensure_database()` alongside existing stale project cleanup
- Updated `check_database_size()` to remove outdated "Durable Objects migration" messages

## Acceptance Criteria

- [x] Understand why archive isn't reducing main DB size
- [ ] Main DB stays under 400KB with normal usage
- [ ] Sync times back under 0.5s threshold
- [x] Completed projects properly move to archive (T66 works correctly)
- [x] No more "migration threshold" log messages (outdated)
