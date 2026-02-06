# Task 13: User Management (Optional)

## Overview
Implement user authentication and multi-tenant data isolation to support multiple users.

## Owner
**Both** - Architecture decisions + implementation

## Prerequisites
- Phase 3 complete (Fly.io backend deployed)

## Status
`OPTIONAL` - Only implement when needed for multi-user support

---

## Current State

The app currently uses a simple user ID approach:
- User ID is stored in a cookie (default: 'a')
- All data is scoped to this user ID in R2 paths
- No authentication required

---

## Authentication Options

### Option 1: Anonymous + Cookie (Current)

No login required. Users identified by:
1. Browser cookie with UUID
2. Linked to Stripe customer when they pay

```python
# On first request - middleware sets user ID
def get_user_id(request: Request) -> str:
    user_id = request.cookies.get('uid')
    if not user_id:
        user_id = str(uuid.uuid4())
    return user_id
```

**Pros**: Zero friction, works immediately
**Cons**: Can't sync across devices, lose data if cookies cleared

---

### Option 2: Email Magic Link

User enters email, receives login link:

```
1. User enters email
2. Server generates token, sends email with link
3. User clicks link
4. Server verifies token, creates session
```

**Pros**: No password to remember, works across devices
**Cons**: Requires email service (Resend, SendGrid)

---

### Option 3: OAuth (Google/GitHub)

Standard OAuth flow:

```
1. User clicks "Login with Google"
2. Redirect to Google auth
3. Callback with auth code
4. Exchange for tokens
5. Create/get user, set session
```

**Pros**: Trusted providers, users already have accounts
**Cons**: More complex, OAuth dependency

---

## Recommended Path

### Phase 1: Anonymous (Current)
- UUID in cookie
- Works immediately
- Good for MVP/testing

### Phase 2: Email Magic Link (When needed)
- Add when users want cross-device sync
- Use Resend.com for email (~$0.001/email)

### Phase 3: OAuth (Optional)
- Add Google login for convenience
- Keep magic link as fallback

---

## Data Isolation

### R2 Storage
Files are already isolated by user ID prefix:
```
reel-ballers-users/
├── {user_id_1}/
│   ├── database.sqlite
│   └── games/...
├── {user_id_2}/
│   ├── database.sqlite
│   └── games/...
```

### Database
Each user has their own SQLite database in R2:
- `{user_id}/database.sqlite`
- Complete isolation
- No cross-user queries needed

---

## Database Schema for Users

When ready to implement authentication, add these tables to each user's SQLite:

```sql
-- Users table (for email-based auth)
CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE,
    stripe_customer_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,           -- Session token
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Login tokens (for magic link)
CREATE TABLE IF NOT EXISTS login_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
```

---

## FastAPI Middleware Implementation

### app/middleware/auth.py

```python
"""
Authentication middleware for FastAPI.
"""
import uuid
from fastapi import Request, Response
from typing import Optional

async def get_current_user(request: Request) -> dict:
    """
    Get current user from session or create anonymous user.

    Returns:
        {"user_id": str, "email": Optional[str], "is_authenticated": bool}
    """
    # Check session cookie
    session_id = request.cookies.get('session')
    if session_id:
        # Validate session (check database)
        user = await validate_session(session_id)
        if user:
            return {
                "user_id": user["id"],
                "email": user.get("email"),
                "is_authenticated": True
            }

    # Fall back to anonymous UUID
    anon_id = request.cookies.get('uid')
    if not anon_id:
        anon_id = str(uuid.uuid4())

    return {
        "user_id": anon_id,
        "email": None,
        "is_authenticated": False
    }


def set_user_cookie(response: Response, user_id: str):
    """Set the user ID cookie."""
    response.set_cookie(
        key="uid",
        value=user_id,
        max_age=365 * 24 * 60 * 60,  # 1 year
        httponly=True,
        samesite="strict"
    )
```

---

## Magic Link API Endpoints

### app/routers/auth.py

```python
"""
Authentication routes for magic link login.
"""
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr


class VerifyRequest(BaseModel):
    token: str


@router.post("/login")
async def request_login(request: LoginRequest):
    """
    Send magic link to user's email.
    """
    email = request.email
    token = str(uuid.uuid4())
    expires = datetime.utcnow() + timedelta(minutes=15)

    # Store token in database
    # (Use shared D1 or separate auth database if needed)
    await store_login_token(token, email, expires)

    # Send email
    login_url = f"https://app.reelballers.com/auth/verify?token={token}"
    await send_magic_link_email(email, login_url)

    return {"success": True, "message": "Check your email for login link"}


@router.get("/verify")
async def verify_token(token: str, response: Response):
    """
    Verify magic link token and create session.
    """
    # Find and validate token
    login_token = await get_login_token(token)

    if not login_token:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    if login_token["used_at"]:
        raise HTTPException(status_code=400, detail="Token already used")

    if datetime.fromisoformat(login_token["expires_at"]) < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Token expired")

    # Mark token as used
    await mark_token_used(token)

    # Create or get user
    email = login_token["email"]
    user = await get_or_create_user(email)

    # Create session
    session_id = str(uuid.uuid4())
    session_expires = datetime.utcnow() + timedelta(days=30)
    await create_session(session_id, user["id"], session_expires)

    # Set session cookie and redirect
    response.set_cookie(
        key="session",
        value=session_id,
        max_age=30 * 24 * 60 * 60,  # 30 days
        httponly=True,
        secure=True,
        samesite="strict"
    )
    response.headers["Location"] = "https://app.reelballers.com"
    response.status_code = 302

    return response


@router.post("/logout")
async def logout(response: Response):
    """
    Clear session cookie.
    """
    response.delete_cookie("session")
    return {"success": True}
```

---

## Email Service Integration

### Using Resend (Recommended)

```python
# app/services/email.py
import httpx
import os

RESEND_API_KEY = os.getenv("RESEND_API_KEY")

async def send_magic_link_email(to_email: str, login_url: str):
    """Send magic link email via Resend."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": "Reel Ballers <noreply@reelballers.com>",
                "to": [to_email],
                "subject": "Login to Reel Ballers",
                "html": f"""
                    <h2>Login to Reel Ballers</h2>
                    <p>Click the link below to log in:</p>
                    <a href="{login_url}">Log in to Reel Ballers</a>
                    <p>This link expires in 15 minutes.</p>
                """,
            },
        )
        response.raise_for_status()
```

---

## Scaling Considerations

| Users | Architecture | Notes |
|-------|--------------|-------|
| 1-100 | Current setup | Anonymous users, R2 storage |
| 100-10K | Add auth | Email magic link, optional OAuth |
| 10K-100K | Same | Per-user SQLite scales well |
| 100K+ | Consider sharding | Multiple R2 buckets by user ID hash |

---

## Environment Variables

```bash
# Add to Fly.io secrets when implementing auth
fly secrets set --app reel-ballers-api \
  RESEND_API_KEY=re_xxx \
  APP_URL=https://app.reelballers.com
```

---

## Frontend Integration

### Login Component

```jsx
function LoginForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setSent(true);
  };

  if (sent) {
    return <p>Check your email for login link!</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
      />
      <button type="submit">Send Login Link</button>
    </form>
  );
}
```

---

## Multi-Device Sync & Session Invalidation

**IMPORTANT**: When implementing auth, add single-session enforcement to handle R2 database sync.

### Current Behavior (Single-User Mode)

The backend only downloads the database from R2 on first access (server startup). It does NOT check R2 for newer versions on every request because that HEAD request was causing 20+ second delays when R2 connection was cold.

See: T05 (Optimize Load Times) for details.

### Required Behavior (Multi-Device Mode)

When a user logs in on a new device, we need to:

1. **Invalidate all other sessions** for that user
2. **Force other devices to re-authenticate**
3. **On re-auth, the server context resets** → downloads fresh DB from R2

```python
@router.get("/verify")
async def verify_token(token: str, response: Response):
    # ... validate token ...

    # IMPORTANT: Invalidate all existing sessions for this user
    # This forces other devices to re-authenticate
    await invalidate_all_sessions(user["id"])

    # Create new session for this device
    session_id = str(uuid.uuid4())
    await create_session(session_id, user["id"], session_expires)
    # ...
```

### Why This Matters

Without session invalidation:
- User makes edits on Device A → syncs to R2
- User opens Device B → sees stale local cache (never checks R2)
- User makes conflicting edits on Device B → overwrites Device A's changes

With session invalidation:
- User makes edits on Device A → syncs to R2
- User logs in on Device B → Device A's session invalidated
- Device A's next request → 401 → must re-auth → fresh R2 download
- No conflicting edits possible (only one active session)

---

## Handoff Notes

Start with anonymous users. Add authentication when:
- Users ask for cross-device sync
- You need to prevent abuse
- You're adding payments (link to Stripe customer)

The per-user SQLite architecture already handles data isolation - auth is only needed for identity, not data separation.

**When adding auth**: Remember to implement single-session enforcement (see "Multi-Device Sync" section above) to ensure R2 database sync works correctly across devices.
