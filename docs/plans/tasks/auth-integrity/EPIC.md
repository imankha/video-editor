# Epic: Auth Integrity

**Status:** IN_PROGRESS
**Started:** 2026-04-10
**Owner:** orchestrator agent (see [ORCHESTRATOR-KICKOFF.md](ORCHESTRATOR-KICKOFF.md))

## Goal

Eliminate orphaned accounts by removing the guest account system entirely. Users must sign in (Google or OTP) before using the app. No anonymous sessions, no guest-to-auth migration, no orphaned data.

Each task in this epic delivers **user-visible value** or **prevents a specific data-loss failure mode**, and every task is verifiable by a test run before and after the change.

## Why

A production user (sarkarati@gmail.com) lost their email record and had data scattered across 5 orphaned guest sessions. The guest system introduced massive complexity (migration logic, `pending_migrations` table, guest activity tracking, save banners, retry flows) and multiple failure modes (cookie loss → new guest, deploy wipe → new guest, race condition → duplicate guest). Removing guests eliminates the entire bug class.

## Priority (strict order — each task unblocks / de-risks the next)

| # | ID | Task | User Value / Failure Prevented | Verifiable By |
|---|----|------|--------------------------------|---------------|
| 1 | T1270 | [Cookie Path + SameSite Fix](T1270-cookie-path-fix.md) | Session cookie survives cross-route navigation and reloads (root of multiple lost-session reports) | Backend test asserts every `set_cookie("rb_session", ...)` includes `path="/"` and `samesite="lax"`; E2E asserts cookie present after nav from `/` → `/annotate/:id` → reload |
| 2 | T1290 | [Auth DB Restore Must Succeed](T1290-auth-db-restore-must-succeed.md) | A failed R2 restore on boot no longer silently creates an empty auth DB (root cause of sarkarati@ losing their email record) | Backend test: simulate R2 failure in startup → assert process raises fatal (does NOT fall through to `init_auth_db()`); assert 3 retry attempts logged |
| 3 | T1340 | [Auth-First Login Screen](T1340-auth-first-login-screen.md) *(scope collapsed 2026-04-13)* | OtpAuthForm extraction + Google One Tap regression fix + FedCM migration. Full-screen login gate dropped — visual flow stays at parity with staging. | One Tap works; no FedCM deprecation warnings; AuthGateModal renders OtpAuthForm; manual verification |
| 4 | T1330 | [Remove Guest Accounts](T1330-remove-guest-accounts.md) *(expanded)* | Orphaned accounts become structurally impossible (every `user_id` must have an email). Now also owns: store-level auth gating + login surface (header sign-in + modal). | `grep -r "guest" src/` returns zero auth-related hits; schema migration asserts `users.email` NOT NULL; deleted `test_guest_migration.py`; unauthenticated shell renders empty states (no 401 error UI); full backend + frontend suites green |

**Why this order:**
- T1270 is a 1-line-per-call fix and a prerequisite for everything else — if cookies don't persist, every downstream auth test is flaky.
- T1290 prevents the restore-wipe failure mode that caused the original incident. Doing it before T1330 means if the DB still gets wiped mid-epic, we find out loudly instead of silently re-creating guest users.
- T1340 scope was collapsed 2026-04-13 after user feedback ("don't change the UI flow, just block mutating state changes"). The full-screen LoginScreen was reverted; T1340 now ships only the One Tap fix + OtpAuthForm extraction.
- T1330 inherits the login-surface work (header sign-in affordance + AuthGateModal as primary login) and the store-level auth gating that makes an unauthenticated shell render empty states without 401-ing.
- T1330 is the big rip-out (~400 LOC removed, plus the new store gating). Landing it last means every earlier change had the guest path still available as a safety net during testing.

## Shared Context

### Files in this code path

**Backend:**
- `src/backend/app/routers/auth.py` — login, init-guest, migration endpoints; `set_cookie` call sites
- `src/backend/app/services/auth_db.py` — `sync_auth_db_from_r2`, `init_auth_db`, `create_guest_user`
- `src/backend/app/services/user_db.py` — `pending_migrations` schema
- `src/backend/app/main.py` — startup sequence (auth DB restore happens here)
- `src/backend/app/middleware/db_sync.py` — auth gate on endpoints
- `src/backend/app/utils/retry.py` — existing retry infrastructure (reuse for T1290)

**Frontend:**
- `src/frontend/src/App.jsx` — top-level routing, GuestSaveBanner, MigrationRetryBanner
- `src/frontend/src/stores/authStore.js` — `isAuthenticated`, `hasGuestActivity`, `requireAuth`, `migrationPending`
- `src/frontend/src/utils/sessionInit.js` — `initSession()`, init-guest fallback
- `src/frontend/src/components/GoogleOneTap.jsx` — currently floating nudge, becomes primary login on T1340

### Prior art

- T1040 (DONE) — "Force Login on Add Game"; partial auth gate on one button. This epic makes the whole app that way.
- Reports/incidents driving this epic: sarkarati@gmail.com 2026-04-10 (5 orphaned accounts), misc cookie-loss reports during staging deploys.

### Known behaviors to preserve

- Google OAuth redirect must keep working end-to-end after cookie changes.
- OTP email flow must keep working.
- Local dev (R2 disabled) must still boot with an empty auth DB — the mandatory-restore rule is conditional on `R2 enabled`.
- Gesture-based persistence rule (CLAUDE.md) — no reactive `useEffect` persistence on any new frontend auth state.

## Measurement Protocol (per-task)

Every task follows this loop:

1. **Before:** write the failing test first, run it on master, record the failure mode (error text, exit code, missing assertion — whatever the task's value metric is).
2. **Implement** on a task-specific branch: `feature/T{id}-{slug}`.
3. **After:** re-run the test, record the pass. Diff the before/after in the task file's "Result" section.
4. **Merge** the task branch into master only after (a) the before/after test exists and passes and (b) user approves with "complete" / "done". AI only sets status to TESTING (or AWAITING USER VERIFICATION where manual Google OAuth / email OTP exercise is required).
5. **Report back** to the orchestrator: what changed, what downstream tasks should know, any surprises. Append to `ORCHESTRATOR-NOTES.md`.

## Merge Policy

- One branch per task. No batching.
- Merge only after explicit user approval. No `--no-verify`, no hook skipping, no force-push to master.
- Do not push to origin until user says so (standing feedback).
- If a task's before-test passes on master, the premise is wrong — stop and ask the user.

## Orchestrator Kickoff

See [ORCHESTRATOR-KICKOFF.md](ORCHESTRATOR-KICKOFF.md).

## Completion Criteria

- [ ] All 4 tasks merged to master with passing before/after tests
- [ ] App shows login screen on first visit — no anonymous usage path exists
- [ ] `POST /api/auth/init-guest` endpoint does not exist (`curl` returns 404)
- [ ] No guest migration code exists (`_migrate_guest_profile`, `pending_migrations` table, `retry-migration` endpoint all gone)
- [ ] Cookie persists across page reloads and cross-route navigation in production
- [ ] Deploy cannot silently wipe auth.sqlite (startup fails hard if R2 restore fails with R2 enabled)
- [ ] Zero orphaned accounts possible: `users.email` has NOT NULL constraint
- [ ] Full backend test suite green, full frontend unit suite green
