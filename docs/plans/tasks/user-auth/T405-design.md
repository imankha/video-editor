# T405 Design: Central Auth + Cross-Device Recovery

**Status:** DRAFT
**Author:** Architect Agent
**Date:** 2026-03-16

## Current State ("As Is")

### Architecture

```
Frontend                          Backend                        Storage
┌──────────────────┐    ┌─────────────────────────┐    ┌──────────────────┐
│ sessionInit.js   │    │ Middleware (db_sync.py)  │    │ Per-user SQLite  │
│ resolveUserId()  │───>│ Read X-User-ID header   │───>│ auth_profile     │
│  ?user= param    │    │ set_current_user_id()    │    │ sessions         │
│  localStorage    │    │                         │    │                  │
│  guest_xxx gen   │    │ auth.py                  │    │ R2               │
│                  │    │ /google → per-user DB    │    │ {env}/users/{id} │
│ X-User-ID header │    │ /me → per-user DB       │    │                  │
│ on every request │    │                         │    │                  │
└──────────────────┘    └─────────────────────────┘    └──────────────────┘
```

### User ID Resolution (Current)

```
Frontend loads → resolveUserId():
  1. ?user= URL param → localStorage → X-User-ID header     (pre-auth hack)
  2. localStorage 'reel-ballers-user-id' → X-User-ID header  (returning visitor)
  3. Generate guest_XXXXXXXX → localStorage → X-User-ID       (new visitor)

Backend middleware reads X-User-ID → set_current_user_id() → all DB/R2 paths use it
```

### Session Cookie Flow (Current)

```
POST /api/auth/google:
  1. Verify Google JWT
  2. Store email+google_id in per-user SQLite (auth_profile, id=1)
  3. Generate session_id → per-user SQLite (sessions table)
  4. Set rb_session cookie

GET /api/auth/me:
  1. Read rb_session cookie
  2. REQUIRES X-User-ID header to find correct per-user DB ← PROBLEM
  3. Query sessions table in that user's DB
  4. Return email + is_authenticated
```

### Limitations

1. **No cross-device recovery** — session is in per-user SQLite, cookie alone can't find it
2. **Client controls identity** — X-User-ID header is trusted, any value accepted
3. **?user= param** is a pre-auth hack that bypasses real identity
4. **No email→user lookup** — can't answer "which user owns this email?"
5. **ProfileDropdown shows raw user ID** ("b") instead of email or "Guest"
6. **No login button** — only auth trigger is GPU gate modal

---

## Target State ("Should Be")

### Architecture

```
Frontend                          Backend                        Storage
┌──────────────────┐    ┌─────────────────────────┐    ┌──────────────────┐
│ sessionInit.js   │    │ Middleware (db_sync.py)  │    │ Cloudflare D1    │
│ No ?user= param  │    │ Read rb_session cookie   │    │ users            │
│ No localStorage  │───>│ D1: session → user_id    │───>│ sessions         │
│ for user ID      │    │ set_current_user_id()    │    │ otp_codes        │
│                  │    │                         │    │                  │
│ rb_session cookie│    │ auth.py                  │    │ Per-user SQLite  │
│ sent by browser  │    │ /google → D1             │    │ (app data only)  │
│                  │    │ /me → D1                 │    │                  │
│ X-User-ID header │    │ /init-guest → D1         │    │ R2               │
│ set from /init   │    │                         │    │ {env}/users/{id} │
└──────────────────┘    └─────────────────────────┘    └──────────────────┘
```

### Key Design Decision: Server-Issued User IDs

The frontend **no longer generates user IDs**. All user IDs come from the server:

```
New visitor (no cookie):
  1. Frontend calls GET /api/auth/me → 401
  2. Frontend shows LoginPage
  3. User clicks "Continue as guest" → POST /api/auth/init-guest
     → Backend generates UUID, creates D1 user (anonymous), creates session
     → Returns user_id + sets rb_session cookie
  4. Frontend stores user_id in memory, sends X-User-ID on requests

Returning visitor (has cookie):
  1. Frontend calls GET /api/auth/me → 200 {user_id, email}
  2. Frontend stores user_id in memory, sends X-User-ID on requests
  3. No LoginPage shown

Cross-device recovery:
  1. New device → no cookie → LoginPage shown
  2. User clicks "Continue with Google"
  3. Backend verifies token → D1 lookup by email → finds existing user_id
  4. Creates new session → returns same user_id → same R2 data loads
```

### Why Keep X-User-ID Header?

The backend's entire path system (SQLite location, R2 keys) depends on `get_current_user_id()`. Changing this to be cookie-only would require rewriting every database and storage function. Instead:

- **Source changes** from client-generated → server-provided
- **Header stays** for routing requests to the correct user's data
- **Middleware validates** that X-User-ID matches the session's user_id (prevents spoofing)

### User ID Format

| User | Current ID | T405 ID | R2 Path Change? |
|------|-----------|---------|-----------------|
| Developer | `a` | `a` (keep) | No |
| Test user | `b` | `b` (keep) | No |
| Guest (T400 era) | `guest_abc123` | `guest_abc123` (keep) | No |
| New guest (T405+) | — | UUID (`f47ac10b-58cc...`) | New path |

**No R2 migration.** Existing users keep their current IDs in D1. Only new users get UUIDs. The D1 `users` table maps email → whatever user_id format they have.

---

## Implementation Plan

### Phase 1: D1 Client + Service (Backend)

**New file: `src/backend/app/services/auth_db.py`**

```python
# D1 REST API client
# Uses: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN

class D1Client:
    """HTTP client for Cloudflare D1 REST API."""

    async def execute(sql, params) -> list[dict]:
        """POST to D1 query endpoint, return rows."""
        # https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{db}/query

# Auth service functions (all use D1Client)
async def get_user_by_email(email) -> dict | None
async def get_user_by_session(session_id) -> dict | None
async def create_user(user_id, email=None, google_id=None) -> dict
async def create_session(user_id) -> str  # returns session_id
async def invalidate_session(session_id)
async def store_otp(email, code, expires_at)
async def verify_otp(email, code) -> bool
```

**D1 Schema** (created via Cloudflare dashboard or wrangler):

```sql
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    google_id TEXT UNIQUE,
    verified_at TEXT,
    stripe_customer_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT
);

CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    attempts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### Phase 2: Migrate auth.py Endpoints

**`src/backend/app/routers/auth.py` changes:**

| Endpoint | Current | Target |
|----------|---------|--------|
| `POST /init` | Uses X-User-ID from header | Uses session cookie → D1 → user_id. Falls back to X-User-ID for backward compat. |
| `POST /google` | Stores in per-user SQLite | D1: lookup email → if exists, return that user_id. If not, register current user_id. |
| `GET /me` | Reads per-user SQLite sessions | D1: lookup session_id → return user_id + email |
| `POST /init-guest` | **NEW** | Generate UUID → D1 user (no email) → session → cookie |
| `POST /logout` | **NEW** | Delete session from D1, clear rb_session cookie |

**`POST /api/auth/google` — new flow:**

```python
async def google_auth(body: GoogleAuthRequest, request: Request):
    # 1. Verify Google token (same as now)
    token_data = verify_with_google(body.token)
    email, google_id = token_data['email'], token_data['sub']

    # 2. Check D1: does this email already have a user?
    existing = await get_user_by_email(email)

    if existing:
        # Cross-device recovery: use the EXISTING user_id
        user_id = existing['user_id']
    else:
        # First-time Google auth: register current user_id with this email
        current_user_id = get_current_user_id()  # from X-User-ID header (guest)
        await create_user(current_user_id, email=email, google_id=google_id)
        user_id = current_user_id

    # 3. Create session in D1
    session_id = await create_session(user_id)

    # 4. Set cookie + return user_id
    response = JSONResponse({"email": email, "user_id": user_id})
    response.set_cookie("rb_session", session_id, ...)
    return response
```

**Key: when email exists in D1, we return that user's user_id.** Frontend then switches X-User-ID header to the recovered user_id → all subsequent requests load the correct data from R2.

### Phase 3: Middleware Changes

**`src/backend/app/middleware/db_sync.py` — session validation:**

```python
# Current: blindly trust X-User-ID header
# Target: if rb_session cookie present, validate against D1

async def dispatch(request, call_next):
    session_id = request.cookies.get("rb_session")
    x_user_id = request.headers.get("X-User-ID")

    if session_id:
        # Validate session against D1 (cached per-request)
        session = await get_user_by_session(session_id)
        if session and not expired(session):
            user_id = session['user_id']
            # Verify X-User-ID matches session (prevent spoofing)
            if x_user_id and x_user_id != user_id:
                logger.warning(f"X-User-ID mismatch: header={x_user_id}, session={user_id}")
                # Trust session over header
            set_current_user_id(user_id)
        else:
            # Invalid/expired session — fall through to X-User-ID
            if x_user_id:
                set_current_user_id(sanitize(x_user_id))
    elif x_user_id:
        # No cookie — backward compat (anonymous/guest)
        set_current_user_id(sanitize(x_user_id))
    else:
        set_current_user_id(DEFAULT_USER_ID)
```

**Performance concern:** D1 HTTP call on every request is too slow. Solution:

```python
# In-process session cache (dict with TTL)
_session_cache: dict[str, tuple[dict, float]] = {}  # session_id → (user_data, expires_at)

async def get_cached_session(session_id):
    if session_id in _session_cache:
        data, cached_at = _session_cache[session_id]
        if time.time() - cached_at < 300:  # 5-min cache
            return data
    data = await d1_get_user_by_session(session_id)
    if data:
        _session_cache[session_id] = (data, time.time())
    return data
```

### Phase 4: Frontend Changes

**`src/frontend/src/utils/sessionInit.js`:**

```javascript
// REMOVE: resolveUserId(), ?user= param, localStorage user ID
// KEEP: X-User-ID header on requests (but value comes from server)

let _currentUserId = null;  // Set by initSession(), not by resolveUserId()

export async function initSession() {
  // Step 1: Check for existing session
  try {
    const meResponse = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
    if (meResponse.ok) {
      const meData = await meResponse.json();
      _currentUserId = meData.user_id;
      installHeaders();  // X-User-ID + X-Profile-ID

      // Initialize profile
      const initResponse = await fetch(`${API_BASE}/api/auth/init`, { method: 'POST' });
      const initData = await initResponse.json();
      _currentProfileId = initData.profile_id;

      // Set auth state
      authStore.setSessionState(true, meData.email);
      return { profileId: initData.profile_id, userId: meData.user_id, isNewUser: false };
    }
  } catch { /* no session */ }

  // Step 2: No valid session — show LoginPage
  authStore.setSessionState(false);
  authStore.setNeedsLogin(true);  // NEW: triggers LoginPage
  return null;  // App shows LoginPage instead of main content
}
```

**`src/frontend/src/components/LoginPage.jsx`** (NEW):

```jsx
// Full-screen login page for visitors without a session
// Shows: "Continue with Google" | "or" | Email OTP (disabled) | "Continue as guest"

function LoginPage() {
  const handleGuestContinue = async () => {
    const res = await fetch(`${API_BASE}/api/auth/init-guest`, { method: 'POST' });
    const data = await res.json();
    // user_id + session cookie set by server
    // Reload app with valid session
    window.location.reload();
  };

  // Google sign-in same as AuthGateModal
  // On success: reload or re-run initSession()
}
```

**`src/frontend/src/stores/authStore.js`:**

```javascript
// ADD:
needsLogin: false,       // true when no session and no guest yet
setNeedsLogin: (v) => set({ needsLogin: v }),
logout: async () => {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
  set({ isAuthenticated: false, email: null, needsLogin: true });
  window.location.reload();
},
```

**`src/frontend/src/components/ProfileDropdown.jsx`:**

```jsx
// Changes:
// 1. Show email (from authStore) instead of raw user ID
// 2. Show "Sign In" button for anonymous users (triggers AuthGateModal)
// 3. Show "Sign Out" for authenticated users

const email = useAuthStore(s => s.email);
const isAuthenticated = useAuthStore(s => s.isAuthenticated);

// In tooltip/display:
const displayName = isAuthenticated ? email : 'Guest';

// Add Sign In / Sign Out button to dropdown menu
```

### Phase 5: Migration Script

**`src/backend/scripts/migrate_auth_to_d1.py`:**

```python
"""One-time migration: copy verified auth data from per-user SQLite to D1."""

for user_dir in Path("user_data").iterdir():
    user_id = user_dir.name
    for profile_dir in (user_dir / "profiles").iterdir():
        db_path = profile_dir / "database.sqlite"
        if not db_path.exists():
            continue
        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT email, google_id, verified_at FROM auth_profile WHERE id = 1").fetchone()
        if row and row[0]:  # has email
            d1_client.execute(
                "INSERT OR IGNORE INTO users (user_id, email, google_id, verified_at) VALUES (?, ?, ?, ?)",
                [user_id, row[0], row[1], row[2]]
            )
            # Migrate active sessions
            for session in conn.execute("SELECT session_id, expires_at FROM sessions"):
                d1_client.execute(
                    "INSERT OR IGNORE INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)",
                    [session[0], user_id, session[1]]
                )
```

### Phase 6: Environment Variables

```bash
# Add to .env (backend)
CLOUDFLARE_ACCOUNT_ID=xxx
CLOUDFLARE_D1_DATABASE_ID=xxx
CLOUDFLARE_API_TOKEN=xxx  # Needs D1 read/write permission
```

---

## Files to Modify

| # | File | Change |
|---|------|--------|
| 1 | `src/backend/app/services/auth_db.py` | **NEW** — D1 HTTP client + auth query functions |
| 2 | `src/backend/app/routers/auth.py` | Migrate /google, /me to D1. Add /init-guest, /logout |
| 3 | `src/backend/app/middleware/db_sync.py` | Session cookie → D1 → user_id resolution |
| 4 | `src/backend/app/database.py` | Keep auth_profile/sessions tables (backward compat) but stop using them in auth flows |
| 5 | `src/frontend/src/utils/sessionInit.js` | Remove ?user= param, localStorage user ID. User ID from server only. |
| 6 | `src/frontend/src/stores/authStore.js` | Add needsLogin, logout, setNeedsLogin |
| 7 | `src/frontend/src/components/LoginPage.jsx` | **NEW** — Full-screen login for cookie-less visitors |
| 8 | `src/frontend/src/components/ProfileDropdown.jsx` | Show email/Guest, add Sign In/Out |
| 9 | `src/frontend/src/components/AuthGateModal.jsx` | Minor: share Google sign-in logic with LoginPage |
| 10 | `src/backend/scripts/migrate_auth_to_d1.py` | **NEW** — One-time migration script |

---

## Risks

| Risk | Mitigation |
|------|------------|
| D1 API latency on every request | In-process session cache (5-min TTL) |
| D1 outage = can't login | Graceful error: "Service temporarily unavailable, try again" |
| Existing sessions break on deploy | Migration script copies sessions to D1 before switching |
| E2E tests use ?user= param | Keep backward compat: if X-User-ID header present AND no cookie, trust it (for tests only) |
| User "a" data safety | user_id stays "a", R2 paths unchanged, migration is INSERT OR IGNORE |
| User "b" data safety | Same — user_id stays "b", no path changes |

---

## Open Questions

1. **D1 database creation** — Have you already created a D1 database in Cloudflare, or should I include wrangler CLI steps?
2. **API token** — Do you have a Cloudflare API token with D1 permissions, or do we need to create one?
3. **LoginPage behavior** — Should first-time visitors see the LoginPage immediately, or auto-create a guest and only show LoginPage on cleared cookies / new device?
4. **E2E test strategy** — Keep ?user= param working during transition, or update E2E tests to use the new auth flow?

---

## Sequence Diagrams

### New Visitor (Guest)

```
Browser                    Backend                    D1
  │                          │                         │
  ├─ GET /api/auth/me ──────>│                         │
  │<── 401 No session ───────│                         │
  │                          │                         │
  │ [Show LoginPage]         │                         │
  │                          │                         │
  ├─ POST /init-guest ──────>│                         │
  │                          ├─ INSERT users (uuid) ──>│
  │                          ├─ INSERT sessions ──────>│
  │<── {user_id} + cookie ───│                         │
  │                          │                         │
  ├─ POST /api/auth/init ──>│  (X-User-ID: uuid)     │
  │<── {profile_id} ────────│                         │
  │                          │                         │
  │ [App loads normally]     │                         │
```

### Cross-Device Recovery

```
New Device                 Backend                    D1
  │                          │                         │
  ├─ GET /api/auth/me ──────>│                         │
  │<── 401 ──────────────────│                         │
  │                          │                         │
  │ [Show LoginPage]         │                         │
  │                          │                         │
  ├─ POST /google {jwt} ───>│                         │
  │                          ├─ verify JWT with Google  │
  │                          ├─ SELECT * FROM users    │
  │                          │  WHERE email = ? ──────>│
  │                          │<── {user_id: "a"} ──────│
  │                          │                         │
  │                          │  (Email found! user "a")│
  │                          ├─ INSERT sessions ──────>│
  │<── {user_id:"a", email} ─│  + set rb_session      │
  │                          │                         │
  ├─ POST /api/auth/init ──>│  (X-User-ID: a)        │
  │<── {profile_id} ────────│                         │
  │                          │                         │
  │ [Same data as other     │                         │
  │  device loads!]          │                         │
```
