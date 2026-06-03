# T3360: Collapse Frontend Load Phases

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P0
**Complexity:** 4
**Impact:** 9
**Status:** TODO

## Problem

`initSession()` awaits both auth/me (1.8s) AND auth/init (~1.0s after T3350) before any data fetch fires. But several endpoints only need `user_id` (from auth/me), not `profile_id` (from auth/init). Additionally, `setSessionState(true)` fires at sessionInit.js:241 BEFORE auth/init completes, triggering 4 reactive fetches without X-Profile-ID that each re-trigger session init in the backend middleware.

## Evidence

### Endpoints that only need user_id (NOT profile_id)

| Endpoint | DB | Needs profile_id? | Evidence |
|----------|----|--------------------|----------|
| GET /api/credits | user SQLite | No | Queries by user_id (credits.py:33) |
| GET /api/settings | user SQLite | No | Queries pref.* by user (settings.py:78) |
| GET /api/admin/me | Postgres | No | Queries admin_users by user_id (admin.py:89) |
| GET /api/profiles | user SQLite | No | Lists all profiles for user (profiles.py:69) |

### Endpoints that need profile_id

| Endpoint | Evidence |
|----------|----------|
| GET /api/projects | Queries profile-scoped SQLite |
| GET /api/games | Queries profile-scoped SQLite |
| GET /api/quests/progress | Queries profile-scoped data |
| GET /api/exports/* | Queries profile-scoped SQLite |
| GET /api/downloads/count | Queries profile-scoped SQLite |

### Premature setSessionState

- sessionInit.js:241 -- `setSessionState(true)` fires before auth/init completes
- This triggers authStore subscription which fires credits, admin/me, settings, pending-uploads
- These 4 requests arrive without X-Profile-ID header (sessionInit.js:83 only adds it if `_currentProfileId` is set)
- Backend middleware falls back to `user_session_init()` for each (db_sync.py:503-507)

## Implementation

### 1. Split initSession() into two phases

```
Phase A: await /api/auth/me -> sets _currentUserId, returns immediately
Phase B: fire /api/auth/init (no await from caller's perspective) -> sets _currentProfileId when it resolves
```

### 2. Delay setSessionState(true)

Move `setSessionState(true)` from sessionInit.js:241 to AFTER auth/init returns and `_currentProfileId` is set (after line 252). This prevents premature reactive fetches without profile_id.

### 3. Restructure App.jsx fetch orchestration

After Phase A (auth/me) resolves:
- Immediately fire user-id-only requests in parallel: credits, settings, admin/me, profiles
- Fire auth/init (Phase B) concurrently with the above

After Phase B (auth/init) resolves:
- Fire profile-dependent requests: projects, games, exports, downloads, quests/progress, warmup
- Fire `setSessionState(true)` here (so auth subscription doesn't double-fire)

### 4. Timeline comparison

**Before:**
```
auth/me (1.8s) -> auth/init (1.0s) -> 9 data endpoints (parallel, 3.7s) = 6.5s
```

**After:**
```
auth/me (1.8s) -> [auth/init (1.0s) || credits+settings+admin+profiles (0.5s)] -> profile endpoints (bootstrap) = ~3.3s
```

~400ms saved from parallelizing user-id-only requests with auth/init. More savings come from T3370 (bootstrap endpoint) which eliminates the Phase 3 convoy.

## Files

| File | Change |
|------|--------|
| `src/frontend/src/services/sessionInit.js` | Split initSession into Phase A + Phase B; delay setSessionState |
| `src/frontend/src/App.jsx` | Restructure fetch orchestration: fire user-id-only fetches after Phase A |

## Acceptance Criteria

- [ ] credits, settings, admin/me, profiles fire concurrently with auth/init (HAR shows overlap)
- [ ] No requests arrive at backend without X-Profile-ID (except the 4 user-id-only endpoints)
- [ ] `setSessionState(true)` fires only after `_currentProfileId` is set
- [ ] Auth subscription does NOT fire on initial page load (only on same-device login)
- [ ] Same-device login (Google sign-in during session) still works
