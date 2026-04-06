# T430: Account Settings

**Status:** DONE
**Impact:** 4
**Complexity:** 2
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Authenticated users need a place to see their account info, link additional login methods, and log out.

## Solution

Settings page (or panel) accessible from the header/nav. Shows email, linked Google account, credit balance, and logout button. When logged in via Google, show the user's Google profile image as their avatar in the nav bar (replaces generic icon).

## Context

### Relevant Files
- `src/frontend/src/components/AccountSettings.jsx` - NEW
- `src/frontend/src/components/Header.jsx` or nav component - Add settings link
- `src/backend/app/routers/auth.py` - GET /api/auth/me, POST /api/auth/logout

### Related Tasks
- Depends on: T420 (session management), T425 (Google linking)
- Related: T505 (credit balance display may appear here too)

### Technical Notes

**Settings content:**
- Email address (read-only)
- Google account: linked or "Link Google Account" button
- Credit balance + link to purchase (from monetization epic)
- Logout button (clears session cookie)

**Google profile image:**
- Google OAuth `tokeninfo` response includes `picture` field (URL to profile photo)
- Store `picture_url` in auth DB during Google login (T400/T405 already verifies the token)
- Return `picture_url` in GET /api/auth/me response
- Display as circular avatar in nav bar when logged in (fall back to initials/icon if no image)

## Implementation

### Steps
1. [ ] Store Google `picture` URL in auth DB during login
2. [ ] Return `picture_url` in GET /api/auth/me response
3. [ ] Show Google profile image as avatar in nav bar (circular, ~32px)
4. [ ] Create AccountSettings component
5. [ ] Add route/link in navigation (click avatar to open settings)
6. [ ] Display user info from GET /api/auth/me
7. [ ] Add logout functionality (POST /api/auth/logout + clear local state)
8. [ ] Add "Link Google" button (if not yet linked)

## Acceptance Criteria

- [ ] Google profile image shown as avatar in nav bar when logged in via Google
- [ ] Falls back to initials or generic icon when no image available
- [ ] Clicking avatar opens settings panel
- [ ] Settings accessible from nav
- [ ] Shows email address
- [ ] Shows Google link status
- [ ] Logout clears session and returns to anonymous state
- [ ] "Link Google" button works (if T425 complete)
