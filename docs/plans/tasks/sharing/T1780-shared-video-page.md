# T1780: Shared Video Player Page

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

When a recipient clicks the share link from their email, there's no page to land on. Need a route that authenticates the recipient, verifies access, and shows the video player.

## Solution

Create a `/shared/:shareToken` route that handles two access modes:

- **Public links** (`is_public=1`): Render the video player immediately — no login required. Show sharer attribution (e.g., "Shared by {name}").
- **Private links** (`is_public=0`): If not signed in, show auth gate with recipient email pre-filled. After auth, verify email matches the share record. If authorized, render the video player. If not, show 403.

Both modes reuse the gallery VideoPlayer component.

## Context

### Relevant Files (REQUIRED)
- New: `src/frontend/src/components/SharedVideoPage.jsx` (or similar) - Main page component
- `src/frontend/src/App.jsx` - Add route for `/shared/:shareToken`
- `src/frontend/src/components/VideoPlayer/` - Reuse existing player
- `src/frontend/src/components/Auth/` - Auth gate, need to support pre-filled email + redirect back
- `src/backend/app/routers/auth.py` - May need to pass share token through login redirect

### Related Tasks
- Depends on: T1750 (backend GET `/shared/{shareToken}` endpoint)
- Blocks: T1790 (watched event fires from this page)

### Technical Notes

- **Public vs private flow:** On page load, fetch `GET /shared/{shareToken}` (no auth). Backend returns `{is_public, recipient_email}` as metadata. If `is_public=1`, response includes full video metadata + stream URL — render player immediately. If `is_public=0`, proceed to auth flow.
- **Auth flow (private only):** When unauthenticated user hits a private link, show auth modal with recipient email pre-filled. After login, redirect back to the same `/shared/:shareToken` URL. The share token should be preserved across the auth redirect.
- **Access check (private only):** After auth, frontend calls GET `/shared/{shareToken}` with credentials. Backend returns 403 if email mismatch, 410 if revoked, 200 with video metadata if authorized.
- **Video player:** Reuse the gallery VideoPlayer component. The backend response includes the stream URL for the shared video. Show sharer name/attribution on public links.

## Implementation

### Steps
1. [ ] Add `/shared/:shareToken` route to App.jsx
2. [ ] Create SharedVideoPage component (loading → public player / auth gate → player or error)
3. [ ] Fetch share metadata on mount — branch on `is_public`
4. [ ] Public path: render video player immediately with sharer attribution, no auth needed
5. [ ] Private path: fetch recipient email, show auth gate with pre-fill
6. [ ] Handle authenticated state (private): fetch share details, verify access, render player
7. [ ] Error states: 403 (wrong email, private only), 410 (revoked), 404 (invalid token)
8. [ ] Auth redirect: preserve `/shared/:shareToken` URL across sign-in flow

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] `/shared/:shareToken` route exists and renders SharedVideoPage
- [ ] Public links render video player immediately without login
- [ ] Public links show sharer attribution
- [ ] Private links: unauthenticated users see auth gate with recipient email pre-filled
- [ ] After sign-in, user is redirected back to the shared video page
- [ ] Authorized recipient sees video player and can play the video
- [ ] Wrong email on private link shows clear "not authorized" message (403)
- [ ] Revoked share shows "link no longer active" message (410)
- [ ] Invalid token shows "not found" message (404)
