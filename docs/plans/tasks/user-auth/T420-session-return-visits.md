# T420: Session & Return Visits

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Authenticated users need seamless return visits. If cookies are cleared or they're on a new browser, they need a way back in. Multi-device access needs single-session enforcement to prevent R2 sync conflicts.

## Solution

Session cookie (30-day, httponly) handles return visits on the same browser. Cleared cookies or new browser shows a login screen (email OTP or Google). New login invalidates all previous sessions — only one active session at a time to prevent R2 sync conflicts.

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py` - Session validation in request middleware
- `src/backend/app/services/auth_db.py` - Session CRUD
- `src/frontend/src/utils/sessionInit.js` - Session check on app load
- `src/frontend/src/stores/authStore.js` - Auth state

### Related Tasks
- Depends on: T405 (central auth DB needed for cross-device session lookup)
- Related: T40 (Stale Session Detection — can be merged or inform this)

### Technical Notes

**Single-session enforcement:**
- On new login: DELETE FROM sessions WHERE user_id = ? (except new session)
- Old device's next request → session invalid → 401 → must re-auth
- Re-auth on old device → fresh R2 download → no stale data conflicts

**Session expiry:**
- 30-day sessions
- Backend validates expiry on each request
- Expired → 401 → frontend shows login screen

**Return visit (no session):**
- Full-screen login page (not modal)
- Same email OTP + Google OAuth options
- After login, redirect to last-used screen or home

## Implementation

### Steps
1. [ ] Add session validation to request middleware (check D1 on each request)
2. [ ] Handle 401 response in frontend (show login page, not modal)
3. [ ] Build login page component (similar to auth modal but full-screen)
4. [ ] Add session cleanup cron or on-login cleanup for expired sessions
5. [ ] Test: login → close browser → reopen → still logged in
6. [ ] Test: login on "device B" → device A gets 401

## Acceptance Criteria

- [ ] Return visit with valid cookie → auto-authenticated
- [ ] Expired session → login page shown
- [ ] Cleared cookies → login page shown
- [ ] New login invalidates all other sessions
- [ ] 401 on old device triggers re-auth flow
- [ ] After re-auth, fresh data loads from R2
