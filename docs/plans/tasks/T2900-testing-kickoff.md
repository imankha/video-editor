# T2900 Testing Kickoff: Invite Button + Email

## What was built

The "Invite a Friend" feature across frontend, backend, and landing page. Branch: `feature/T2900-invite-button-email`.

### Architecture

```
User clicks "Invite" button
  → Frontend fetches GET /api/me/invite-code
  → Gets deterministic 8-char hex code (sha256 of user_id)
  → Builds mailto: URL with pitch email + referral link
  → Opens user's email client

Referred visitor lands on reelballers.com?ref=CODE
  → Landing page passes ?ref= through to CTA href (app.reelballers.com?ref=CODE)
  → App captures ?ref= into sessionStorage('referralCode') on mount
  → On signup (Google or OTP), ref is sent in request body
  → Backend logs it (T2910 will store it in referrals table)
```

### Files changed (14 total)

**Backend:**
- `src/backend/app/routers/users.py` — NEW: `GET /api/me/invite-code` endpoint
- `src/backend/app/routers/auth.py` — Added `Optional[str] ref` to GoogleAuthRequest, VerifyOtpRequest, and `_find_or_create_user()`
- `src/backend/app/routers/__init__.py` — Registered users_router
- `src/backend/app/main.py` — Included users_router

**Frontend:**
- `src/frontend/src/utils/inviteEmail.js` — NEW: `buildInviteMailtoUrl()` pure utility
- `src/frontend/src/components/ProjectManager.jsx` — Invite button in top-right controls
- `src/frontend/src/components/SharedVideoOverlay.jsx` — Invite CTA after video plays
- `src/frontend/src/components/SharedAnnotationView.jsx` — Invite CTA during loading
- `src/frontend/src/App.jsx` — Captures `?ref=` to sessionStorage on mount
- `src/frontend/src/utils/googleAuth.js` — Sends ref in Google auth request body
- `src/frontend/src/components/auth/OtpAuthForm.jsx` — Sends ref in OTP verify body

**Landing page:**
- `src/landing/src/App.tsx` — CTA button in hero + `?ref=` passthrough

**Tests:**
- `src/backend/tests/test_invite.py` — 25 backend tests
- `src/frontend/src/utils/inviteEmail.test.js` — 29 frontend tests
- `src/frontend/src/utils/referralCapture.test.js` — 11 frontend tests

## How to test manually

### 1. Backend endpoint (quick check)

```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
# Start server:
cd src/backend && uvicorn app.main:app --reload
# Test endpoint (use X-User-ID header for dev auth):
curl -H "X-User-ID: test-user" http://localhost:8000/api/me/invite-code
# Expected: {"invite_code":"<8 hex chars>","invite_url":"https://www.reelballers.com?ref=<code>"}
```

### 2. Frontend invite button (browser test)

```bash
cd src/frontend && npm run dev
```

1. Open http://localhost:5173
2. Sign in (use auth bypass for testing — see frontend CLAUDE.md)
3. You should be on the ProjectManager screen (home)
4. Look for "Invite" button with Share2 icon in top-right controls area
5. Click it → should open your email client with pre-filled pitch email
6. Verify: subject mentions athlete name (or "my kid"), body has referral link

### 3. Referral capture (browser test)

1. Navigate to http://localhost:5173?ref=testcode123
2. Open DevTools → Application → Session Storage
3. Should see `referralCode: testcode123`
4. If you sign up (new account), check Network tab — the auth POST should include `"ref": "testcode123"` in request body

### 4. Landing page CTA

```bash
cd src/landing && npm run dev
```

1. Open the landing page
2. Should see a "Get Started Free" button in the hero section
3. Button should link to `https://app.reelballers.com`
4. Navigate to landing page with `?ref=abc123`
5. Button href should now be `https://app.reelballers.com?ref=abc123`

### 5. Shared content invite CTAs

- **SharedVideoOverlay**: Open a shared video link while authenticated → should see "Invite a Friend to Reel Ballers" button floating at bottom of video
- **SharedAnnotationView**: Open a shared annotation link while authenticated → should see invite link below the loading spinner

### 6. Auth flow with ref

Test that signup with a ref code doesn't error:
- Set sessionStorage manually: `sessionStorage.setItem('referralCode', 'test123')`
- Sign up with a new account (Google or OTP)
- Check backend logs for: `[Auth] login — created user: <id> (<email>) referred_by=test123`

## Known edge cases to verify

1. **No profile set yet**: Invite email should use "my kid" as athlete name (not crash)
2. **Click invite while not authenticated**: Button only renders when `isAuthenticated` is true, so this shouldn't happen — but verify the button disappears when logged out
3. **Multiple ref codes**: Navigate to `?ref=first`, then manually type `?ref=second` — sessionStorage should keep "first" (first-attribution-wins)
4. **Existing user clicks invite link**: ref is stored in sessionStorage but login (not signup) does NOT log referral — verify no crash
5. **Empty email in authStore**: Signature line should be omitted from invite email
6. **Landing page without ref**: CTA should just link to `https://app.reelballers.com` (no `?ref=` appended)

## Potential issues to watch for

1. **CORS**: The `/api/me/invite-code` endpoint is on a new router — verify it's covered by the existing CORS middleware (it should be, since it's registered on the same app)
2. **Auth middleware**: The `users_router` relies on the auth middleware setting user context. Verify that unauthenticated requests get 401 (not 500 RuntimeError)
3. **SharedVideoOverlay z-index**: The invite CTA is `absolute bottom-4` inside the Overlay — verify it doesn't overlap with video controls
4. **mailto: URL length**: Very long athlete names or emails could make the mailto URL exceed browser limits (~2000 chars). Test with a normal-length name.
5. **sessionStorage vs localStorage**: We use sessionStorage intentionally — new tabs should NOT carry the ref code. Verify this behavior.
6. **Landing page TypeScript**: `src/landing/src/App.tsx` — verify `useMemo` import and `ctaHref` usage don't cause TS errors in the landing page build

## Run all tests

```bash
# Backend (25 tests)
cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_invite.py -v

# Frontend (40 tests)
cd src/frontend && npx vitest run src/utils/inviteEmail.test.js src/utils/referralCapture.test.js

# Frontend build check (catches JSX/import errors)
cd src/frontend && npx vite build
```

## What NOT to test (T2910's job)

- Referral table creation in Postgres
- `record_referral()` function
- `invite_code` column on users table
- Attribution resolution (who referred whom)
- Referral graph queries
