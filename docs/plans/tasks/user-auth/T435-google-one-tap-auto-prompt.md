# T435: Google One Tap Auto-Prompt

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-04-06
**Updated:** 2026-04-06

## Problem

Google sign-in currently requires 3 steps: user clicks "Create Video" -> auth modal opens -> user clicks Google button. Most users who have a Google session in their browser could be converted with zero friction if we showed the One Tap prompt automatically on page load.

## Solution

After session init resolves and the user is a guest, call `google.accounts.id.prompt()` to show Google's floating One Tap UI in the top-right corner. If the user clicks it, they're authenticated immediately (same flow as AuthGateModal). If they dismiss it, Google handles cooldown automatically (exponential backoff, won't re-show for increasing intervals).

## Context

### Relevant Files
- `src/frontend/src/App.jsx` - Add One Tap prompt after session init
- `src/frontend/src/components/AuthGateModal.jsx` - Existing Google callback handler (reuse pattern)
- `src/frontend/src/stores/authStore.js` - `onAuthSuccess()` called on sign-in
- `src/frontend/src/utils/sessionInit.js` - Session init (must complete before prompting)

### Related Tasks
- Depends on: T400 (Google OAuth infrastructure already exists)
- Related: T401 (Email OTP — separate auth path for non-Google users)
- Related: T430 (Account Settings — avatar will show after One Tap sign-in)

### Technical Notes

**Google Identity Services `prompt()` behavior:**
- Only shows for users who are signed into Google in their browser
- Google manages dismiss cooldown (exponential backoff) — no app-side logic needed
- If user has multiple Google accounts, shows account chooser
- Returns a notification object with status (dismissed, skipped, etc.)
- Does NOT show if `renderButton()` was already called in the same page context with the same client ID — coordinate with AuthGateModal

**Implementation approach:**
1. Create a `GoogleOneTap` component that runs after session init
2. On mount (guest only): call `google.accounts.id.initialize()` + `prompt()`
3. Callback handler: POST to `/api/auth/google` (same as AuthGateModal)
4. On success: call `onAuthSuccess(email, userId, pictureUrl)`
5. Cleanup: cancel prompt on unmount or when user authenticates

**Key considerations:**
- Must wait for Google Identity Services script to load (`window.google.accounts.id`)
- Must wait for session init to complete (know if user is already authenticated)
- Don't show prompt if AuthGateModal is open (avoid double prompts)
- `referrerPolicy="no-referrer"` on avatar images (Google CDN)

## Implementation

### Steps
1. [ ] Create `GoogleOneTap.jsx` component
2. [ ] Initialize GIS and call `prompt()` for guest users after session init
3. [ ] Handle callback (POST /api/auth/google, same as AuthGateModal)
4. [ ] Render component in App.jsx (after session init, before AuthGateModal)
5. [ ] Suppress prompt when AuthGateModal is open
6. [ ] Test: guest lands on page -> One Tap appears -> click -> authenticated
7. [ ] Test: dismiss -> prompt doesn't reappear (Google cooldown)
8. [ ] Test: already authenticated -> no prompt shown

## Acceptance Criteria

- [ ] Google One Tap prompt appears automatically for guest users on page load
- [ ] Clicking the prompt signs in the user (same outcome as AuthGateModal flow)
- [ ] Prompt does not appear for already-authenticated users
- [ ] Prompt does not appear simultaneously with AuthGateModal
- [ ] Dismissing the prompt respects Google's built-in cooldown
- [ ] Avatar and account settings work after One Tap sign-in (T430)
