# T990: Rename database.sqlite to profile.sqlite

**Status:** TODO
**Impact:** 4
**Complexity:** 5
**Created:** 2026-04-03
**Updated:** 2026-04-03

## Problem

The per-profile database file is named `database.sqlite`, which is generic and confusing alongside `user.sqlite`. The name doesn't communicate that it's profile-scoped data (clips, projects, exports) vs user-scoped data (credits, profiles, settings).

## Solution

Rename `database.sqlite` to `profile.sqlite` everywhere: local file paths, R2 object keys, code references, and migration scripts.

### Migration Strategy

1. **Local rename**: On session init, if `profile.sqlite` doesn't exist but `database.sqlite` does, rename it
2. **R2 migration**: Download `database.sqlite`, re-upload as `profile.sqlite`, delete old key (S3/R2 doesn't support rename)
3. **Backwards compat**: Keep checking for `database.sqlite` as fallback during migration window

## Context

### Relevant Files
- `src/backend/app/database.py` — `get_database_path()`, schema init, `TrackedConnection` references
- `src/backend/app/storage.py` — R2 key generation (`r2_key`), sync functions reference `database.sqlite`
- `src/backend/app/middleware/db_sync.py` — sync after request, version tracking
- `src/backend/app/session_init.py` — `ensure_database()` call
- `src/backend/app/routers/auth.py` — guest migration references `database.sqlite` path
- `src/backend/scripts/reset_all_accounts.py` — cleanup references
- `src/backend/scripts/reset_account.py` — single account reset

### Related Tasks
- Part of: User Data Consolidation epic
- After: T960, T970, T985 (all consolidation done first)

### Technical Notes
- R2 doesn't support object rename — must copy + delete
- Need migration in session_init that renames local file
- R2 sync will naturally upload with new name after local rename
- Old R2 key (`database.sqlite`) should be cleaned up after successful upload of new key
- Consider a one-time migration script for all existing R2 objects
