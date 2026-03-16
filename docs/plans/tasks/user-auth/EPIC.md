# User Auth Epic

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Gate GPU-cost operations behind email verification. Users explore freely (upload, annotate) and only authenticate when they trigger a GPU operation ("Create Video"). Google OAuth is primary (lowest friction), Email OTP is secondary (covers the ~60% who prefer email).

## Design Decisions

- **Gate point:** "Create Video" button (first GPU operation)
- **Primary auth:** Google OAuth (one-tap, zero context switch)
- **Secondary auth:** Email OTP — 6-digit code typed in-app (no magic links)
- **NOT using:** Magic links (context-switch kills conversion for 40s male demographic), passwords (63% success rate)
- **Guest data preserved:** Email links to existing guest_XXXXXXXX ID, no data migration
- **Two-phase architecture:**
  - T400/T401: Auth works on per-user SQLite (single-device, fast to ship)
  - T405: Central D1 database (enables cross-device, Stripe, recovery)
- **No email verification gate:** Immediate access after auth

## Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T400 | [Auth Gate + Google OAuth](T400-auth-gate-ui.md) | TODO | Modal + real Google sign-in (per-user SQLite) |
| T401 | [Email OTP Auth](T401-email-otp.md) | TODO | Real Resend integration (per-user SQLite) |
| T405 | [Central Auth + Cross-Device](T405-central-auth-db.md) | TODO | D1 migration, LoginPage, account recovery |
| T420 | [Session & Return Visits](T420-session-return-visits.md) | TODO | Single-session enforcement, expiry |
| T430 | [Account Settings](T430-account-settings.md) | TODO | Email display, linking, logout |

## Completion Criteria

- [ ] Unauthenticated users can upload and annotate freely
- [ ] "Create Video" triggers auth modal
- [ ] Google OAuth works end-to-end
- [ ] Email OTP works end-to-end
- [ ] Cross-device login recovers account + data (after T405)
- [ ] Return visits auto-login via session cookie
- [ ] Account settings page exists
