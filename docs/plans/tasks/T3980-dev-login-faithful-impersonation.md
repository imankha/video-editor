# T3980: Dev-Login - Faithful Account Impersonation for Automated Testing

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-06-25
**Updated:** 2026-06-25

## Problem

There is no way to drive the app (Playwright / automated session) AS a specific real account with that
account's REAL data. The existing dev bypass is insufficient:
- `POST /api/auth/test-login` logs in as a throwaway `e2e@test.local` (no real data).
- The `X-User-ID` header bypass (middleware/db_sync.py ~L463-473) sets the user id but **skips real
  session-init**, so the R2 sync + profile selection never run -> the session sees an empty/default
  profile. Observed: GET /api/games with `X-User-ID=<real uid>` + `X-Profile-ID=9fa7378c` returned 2 blank
  games (opponent_name/storage_status/recap_video_url all null) instead of the real 6-game profile.

Consequence: we can't faithfully reproduce a real user's screens in automated tests (e.g. we could NOT
watch the T3970 expired-game playback as imankh@gmail.com to verify it). We should be able to mimic any
account in Playwright on dev/staging.

## Solution

Add a dev/staging-only **`POST /api/auth/dev-login`** that logs in as a real user by email (or user_id) and
runs the SAME initialization path as a real login, so the session loads the account's real R2 data:
- Resolve the real user in Postgres `users`.
- Run `user_session_init(user_id, hint_profile_id=profile_id)` (downloads `user.sqlite` + the selected/
  hinted `profile.sqlite` from R2, sets profile context, computes storage) - this is the step the current
  bypass skips.
- Issue a real session cookie via `_issue_session_cookie`.
Plus a Playwright helper `loginAsRealUser(page, email, profileId?)`. Gate exactly like test-login
(APP_ENV != production + `X-Test-Mode`). If the existing admin-impersonation path (admin.py ~L311-348)
already runs init + cookie for a target user, reuse/extend it rather than duplicating.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/auth.py` - `test_login` (~L852-881) is the template for gating + `_issue_session_cookie`; `/me` header fallback (~L382-394). Add `dev_login` + a `DevLoginRequest` model.
- `src/backend/app/middleware/db_sync.py` - the `X-User-ID` bypass (~L463-473) + `SKIP_SESSION_INIT_PATHS` (~L517-530): shows why header-only requests skip init.
- `src/backend/app/services/session_init.py` - `user_session_init` (~L50-262): `ensure_user_database`, `get_selected_profile_id`, `ensure_database` (the R2 sync + profile selection to reuse).
- `src/backend/app/profile_context.py` - `set_current_user_id` / `set_current_profile_id`.
- `src/backend/app/routers/admin.py` - existing impersonation (~L311-348): check if it already does init+cookie and can be reused.
- Frontend: `src/frontend/e2e/new-user-flow.spec.js` (auth pattern ~L54), `src/frontend/e2e/global-setup.js`, `src/frontend/tests/perf/setup-dev-auth.js`, `src/frontend/src/stores/authStore.js` (the gate). Update the "Testing Auth Bypass" section of `src/frontend/CLAUDE.md`.

### Technical Notes
- Gate to dev/staging (APP_ENV != "production") + require `X-Test-Mode` (mirror test-login ~L859-865); 404 in prod.
- Accept `{ email }` or `{ user_id }` + optional `profile_id`; resolve via Postgres users (user_id lookup is Postgres, never auth.sqlite).
- The whole point is to RUN `user_session_init` so R2 data loads - do not just set the header. After init, set profile context to the resolved profile and issue the cookie so subsequent requests are a normal authenticated session.
- Frontend helper: POST dev-login (credentials: include) then set authStore `{ isAuthenticated, email, userId, showAuthModal:false }` and reload, so the UI gate opens and the app fetches real data.
- Never expose in prod; do not allow arbitrary privilege escalation beyond dev/staging.

## Implementation

### Steps
1. [ ] Backend `POST /api/auth/dev-login {email|user_id, profile_id?}`: gate (dev/staging + X-Test-Mode), resolve real user, run `user_session_init(user_id, hint_profile_id=profile_id)`, set profile context, issue session cookie; reuse admin-impersonate internals if they already do this.
2. [ ] Frontend `loginAsRealUser(page, email, profileId?)` helper (e2e + perf setup) that calls dev-login and opens the authStore gate.
3. [ ] Update the auth-bypass docs in `src/frontend/CLAUDE.md` (use dev-login for real-account testing; the X-User-ID/test-login bypass is for new-user flows only).
4. [ ] Tests: e2e smoke - `loginAsRealUser('imankh@gmail.com','9fa7378c')` then GET /api/games returns the real games with storage_status/recap populated. Backend - dev-login 404s in prod, requires X-Test-Mode, resolves the real profile. (Backend tests touch Postgres - run only in a safe env, not against shared dev Postgres.)

## Acceptance Criteria
- [ ] `POST /api/auth/dev-login` as a real email + profile yields a session that returns that account's REAL data (full games w/ storage_status, clips, recaps) - identical to a real login.
- [ ] A Playwright helper authenticates as a real account and can drive that account's actual screens (e.g. open an expired game and play its annotations).
- [ ] Endpoint is dev/staging-only (404 in production) and requires `X-Test-Mode`.
- [ ] Existing test-login / new-user-flow / header bypass remain working.
