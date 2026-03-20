# T610: Track last_seen_at on Every Visit

**Status:** IN_PROGRESS
**Impact:** 6
**Complexity:** 1
**Created:** 2026-03-20
**Updated:** 2026-03-20

## Problem

`last_seen_at` only updates on Google login, not on session resume (`/auth/me`) or guest creation (`/init-guest`). This means we can't distinguish active users from abandoned ones — a guest who visits daily looks the same as one who visited once 3 months ago.

## Solution

Call `update_last_seen(user_id)` in `/auth/me` and `/init-guest` endpoints. ~2 lines of code.

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` - Auth endpoints
- `src/backend/app/services/auth_db.py` - `update_last_seen()` function

### Related Tasks
- Blocks: T620 (account cleanup depends on accurate activity data)

## Acceptance Criteria

- [ ] `last_seen_at` updates on `/auth/me` (returning user with session cookie)
- [ ] `last_seen_at` updates on `/init-guest` (new guest visit)
- [ ] `last_seen_at` still updates on Google login (existing behavior)
