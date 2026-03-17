# T430: Account Settings

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Authenticated users need a place to see their account info, link additional login methods, and log out.

## Solution

Settings page (or panel) accessible from the header/nav. Shows email, linked Google account, credit balance, and logout button.

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

## Implementation

### Steps
1. [ ] Create AccountSettings component
2. [ ] Add route/link in navigation
3. [ ] Display user info from GET /api/auth/me
4. [ ] Add logout functionality (POST /api/auth/logout + clear local state)
5. [ ] Add "Link Google" button (if not yet linked)

## Acceptance Criteria

- [ ] Settings accessible from nav
- [ ] Shows email address
- [ ] Shows Google link status
- [ ] Logout clears session and returns to anonymous state
- [ ] "Link Google" button works (if T425 complete)
