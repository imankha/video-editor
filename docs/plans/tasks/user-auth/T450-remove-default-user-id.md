# T450: Remove DEFAULT_USER_ID Fallback

**Status:** TESTING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-06
**Updated:** 2026-04-06

## Problem

The legacy `DEFAULT_USER_ID = "a"` still exists as a fallback throughout the backend. Before auth was implemented, all users shared this single identity. Now that every visitor gets a proper UUID via `/api/auth/init-guest`, the fallback silently routes unauthenticated requests to a phantom shared user instead of failing visibly. This caused the migration crash (user context was `a` when it should have been the recovered user's UUID) and risks data cross-contamination.

Key symptoms:
- Middleware logs `user=a (via default)` for any request without a session cookie
- `user_session_init` called with the recovered user's ID but `ensure_database()` reads `get_current_user_id()` which returns `a`
- Any code path that forgets to set user context silently operates on user `a`'s data

## Solution

Remove `DEFAULT_USER_ID` and make missing user context a hard error. The guest system (`/api/auth/init-guest` → UUID) remains unchanged.

1. **Delete the constant** from `constants.py`
2. **ContextVar default → raise** — `get_current_user_id()` should raise if no user is set, not return `"a"`
3. **Middleware: 401 instead of fallback** — if no session cookie and no X-User-ID header, return 401 (except for auth endpoints and OPTIONS preflight)
4. **Allowlist auth routes** — `/api/auth/me`, `/api/auth/init-guest`, `/api/auth/google`, `/api/auth/email/*`, OPTIONS preflight should work without a user context
5. **Clean up docstring examples** — replace `user_id="a"` with realistic UUIDs

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/constants.py` - `DEFAULT_USER_ID = "a"` definition (line 270)
- `src/backend/app/user_context.py` - ContextVar default, `get_current_user_id()`, `reset_user_id()`
- `src/backend/app/middleware/db_sync.py` - Fallback to `DEFAULT_USER_ID` (line 123)
- `src/backend/app/database.py` - Comment referencing default user 'a' (line 13)
- `src/backend/app/main.py` - Import and comment (line 71, 278)
- `src/backend/app/services/modal_client.py` - Docstring example (line 20)
- `src/backend/app/services/export_worker.py` - Docstring example (line 550)
- `src/backend/app/modal_functions/video_processing.py` - Docstring examples (lines 197, 2457, 2716)
- `src/backend/experiments/test_batch_detection.py` - Hardcoded `user_id = "a"` (line 84)

### Related Tasks
- Depends on: T405 (auth system in place — DONE)
- Related: T420 (Session & Return Visits)
- Caused: Migration crash when user context fell back to `a` during Google OAuth

### Technical Notes

**What should NOT change:**
- Guest system: `/api/auth/init-guest` creates UUID-based guests with proper session cookies — this stays
- The middleware sets user context from session cookie — this stays
- Authenticated requests have user context from session — this stays

**What changes:**
- No more silent fallback — if user context is missing, it's a bug (except allowlisted auth routes)
- OPTIONS preflight: these never need user context, skip entirely
- Auth endpoints: `/api/auth/me`, `/api/auth/init-guest`, `/api/auth/google`, `/api/auth/email/*` must work without prior user context (they establish it)

**Risk: local dev without auth**
- Running the backend locally without going through init-guest will break (no more free `user=a`)
- This is desired — forces realistic auth flow even in dev

## Implementation

### Steps
1. [ ] Add auth route allowlist to middleware (skip user context requirement for auth + OPTIONS)
2. [ ] Change middleware: if no session cookie and not allowlisted → 401
3. [ ] Change `get_current_user_id()` to raise `RuntimeError` if no user set (remove default)
4. [ ] Delete `DEFAULT_USER_ID` from constants.py
5. [ ] Remove all imports of `DEFAULT_USER_ID`
6. [ ] Update `reset_user_id()` to clear the ContextVar (not set to "a")
7. [ ] Clean up docstring examples (replace "a" with UUID examples)
8. [ ] Clean up experiment files
9. [ ] Test: fresh browser → init-guest → gets UUID → all requests work
10. [ ] Test: Google login → migration → correct user context throughout
11. [ ] Test: OPTIONS preflight → 200 (no 401)
12. [ ] Test: request with expired/missing cookie to non-auth endpoint → 401

## Acceptance Criteria

- [ ] No references to `DEFAULT_USER_ID` or hardcoded `"a"` as user ID in production code
- [ ] `get_current_user_id()` raises if called without user context being set
- [ ] Middleware returns 401 for unauthenticated non-auth requests
- [ ] Auth endpoints work without prior user context
- [ ] Guest flow (init-guest → UUID → session cookie) works unchanged
- [ ] Google OAuth flow works without falling back to `a`
- [ ] Backend import check passes
- [ ] Existing tests pass
