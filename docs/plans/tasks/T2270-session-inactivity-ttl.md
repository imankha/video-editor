# T2270: Session Inactivity TTL

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-05-10
**Updated:** 2026-05-10

## Problem

Sessions currently expire 30 days from creation regardless of activity. A user who logs in once and never returns keeps an active session for a full month. With single-session enforcement (T1190), this is less dangerous (no session sprawl), but inactive sessions should still expire sooner to reduce the attack surface of stolen session tokens.

## Solution

Add an inactivity check in `validate_session()` that compares `last_seen_at` (users table) against a configurable threshold (e.g., 14 days). If the user hasn't been seen in that window, invalidate the session.

`last_seen_at` is updated on every `/me` call (app load) and on login via `update_last_seen(user_id)`. With single-session enforcement from T1190, there's only ever one session per user, so the per-user `last_seen_at` is equivalent to per-session activity.

## Context

### Relevant Files
- `src/backend/app/services/auth_db.py` - `validate_session()` and `update_last_seen()`
- `src/backend/tests/test_auth.py` - Session validation tests

### Related Tasks
- Depends on: T1190 (single-session enforcement makes per-user last_seen_at equivalent to per-session)
- Absorbs: T420 (session management -- inactivity expiry portion)

### Technical Notes
- `last_seen_at` lives in the `users` table, not `sessions` table
- With T1190's single-session enforcement, one user = one session, so user-level `last_seen_at` is sufficient
- The 30-day absolute TTL (`expires_at` on sessions table) remains as a hard ceiling
- Inactivity threshold should be configurable via env var (default 14 days)

## Implementation

### Steps
1. [ ] Add `SESSION_INACTIVITY_DAYS` env var (default 14)
2. [ ] In `validate_session()`, after confirming session is valid, check `last_seen_at` for the user
3. [ ] If `last_seen_at` is older than threshold, call `invalidate_session()` and return None
4. [ ] Add tests for inactivity expiry

## Acceptance Criteria

- [ ] Sessions expire after N days of inactivity (no `/me` calls)
- [ ] Active sessions (regular `/me` calls) stay alive up to the 30-day absolute TTL
- [ ] Threshold is configurable via env var
- [ ] Tests cover both active and inactive session scenarios
