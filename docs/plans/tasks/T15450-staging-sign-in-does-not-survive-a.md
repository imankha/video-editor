# T15450: Staging sign-in does not survive a reload in Safari-class browsers (cross-site session cookie)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Possible bug (unconfirmed), found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14 and iPad (Playwright WebKit); real devices not checked.

**Steps:** On staging in WebKit, sign in with the email code, land on /home/games, reload (or close and reopen).

**Expected:** Still signed in.

**Actual:** Back on the sign-in screen; /auth/me and /me/resume-point return 401 and the context has no rb_session cookie. The app is on pages.dev and the API on fly.dev, so the cookie is cross-site and WebKit blocks it. Prod uses api.reelballers.com (same-site) and is probably fine.

## Acceptance Criteria

- [ ] On a real iPhone against staging: sign in, close Safari, reopen, still signed in (or the task records that this is staging-only and documents the workaround).

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
