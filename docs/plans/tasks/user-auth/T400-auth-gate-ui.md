# T400: Auth Gate + Google OAuth

**Status:** DONE
**Impact:** 9
**Complexity:** 4
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

GPU operations cost real money. Users need to authenticate before triggering them so we have an identity for billing, data recovery, and abuse prevention. Google OAuth is the lowest-friction option (~30% of our 40s male demographic will use it, one tap, no context switch).

## Solution

Build the auth gate modal + Google OAuth, fully working end-to-end. Modal triggers at "Create Video" (and other GPU buttons). Google Sign-In is real — user taps, Google returns ID token, backend verifies and stores email + google_id in per-user SQLite. Session cookie persists auth across page refreshes.

**No central DB yet.** Auth data lives in the user's existing per-user SQLite. This means single-device only — cross-device recovery comes in T405. This is fine for initial user testing.

---

## Context

### Relevant Files

**Frontend (new):**
- `src/frontend/src/stores/authStore.js` - NEW: Zustand store for auth state
- `src/frontend/src/components/AuthGateModal.jsx` - NEW: auth modal component
- `src/frontend/index.html` - Add Google Identity Services script tag

**Frontend (modify):**
- `src/frontend/src/stores/index.js` - Add authStore exports to barrel
- `src/frontend/src/utils/sessionInit.js` - Add session check on app load
- `src/frontend/src/App.jsx` - Mount AuthGateModal, check auth on init
- `src/frontend/src/containers/AnnotateContainer.jsx` - Gate "Create Annotated Video" button (line 1301)
- `src/frontend/src/containers/ExportButtonContainer.jsx` - Gate "Frame Video" and "Add Overlay" buttons (line 370)
- `src/frontend/src/components/CompareModelsButton.jsx` - Gate "Run Model Comparison" (line 103)

**Backend (modify):**
- `src/backend/app/routers/auth.py` - Add POST /api/auth/google, GET /api/auth/me
- `src/backend/app/database.py` - Add auth_profile + sessions tables to schema

### Related Tasks
- Blocks: T401 (OTP adds second auth method to this modal)
- Blocks: T500 (credits UI builds on auth state)

---

## Existing Codebase Patterns (MUST MATCH)

### Zustand Store Convention

Stores live in `src/frontend/src/stores/`. Follow the exact pattern from `galleryStore.js` / `exportStore.js`:

```javascript
import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  // State
  // Actions
  // Reset (called on profile switch)
}));

// Selector hooks
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useAuthEmail = () => useAuthStore((state) => state.email);
```

Then add to `src/frontend/src/stores/index.js`:
```javascript
export { useAuthStore, useIsAuthenticated, useAuthEmail } from './authStore';
```

### Modal Convention

Modals follow the pattern from `GameDetailsModal.jsx` / `ManageProfilesModal.jsx`:
- Props: `isOpen`, `onClose`
- Guard: `if (!isOpen) return null;`
- Backdrop: `<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">`
- Container: `<div className="bg-gray-800 rounded-lg border border-gray-700 max-w-md w-full mx-4">`
- Header with X close button
- Content in `<div className="p-4 space-y-4">`

### Button Component

Use the shared `Button` from `src/frontend/src/components/shared/Button.jsx`:
```jsx
import { Button } from './shared';
// Variants: primary (purple), secondary (gray), success (green), danger (red), ghost, outline
// Sizes: sm, md, lg
// Props: icon, loading, disabled, fullWidth
```

### API Calls

Use `fetch` with `API_BASE` from config. No axios for new code.
```javascript
import { API_BASE } from '../config';
const response = await fetch(`${API_BASE}/api/auth/google`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: idToken }),
});
```

Headers `X-User-ID` and `X-Profile-ID` are automatically injected by the patched `window.fetch` in `sessionInit.js` for any URL starting with `/api` or `${API_BASE}/api`.

### Backend Router Convention

Existing auth router at `src/backend/app/routers/auth.py`:
- Prefix: `/api/auth`
- Uses `get_current_user_id()` from `app.user_context`
- Returns Pydantic models
- Uses `logger = logging.getLogger(__name__)`

### Database Schema Convention

Tables created in `src/backend/app/database.py` inside `ensure_database()`. Add new tables alongside existing ones using `CREATE TABLE IF NOT EXISTS`. Write tracking uses `TrackedCursor` — all INSERT/UPDATE/DELETE statements are auto-detected for R2 sync.

---

## Architecture

### How Auth Fits Into the Existing System

```
CURRENT FLOW (no auth):
  App.jsx mount → initSession() → POST /api/auth/init
    → resolveUserId() generates guest_XXXXXXXX
    → X-User-ID header set on all requests
    → User data isolated in user_data/{user_id}/

NEW FLOW (with auth gate):
  App.jsx mount → initSession() → POST /api/auth/init (unchanged)
    → ALSO: check for session cookie → GET /api/auth/me
    → If valid session → authStore.isAuthenticated = true
    → If no session → user is anonymous (can upload, annotate)
    → User clicks GPU button → requireAuth() → shows AuthGateModal
    → Google sign-in → POST /api/auth/google → session cookie set
    → authStore.isAuthenticated = true → pendingAction() runs
```

The existing `X-User-ID` header system is UNCHANGED. The auth gate just adds identity (email) to an existing guest user. The user_id stays the same before and after auth.

### Session Cookie vs X-User-ID Header

These are two separate things:
- **X-User-ID header**: Identifies which data folder to use. Set from localStorage. Always present.
- **Session cookie**: Proves the user authenticated. httponly, set by backend. Used to check `isAuthenticated`.

Both coexist. The session cookie says "this guest_XXXXXXXX user has verified their email." The X-User-ID says "use this user's data folder."

---

## Detailed Implementation

### 1. authStore.js

```javascript
// src/frontend/src/stores/authStore.js
import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  // State
  isAuthenticated: false,
  email: null,
  showAuthModal: false,
  pendingAction: null,
  isCheckingSession: true,  // true until initial session check completes

  // Gate action: shows modal if not authenticated, runs action if authenticated
  requireAuth: (action) => {
    if (get().isAuthenticated) {
      action();
      return;
    }
    set({ showAuthModal: true, pendingAction: action });
  },

  // Called after successful Google sign-in (or OTP in T401)
  onAuthSuccess: (email) => {
    const { pendingAction } = get();
    set({
      isAuthenticated: true,
      email,
      showAuthModal: false,
      pendingAction: null,
    });
    // Run the action that was blocked by the auth gate
    if (pendingAction) {
      pendingAction();
    }
  },

  // Called on app load after session check
  setSessionState: (isAuthenticated, email = null) => {
    set({ isAuthenticated, email, isCheckingSession: false });
  },

  // Close modal without authenticating
  closeAuthModal: () => {
    set({ showAuthModal: false, pendingAction: null });
  },

  // Reset on profile switch
  reset: () => set({
    isAuthenticated: false,
    email: null,
    showAuthModal: false,
    pendingAction: null,
    isCheckingSession: false,
  }),
}));

// Selector hooks
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useAuthEmail = () => useAuthStore((state) => state.email);
export const useShowAuthModal = () => useAuthStore((state) => state.showAuthModal);
```

### 2. AuthGateModal.jsx

```jsx
// src/frontend/src/components/AuthGateModal.jsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './shared';
import { useAuthStore } from '../stores/authStore';
import { API_BASE } from '../config';

export function AuthGateModal() {
  const showAuthModal = useAuthStore((s) => s.showAuthModal);
  const closeAuthModal = useAuthStore((s) => s.closeAuthModal);
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const googleButtonRef = useRef(null);

  // Initialize Google Sign-In button when modal opens
  useEffect(() => {
    if (!showAuthModal || !googleButtonRef.current) return;
    if (!window.google?.accounts?.id) {
      console.warn('[AuthGateModal] Google Identity Services not loaded');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
    });

    window.google.accounts.id.renderButton(googleButtonRef.current, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      width: 360,
    });
  }, [showAuthModal]);

  const handleGoogleResponse = useCallback(async (response) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: response.credential }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Authentication failed');
      }

      const data = await res.json();
      onAuthSuccess(data.email);
    } catch (err) {
      console.error('[AuthGateModal] Google auth failed:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [onAuthSuccess]);

  if (!showAuthModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg border border-gray-700 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Create your first video</h2>
          <button onClick={closeAuthModal} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <p className="text-sm text-gray-300">
            Sign in to get started. Your annotations are saved and waiting.
          </p>

          {/* Error message */}
          {error && (
            <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Google Sign-In (rendered by GIS library) */}
          <div className="flex justify-center">
            <div ref={googleButtonRef} />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-700" />
            <span className="text-xs text-gray-500">or</span>
            <div className="flex-1 h-px bg-gray-700" />
          </div>

          {/* Email OTP (disabled until T401) */}
          <div className="space-y-3 opacity-50">
            <input
              type="email"
              placeholder="your@email.com"
              disabled
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <Button variant="secondary" fullWidth disabled>
              Send Code
            </Button>
            <p className="text-xs text-gray-500 text-center">
              Email sign-in coming soon
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Note:** T401 will replace the disabled email section with a working OTP flow. The same modal, same file — just enabling that section and adding API calls.

### 3. index.html — Add GIS Script

```html
<!-- src/frontend/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reel Ballers</title>
    <script src="https://accounts.google.com/gsi/client" async defer></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Also add `VITE_GOOGLE_CLIENT_ID` to `.env`:
```
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### 4. Backend: POST /api/auth/google

Add to existing `src/backend/app/routers/auth.py`:

```python
import secrets
from datetime import datetime, timedelta
from pydantic import BaseModel
import httpx

class GoogleAuthRequest(BaseModel):
    token: str

class AuthResponse(BaseModel):
    email: str
    user_id: str

@router.post("/google", response_model=AuthResponse)
async def google_auth(body: GoogleAuthRequest):
    """
    Verify Google ID token and create session.

    Frontend sends the credential JWT from Google Identity Services.
    Backend verifies it, stores email + google_id in per-user SQLite,
    and creates a session.
    """
    user_id = get_current_user_id()

    # Verify token with Google
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://oauth2.googleapis.com/tokeninfo?id_token={body.token}"
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google token")
        token_data = resp.json()

    email = token_data.get("email")
    google_id = token_data.get("sub")
    if not email or not token_data.get("email_verified"):
        raise HTTPException(status_code=401, detail="Email not verified by Google")

    # Store auth data in per-user SQLite
    from app.database import get_db
    db = get_db()
    cursor = db.cursor()

    # Upsert auth_profile (single row per user)
    cursor.execute("""
        INSERT INTO auth_profile (id, email, google_id, verified_at)
        VALUES (1, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            google_id = excluded.google_id,
            verified_at = datetime('now')
    """, (email, google_id))

    # Create session
    session_id = secrets.token_urlsafe(32)
    expires_at = (datetime.utcnow() + timedelta(days=30)).isoformat()
    cursor.execute("""
        INSERT INTO sessions (session_id, expires_at)
        VALUES (?, ?)
    """, (session_id, expires_at))

    db.commit()

    # Set session cookie on response
    from fastapi.responses import JSONResponse
    response = JSONResponse(content={
        "email": email,
        "user_id": user_id,
    })
    response.set_cookie(
        key="rb_session",
        value=session_id,
        max_age=30 * 24 * 60 * 60,  # 30 days
        httponly=True,
        samesite="strict",
        secure=True,  # Set False for localhost dev
    )
    return response
```

### 5. Backend: GET /api/auth/me

Add to existing `src/backend/app/routers/auth.py`:

```python
@router.get("/me")
async def auth_me(request: Request):
    """
    Check if current session is valid. Called on app load.

    Returns user info if session cookie is valid, 401 if not.
    Frontend uses this to set authStore.isAuthenticated on mount.
    """
    from fastapi import Request
    session_id = request.cookies.get("rb_session")
    if not session_id:
        raise HTTPException(status_code=401, detail="No session")

    user_id = get_current_user_id()
    from app.database import get_db
    db = get_db()
    cursor = db.cursor()

    # Check session exists and not expired
    cursor.execute("""
        SELECT session_id, expires_at FROM sessions
        WHERE session_id = ?
    """, (session_id,))
    row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid session")

    if datetime.fromisoformat(row['expires_at']) < datetime.utcnow():
        # Clean up expired session
        cursor.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired")

    # Get auth profile
    cursor.execute("SELECT email, google_id FROM auth_profile WHERE id = 1")
    profile = cursor.fetchone()

    return {
        "email": profile['email'] if profile else None,
        "user_id": user_id,
        "is_authenticated": True,
    }
```

### 6. Backend: Database Schema

Add to `src/backend/app/database.py` inside `ensure_database()`, alongside the existing CREATE TABLE statements:

```python
            # Auth tables (T400)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS auth_profile (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    email TEXT,
                    google_id TEXT,
                    verified_at TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    created_at TEXT DEFAULT (datetime('now')),
                    expires_at TEXT NOT NULL
                )
            """)
```

Note: `auth_profile` has `CHECK (id = 1)` — exactly one row per user, like the existing `db_version` table pattern.

### 7. sessionInit.js — Add Session Check

Modify `initSession()` in `src/frontend/src/utils/sessionInit.js`:

```javascript
export async function initSession() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const response = await fetch(`${API_BASE}/api/auth/init`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Session init failed: ${response.status}`);
    }

    const data = await response.json();
    _profileId = data.profile_id;
    _currentProfileId = data.profile_id;

    // T400: Check if user has an active session
    try {
      const authResponse = await fetch(`${API_BASE}/api/auth/me`);
      if (authResponse.ok) {
        const authData = await authResponse.json();
        // Import dynamically to avoid circular deps
        const { useAuthStore } = await import('../stores/authStore');
        useAuthStore.getState().setSessionState(true, authData.email);
      } else {
        const { useAuthStore } = await import('../stores/authStore');
        useAuthStore.getState().setSessionState(false);
      }
    } catch {
      // No session — user is anonymous, that's fine
      const { useAuthStore } = await import('../stores/authStore');
      useAuthStore.getState().setSessionState(false);
    }

    return {
      profileId: data.profile_id,
      userId: data.user_id,
      isNewUser: data.is_new_user,
    };
  })();

  return _initPromise;
}
```

### 8. App.jsx — Mount AuthGateModal

Add to `src/frontend/src/App.jsx`:

```jsx
// Add import at top
import { AuthGateModal } from './components/AuthGateModal';

// Add inside App component JSX, at the end (before closing fragment/div):
<AuthGateModal />
```

The modal reads its own `showAuthModal` state from the store — no props needed from App.

### 9. Gate GPU Buttons

#### AnnotateContainer.jsx (line ~1301)

The "Create Annotated Video" button calls `onCreateAnnotatedVideo(getExportData())`. This prop comes from the container, which calls `handleCreateAnnotatedVideo`. Gate it in the container:

```javascript
// At top of AnnotateContainer component:
import { useAuthStore } from '../stores/authStore';

// Inside component:
const requireAuth = useAuthStore((s) => s.requireAuth);

// Modify handleCreateAnnotatedVideo:
const handleCreateAnnotatedVideoGated = useCallback((clipData) => {
  requireAuth(() => handleCreateAnnotatedVideo(clipData));
}, [requireAuth, handleCreateAnnotatedVideo]);

// Pass handleCreateAnnotatedVideoGated instead of handleCreateAnnotatedVideo to the view
```

#### ExportButtonContainer.jsx (line ~370)

The `handleExport` function handles both Framing and Overlay exports. Gate it at the top:

```javascript
// At top:
import { useAuthStore } from '../stores/authStore';

// Inside component:
const requireAuth = useAuthStore((s) => s.requireAuth);

// Wrap handleExport:
const handleExportGated = async () => {
  requireAuth(() => handleExport());
};

// Use handleExportGated where handleExport was used
```

#### CompareModelsButton.jsx (line ~103)

```javascript
// At top:
import { useAuthStore } from '../stores/authStore';

// Inside component:
const requireAuth = useAuthStore((s) => s.requireAuth);

// Wrap handleCompare:
const handleCompareGated = () => {
  requireAuth(() => handleCompare());
};

// Use handleCompareGated in the button onClick
```

---

## Google Cloud Setup (User Manual Step)

Before implementation can begin, the developer must:

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID
3. Application type: **Web application**
4. Authorized JavaScript origins: `http://localhost:5173` (dev), `https://reel-ballers-staging.pages.dev` (staging)
5. Authorized redirect URIs: same as origins
6. Copy the Client ID → set as `VITE_GOOGLE_CLIENT_ID` in `.env`

No client secret needed — GIS uses the ID token flow (implicit), not the authorization code flow.

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| GIS script fails to load (network) | Google button area is empty; email flow still works (after T401) |
| Google popup blocked by browser | User sees nothing — show error after timeout: "Popup may have been blocked" |
| Google token verification fails | Show inline error: "Authentication failed. Please try again." |
| User closes modal without authing | pendingAction cleared, GPU action not executed, user stays on current screen |
| Page refresh while modal is open | Modal closes (showAuthModal defaults to false), session check runs |
| Multiple GPU buttons clicked fast | Only first requireAuth() opens modal; second call sees modal already open |
| Session cookie expired | GET /api/auth/me returns 401 → isAuthenticated = false → next GPU button shows modal |
| Backend down during auth | handleGoogleResponse catches fetch error, shows network error message |

---

## What T401 Changes in This Code

T401 only modifies `AuthGateModal.jsx`:
1. Removes `opacity-50` and `disabled` from email input and Send Code button
2. Adds `handleSendCode` → POST /api/auth/send-otp
3. Adds OTP entry screen (6 digit inputs) between email and success
4. Adds `handleVerifyOtp` → POST /api/auth/verify-otp → calls same `onAuthSuccess(email)`
5. Adds error states for invalid code, expired, rate limit

No changes to authStore, gate pattern, backend schema, or session logic. The store's `onAuthSuccess` callback works the same for both Google and OTP.

---

## Implementation Steps

### Steps
1. [ ] **User setup**: Create Google Cloud OAuth client ID, get `VITE_GOOGLE_CLIENT_ID`
2. [ ] **index.html**: Add `<script src="https://accounts.google.com/gsi/client" async defer></script>`
3. [ ] **database.py**: Add `auth_profile` and `sessions` tables in `ensure_database()`
4. [ ] **auth.py**: Add `POST /api/auth/google` endpoint (verify token, upsert auth_profile, create session, set cookie)
5. [ ] **auth.py**: Add `GET /api/auth/me` endpoint (validate session cookie, return user info)
6. [ ] **authStore.js**: Create store with `requireAuth`, `onAuthSuccess`, `setSessionState`, `closeAuthModal`
7. [ ] **stores/index.js**: Add authStore exports to barrel
8. [ ] **AuthGateModal.jsx**: Create modal with GIS button rendering + disabled email section
9. [ ] **sessionInit.js**: Add session check (GET /api/auth/me) inside `initSession()`
10. [ ] **App.jsx**: Mount `<AuthGateModal />` in JSX
11. [ ] **AnnotateContainer.jsx**: Gate `handleCreateAnnotatedVideo` with `requireAuth`
12. [ ] **ExportButtonContainer.jsx**: Gate `handleExport` with `requireAuth`
13. [ ] **CompareModelsButton.jsx**: Gate `handleCompare` with `requireAuth`
14. [ ] **Test**: Google sign-in → authenticated → GPU action proceeds
15. [ ] **Test**: Page refresh → session preserved → no re-auth needed
16. [ ] **Test**: Unauthenticated user can still upload and annotate freely

## Acceptance Criteria

- [ ] "Create Annotated Video" when unauthenticated → shows auth modal
- [ ] "Frame Video" / "Add Overlay" when unauthenticated → shows auth modal
- [ ] "Run Model Comparison" when unauthenticated → shows auth modal
- [ ] "Continue with Google" → real Google popup → real sign-in → success
- [ ] On auth success: modal dismisses, original GPU action proceeds automatically
- [ ] Session persists across page refresh (cookie + /api/auth/me check)
- [ ] Already authenticated → GPU buttons work without modal
- [ ] Upload and annotate work without authentication (no gate)
- [ ] Email input visible but disabled with "Email sign-in coming soon" note
- [ ] Modal responsive on mobile
- [ ] Backend stores email + google_id in per-user SQLite auth_profile table
- [ ] Session cookie is httponly + samesite=strict
