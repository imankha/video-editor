# Auth Integrity

**Status:** IN_PROGRESS
**Started:** 2026-04-10

## Goal

Eliminate orphaned accounts by removing the guest account system entirely. Users must sign in (Google or OTP) before using the app. No anonymous sessions, no guest-to-auth migration, no orphaned data.

## Why

A production user (sarkarati@gmail.com) lost their email record and had data scattered across 5 orphaned guest sessions. The guest system introduced massive complexity (migration logic, pending_migrations table, guest activity tracking, save banners, retry flows) and multiple failure modes (cookie loss → new guest, deploy wipe → new guest, race condition → duplicate guest). Removing guests eliminates the entire bug class.

## Approach

**Auth-first**: The app shows a login screen on load. No user_id is created until sign-in (Google or OTP) succeeds. This means:
- No `init-guest` endpoint
- No guest-to-auth migration code
- No `pending_migrations` table
- No `GuestSaveBanner` or `MigrationRetryBanner`
- No `hasGuestActivity` tracking
- No `requireAuth()` gates (everything requires auth)
- `GoogleOneTap` + OTP become the primary login mechanisms (full-screen, not a nudge)

The cookie and auth DB restore fixes are still needed to prevent session loss after deploy.

## Tasks

| ID | Task | Status | Impact | Cmplx | Pri |
|----|------|--------|--------|-------|-----|
| T1270 | [Cookie Path + SameSite Fix](T1270-cookie-path-fix.md) | TODO | 9 | 1 | 9.0 |
| T1290 | [Auth DB Restore Must Succeed](T1290-auth-db-restore-must-succeed.md) | TODO | 9 | 4 | 2.3 |
| T1330 | [Remove Guest Accounts](T1330-remove-guest-accounts.md) | TODO | 10 | 6 | 1.7 |
| T1340 | [Auth-First Login Screen](T1340-auth-first-login-screen.md) | TODO | 9 | 4 | 2.3 |

## Removed Tasks (superseded by guest removal)

- ~~T1280 Init-Guest Idempotency~~ — No more init-guest
- ~~T1300 Backend Auth Gate on Export~~ — All endpoints require auth by default
- ~~T1310 SameSite Cookie Logic~~ — Merged into T1270
- ~~T1320 Session Recovery After Restart~~ — No guest fallback to recover from

## Completion Criteria

- [ ] All tasks complete
- [ ] App shows login screen on first visit — no anonymous usage
- [ ] No `init-guest` endpoint exists
- [ ] No guest migration code exists
- [ ] Cookie persists across page reloads and navigation in production
- [ ] Deploy cannot silently wipe auth.sqlite
- [ ] Zero orphaned accounts possible (every user_id has an email)
- [ ] `users.email` has NOT NULL constraint
