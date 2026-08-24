# T7520: Impersonation creates an empty profile DB under the ADMIN's user_id and syncs it to R2

**Status:** TODO
**Priority:** P1 (cross-tenant write path in DB-open logic)
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

Found by the 2026-08-24 drop-off investigation (read-only prod sweep). When an admin
impersonates a user and stops, an EMPTY profile.sqlite gets created under the ADMIN's own
user directory keyed by the IMPERSONATED USER's profile_id, and is then synced to R2:

- `/user_data/3ed03fb5-.../profiles/0f8214c8/profile.sqlite` exists on the prod machine.
  `3ed03fb5` is imankh's user_id; `0f8214c8` is cschwartz78's profile_id. mtime is
  2026-08-23T22:47:47, exactly 4 seconds after impersonation stop (impersonation_audit
  id 86 at 22:47:43). The file was uploaded to R2 at
  `production/users/3ed03fb5-.../profiles/0f8214c8/profile.sqlite`.
- Same artifact for arshia's profile `b95eb93b` under imankh's directory, and that one has
  `sqlite_sequence = {"game_storage": 0}`, proving a write actually EXECUTED into the
  misplaced file, not just a touch.

No data loss observed (the misplaced DBs are empty or near-empty), but this is a
cross-tenant write path: request context resolved a profile_id belonging to user A while
the user_id was user B, and the DB-open logic silently CREATED the hybrid path instead of
refusing. The same class of confusion in a different order (writing user A's data into a
hybrid path, or restoring over it) could lose real data.

## Hypothesized mechanism (verify first)

During impersonation stop (or immediately after, on the admin's next request), the
frontend still sends `X-Profile-ID: <impersonated user's profile>` while the session has
flipped back to the admin's user_id. `ensure_database()` receives (admin_user_id,
foreign_profile_id), finds no local file, R2 has nothing at that hybrid key (NOT_FOUND),
and creates a fresh empty DB; the middleware then syncs it up. Check
`session_init.py` / `db_sync.py` profile-context resolution and the frontend's profile
header handling across the impersonate/stop transition.

## Solution direction

Structural guard, not a point fix: profile context resolution must REFUSE a profile_id
that is not registered to the authenticated user's user.sqlite profiles list (404/409,
log CRITICAL with both ids), instead of ever creating a DB for an unregistered profile.
The frontend should also clear/reset its profile header on impersonation start AND stop,
but the backend guard is the invariant. Then clean up: delete the orphan hybrid objects
in R2 + local (imankh has at least 2: profiles 0f8214c8 and b95eb93b under
3ed03fb5-...), after confirming they hold no real rows.

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py` - profile context resolution (X-Profile-ID)
- `src/backend/app/session_init.py` - user_session_init profile resolution
- `src/backend/app/database.py` - ensure_database (the creator of the hybrid path)
- `src/backend/app/routers/admin.py` - impersonate/stop endpoints
- Frontend: authStore / profile header handling across impersonation transitions

### Technical Notes
- The guard must not break legitimate flows: profile creation (`POST /api/profiles`,
  profile registered before first DB touch) and cross-profile explicit ops
  (materialization helpers take explicit ids and do not go through the request
  ContextVar path).
- Test: impersonate -> stop -> next admin request with stale X-Profile-ID must 4xx and
  create NOTHING (no local file, no R2 object).

## Acceptance Criteria

- [ ] Verified mechanism documented (repro on staging)
- [ ] Backend refuses unregistered profile_id for the session user; nothing auto-created
- [ ] Frontend clears profile header on impersonation start/stop
- [ ] Existing orphan hybrid DBs verified empty and removed (R2 + local)
- [ ] Tests: the refusal, the legit-profile-create flow unaffected
