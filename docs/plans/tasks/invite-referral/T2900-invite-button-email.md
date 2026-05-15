# T2900: Invite Button + Email

**Status:** TODO
**Epic:** [Invite & Referral](EPIC.md)
**Impact:** 8
**Complexity:** 3
**Created:** 2026-05-15
**Depends on:** None (foundation task)

## Problem

Alpha testers need an easy way to invite friends to Reel Ballers. There's no invite mechanism in the app -- users would have to manually compose an email and find the URL.

## Solution

### 1. Invite Code Generation (Backend)

Each user gets a stable invite code derived from their user_id. No new table needed for T2900 -- the code is deterministic.

```python
# Short, URL-safe invite code from user_id
import hashlib
def get_invite_code(user_id: str) -> str:
    return hashlib.sha256(user_id.encode()).hexdigest()[:8]
```

**New endpoint:**

```
GET /api/me/invite-code
```

Returns `{ "invite_code": "a1b2c3d4", "invite_url": "https://www.reelballers.com?ref=a1b2c3d4" }`.

### 2. Invite Button (Frontend)

Add "Invite a Friend" button in two locations:

**ProjectsScreen (home):** Prominent button near the top of the screen, alongside existing actions. Uses the app's accent style to stand out.

**SharedVideoOverlay / SharedAnnotationView:** After a recipient views shared content, show an "Invite a Friend" CTA if they're signed in.

### 3. mailto: Composition

Clicking the button opens the user's email client via `mailto:` with a pre-filled subject and body:

```
Subject: Check out how I make highlight reels for [athlete_name]

Body:
Hey!

I've been using Reel Ballers to make highlight reels for [athlete_name] and it's been amazing. You upload your game footage and within minutes you have professional-quality highlights ready for Instagram or TikTok.

The video quality is incredible -- way better than what you get from Veo or Trace. And it takes minutes, not hours.

Check it out: https://www.reelballers.com?ref=[invite_code]

[user_name]
```

- `[athlete_name]` from profile fields (T1610). Falls back to "my kid" if not set.
- `[user_name]` from profile or email. Falls back to empty (no signature line).
- `[invite_code]` from the `/api/me/invite-code` endpoint.

### 4. Landing Page: Invite Code Passthrough

The landing page (`src/landing/`) must:
1. Read `?ref=` from the URL
2. Pass it through to the app CTA link: `https://app.reelballers.com?ref=a1b2c3d4`

This is a small change to the landing page's CTA button href.

### 5. App: Store Referral Code on Arrival

When a new visitor arrives at `app.reelballers.com?ref=a1b2c3d4`:
1. Store the ref code in `sessionStorage` (survives page navigation, not tabs)
2. On signup, include the ref code in the auth request body

The actual referral record creation is handled by T2910 (Referral Graph).

## Files Affected

| File | Change |
|------|--------|
| `src/backend/app/routers/auth.py` | Accept `ref` param on signup, store in session |
| `src/backend/app/routers/users.py` (or new) | `GET /api/me/invite-code` endpoint |
| `src/frontend/src/screens/ProjectsScreen.jsx` | Add invite button |
| `src/frontend/src/utils/inviteEmail.js` (new) | mailto: URL builder |
| `src/landing/src/App.tsx` | Pass `?ref=` through CTA links |

## Edge Cases

- **No profile set**: Use "my kid" / empty name in email template
- **Already-existing user clicks invite link**: ref code is a no-op (they already have an account)
- **Multiple invite codes**: First one stored wins (sessionStorage doesn't overwrite if present)

## Test Scope

- **Frontend Unit**: mailto URL generation with various profile states
- **Backend**: invite-code endpoint returns consistent code for same user_id
- **E2E**: Invite button visible, click opens mailto (can verify href attribute)
