# T820: Guest-to-Email Migration Silently Fails, Orphaning User Data

**Status:** TODO
**Impact:** 10
**Complexity:** 6
**Created:** 2026-04-01
**Updated:** 2026-04-01

## Problem

When a guest user logs in with Google (email), the system attempts to migrate their guest profile data to the email account via `_migrate_guest_profile()`. If R2 is unreachable during this migration, the function silently returns (line 274-276 in `auth.py`), the session switches to the email account's user_id, and the guest's games/projects/clips become permanently inaccessible.

The user sees a blank account with none of their work. The guest data still exists in R2 under the old user_id but there's no way to access it — the guest session is gone and the migration was skipped.

### Observed Scenario (2026-04-01)

1. User worked as guest `68d5bee9...` — had 2 games, "Spring 2026" project with 37 clips, framing edits
2. R2 connectivity became intermittent (confirmed: `R2 error reading selected-profile.json` in logs)
3. User logged in with `imankh@gmail.com` → existing account `bee3ab2c...` found
4. `_migrate_guest_profile(68d5bee9, bee3ab2c)` called
5. R2 read for guest profile failed → migration silently skipped (line 274-276)
6. Session switched to `bee3ab2c...` — user sees empty account
7. Guest session `68d5bee9...` expired — no way to re-access guest data
8. Local `user_data/68d5bee9.../` directory cleaned up by session lifecycle

### User Impact
- **Complete data loss** — all games, clips, projects, framing edits gone
- **No warning** — user sees blank account with no error message
- **No recovery path** — guest session expired, data orphaned in R2
- **Trust-destroying** — user spent hours annotating and framing clips

## Root Causes

### 1. Silent failure on R2 error (auth.py:274-276)
```python
except R2ReadError:
    logger.warning(f"[Auth] Migration skip: R2 error reading guest profile for {guest_user_id}")
    return  # ← Silently abandons migration, login continues
```
The migration is "best-effort" by design (line 264: "logs errors but never blocks login"). But losing all user data silently is worse than blocking login.

### 2. No retry or deferred migration
Once the migration is skipped, there's no record that it needs to happen later. The guest user_id is never stored on the email account for future retry.

### 3. Local guest data cleaned up independently
The local `user_data/{guest_id}/` directory is cleaned up by session expiry/lifecycle, regardless of whether migration succeeded. Once the local copy is gone and the guest session expires, the data is only in R2 — but no code path accesses it.

### 4. No user-facing warning
The user sees a successful login with no indication that their data wasn't migrated. They discover the loss only when they look for their projects.

## Solution

### Option A: Block login on migration failure (recommended)
If guest has games/data AND migration fails, return an error to the frontend instead of silently continuing. Show user a message: "We're having trouble transferring your data. Please try again in a moment."

### Option B: Deferred migration with retry
- Store `pending_migration: {guest_id, target_id}` in auth DB
- On next login or app load, retry the migration
- Show banner: "Some of your data is still being transferred"

### Option C: Keep guest session alive as fallback
- Don't expire the guest session until migration is confirmed successful
- If migration fails, keep returning guest data (not email account data)

### Additional Safeguards
- **Never clean up local guest data** until migration is confirmed
- **Log migration success/failure** with enough detail to manually recover
- **Add migration status to /api/auth/me** response so frontend can warn

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` — Lines 260-324: `_migrate_guest_profile()`, Lines 390-401: Google login flow
- `src/backend/app/services/auth_db.py` — Guest user creation, session management
- `src/backend/app/session_init.py` — Profile initialization, R2 sync

### Related Tasks
- None — this is a standalone data integrity issue

### Technical Notes
- Guest data in R2 is keyed by `{env}/users/{guest_user_id}/` — recoverable if user_id is known
- The `_merge_guest_into_profile()` function (called by migration) merges games and clips at the DB level
- R2 connectivity issues are transient — retrying after a few seconds usually succeeds
- The migration function has a broad `except Exception` catch-all (line 323) that also silently swallows errors

## Acceptance Criteria

- [ ] Guest-to-email migration failure does NOT silently lose data
- [ ] User is warned if migration fails (either blocked from login or shown banner)
- [ ] Guest data is not cleaned up locally until migration is confirmed
- [ ] Failed migrations are recorded for retry
- [ ] Manual recovery is possible given the guest user_id
