# T1780: Shared Video Player Page

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

When a recipient clicks the share link from their email, there's no page to land on. Need a route that authenticates the recipient, verifies access, and shows the video player.

## Solution

Create a `/shared/:shareToken` route. If not signed in, show auth gate with recipient email pre-filled. After auth, verify email matches the share record. If authorized, render the video player (reused from gallery). If not, show 403.

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

- **Auth flow with share token:** When unauthenticated user hits `/shared/:shareToken`, show auth modal. After login, redirect back to the same `/shared/:shareToken` URL. The share token should be preserved across the auth redirect.
- **Email pre-fill:** Backend GET `/shared/{shareToken}` can return recipient_email even for unauthenticated requests (just the email, not the video). Frontend uses this to pre-fill the auth form.
- **Access check:** After auth, frontend calls GET `/shared/{shareToken}` with credentials. Backend returns 403 if email mismatch, 410 if revoked, 200 with video metadata if authorized.
- **Video player:** Reuse the gallery VideoPlayer component. The backend response includes the stream URL for the shared video.

## Implementation

### Steps
1. [ ] Add `/shared/:shareToken` route to App.jsx
2. [ ] Create SharedVideoPage component (loading → auth gate → player or error)
3. [ ] Handle unauthenticated state: fetch recipient email from share token, show auth with pre-fill
4. [ ] Handle authenticated state: fetch share details, verify access, render player
5. [ ] Error states: 403 (wrong email), 410 (revoked), 404 (invalid token)
6. [ ] Auth redirect: preserve `/shared/:shareToken` URL across sign-in flow

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] `/shared/:shareToken` route exists and renders SharedVideoPage
- [ ] Unauthenticated users see auth gate with recipient email pre-filled
- [ ] After sign-in, user is redirected back to the shared video page
- [ ] Authorized recipient sees video player and can play the video
- [ ] Wrong email shows clear "not authorized" message (403)
- [ ] Revoked share shows "link no longer active" message (410)
- [ ] Invalid token shows "not found" message (404)
