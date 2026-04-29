# T2030: archive_project Called Synchronously in publish_to_my_reels

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-04-29
**Updated:** 2026-04-29

## Problem

`publish_to_my_reels()` (downloads.py:837) calls `archive_project()` synchronously in the HTTP request handler — no `asyncio.to_thread()`. This blocks the FastAPI event loop for the entire duration of the archive operation (R2 upload + DB deletes), making the server unresponsive to all other requests.

This is a regression from commit 9e58feb0 ("Move archive trigger from export to Move To My Reels"). The old `export_final()` path used `await asyncio.to_thread(archive_project, ...)`, but when the call was moved to `publish_to_my_reels`, the threading wrapper was dropped.

### Current code (downloads.py:837)
```python
archive_project(project_id, user_id)  # blocks event loop
return {"success": True, "final_video_id": row['id']}
```

### Old code (overlay.py, removed in 9e58feb0)
```python
await asyncio.to_thread(archive_project, project_id, user_id)  # non-blocking
```

### Additional issue: return value ignored

`archive_project()` returns `False` on failure and logs the error, but the caller ignores the return value. The HTTP response always says `{"success": True}` even if archiving failed. The user gets no indication that their working data wasn't archived.

## Fix

1. **Wrap in `asyncio.to_thread()`** — restore the threading that existed in the old code path:
   ```python
   await asyncio.to_thread(archive_project, project_id, user_id)
   ```

2. **Check return value** — if archive fails, still return success for the publish (published_at is already committed), but log a warning and consider notifying the user.

Note: Even with `to_thread`, VACUUM still acquires an exclusive DB lock that blocks other connections. T2010 handles removing VACUUM from archive_project. This task specifically fixes the event loop blocking from the synchronous R2 upload + DB operations.

## Context

### Relevant Files
- `src/backend/app/routers/downloads.py:807-839` — publish_to_my_reels handler
- `src/backend/app/services/project_archive.py:58-153` — archive_project function
- `src/backend/app/routers/export/overlay.py` — old call site (removed in 9e58feb0)

### Related Tasks
- T2010 (VACUUM blocks server) — removes VACUUM from archive_project entirely
- T1110 (Non-Blocking Export I/O) — established the asyncio.to_thread pattern for sync operations

## Acceptance Criteria

- [ ] `archive_project` called via `asyncio.to_thread` in `publish_to_my_reels`
- [ ] Archive failure logged with warning (publish still succeeds since published_at is already committed)
- [ ] Event loop not blocked during archive operations
