# T1040: Force Login on Add Game

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

Guest users can currently add games without logging in. This means they invest significant time (uploading a multi-GB video, annotating clips) before being prompted to create an account. If they leave and return, their guest session may expire and they lose everything.

Forcing login at the "Add Game" action ensures users have a persistent identity before investing effort, and gives us a real user to attribute the data to.

## Solution

When a guest user clicks "Add Game", show the auth gate (Google One Tap / login modal) instead of opening the game upload flow. After successful login, proceed to game upload normally.

The guest init flow still works for browsing the app, but the first action that creates persistent data (adding a game) requires authentication.

## Context

### Relevant Files
- `src/frontend/src/components/GameDetailsModal.jsx` — Game upload modal
- `src/frontend/src/components/HomeScreen.jsx` — "Add Game" button location
- `src/frontend/src/components/AuthGate.jsx` — Auth modal component
- `src/frontend/src/stores/authStore.js` — Auth state (isGuest, isAuthenticated)

### Related Tasks
- T400 (Auth Gate + Google OAuth) — DONE
- T435 (Google One Tap Auto-Prompt) — DONE
- T450 (Remove DEFAULT_USER_ID) — DONE

### Technical Notes
- `authStore` has `isGuest` flag to distinguish guests from logged-in users
- Auth gate already exists and handles Google OAuth + Email OTP
- After login, guest data migrates to the authenticated account (T415 Smart Guest Merge)

## Implementation

### Steps
1. [ ] Check `isGuest` when user clicks "Add Game"
2. [ ] If guest, show auth gate instead of game upload
3. [ ] After successful auth, automatically open game upload
4. [ ] Test: guest clicks Add Game → login → game upload opens

## Acceptance Criteria

- [ ] Guest users cannot add a game without logging in first
- [ ] Auth gate appears when guest clicks "Add Game"
- [ ] After login, game upload flow starts automatically
- [ ] Already-authenticated users see no change in behavior
