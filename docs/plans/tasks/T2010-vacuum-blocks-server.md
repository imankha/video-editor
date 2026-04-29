# T2010: VACUUM Blocks Server During Archive

**Status:** TODO
**Impact:** 9
**Complexity:** 2
**Created:** 2026-04-29
**Updated:** 2026-04-29

## Problem

`archive_project()` calls `conn.execute("VACUUM")` (project_archive.py:136) synchronously after deleting working data. SQLite VACUUM acquires a **database-level exclusive lock**, blocking ALL other connections from reading or writing. On prod (single Fly.io machine, single uvicorn worker), this freezes the entire server — every concurrent request hangs until VACUUM completes, causing frontend "TypeError: Failed to fetch" on all endpoints.

### Evidence

User on prod (build cd35d51) reported:
- 12.3s `PATCH /api/projects/7/state` and 12.9s `POST /api/clips/.../actions` — possible VACUUM contention from concurrent archive
- 19 minutes later, ALL endpoints return "Failed to fetch" (ProfileStore, useDownloads — 5 retries)
- Fly.io machine did NOT crash or restart — server was alive but unresponsive
- User reports this is recurring ("same Failed to Fetch error as before")

### Root Cause

`archive_project()` line 136:
```python
conn.commit()
conn.execute("VACUUM")  # exclusive lock — blocks ALL connections
```

VACUUM runs inside the archive flow, which is triggered:
- **Old code (deployed):** synchronously inside `_finalize_overlay_export()` on export completion
- **Current code:** synchronously inside `publish_to_my_reels()` on "Move to My Reels" click

In both cases, VACUUM locks the database during an HTTP request, making the server unresponsive.

### Additional factors

The archive flow also does a synchronous R2 upload (`upload_bytes_to_r2`) before VACUUM. On slow R2 responses (12s observed in same session), the combined R2 upload + DB deletes + VACUUM can block the event loop for 15+ seconds.

## Fix: Move VACUUM to Signout

Remove VACUUM from `archive_project()`. Instead, run VACUUM on user signout for that user's database:

1. **Remove** `conn.execute("VACUUM")` from `archive_project()` (line 136)
2. **Add** VACUUM to the `POST /api/auth/logout` handler — after session invalidation, run VACUUM on the signing-out user's DB in a background thread
3. **Keep** the existing size-gated VACUUM in `cleanup_database_bloat()` (line 459) as a safety net for users who never sign out

### Why signout is the right trigger

- VACUUM is maintenance, not part of the critical archive path
- Signout is an explicit user gesture with no concurrent DB activity expected
- The user won't notice a brief delay during signout
- If the user never signs out, `cleanup_database_bloat()` still runs on session init with a size gate

## Context

### Relevant Files
- `src/backend/app/services/project_archive.py:136` — VACUUM in archive_project
- `src/backend/app/services/project_archive.py:459-478` — size-gated VACUUM in cleanup_database_bloat (keep this)
- `src/backend/app/routers/auth.py:500-517` — logout handler (add VACUUM here)
- `src/backend/app/routers/downloads.py:837` — publish_to_my_reels calls archive_project (see also T2030)
- `src/backend/app/routers/export/overlay.py` — old export path (deployed version calls archive_project)

### Related Tasks
- T2030 (archive_project sync regression) — archive_project also called synchronously; separate issue
- T1170 (Size-Based VACUUM on Init) — established the size-gated VACUUM pattern in cleanup_database_bloat

## Acceptance Criteria

- [ ] `archive_project()` no longer calls VACUUM
- [ ] VACUUM runs on signout for the user's profile DB, in a background thread
- [ ] Existing size-gated VACUUM in `cleanup_database_bloat()` unchanged
- [ ] No exclusive DB locks during archive or publish flows
