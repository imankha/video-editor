# Task 17: User Management (Optional)

## Overview
Implement user authentication and multi-tenant data isolation to support multiple users.

## Owner
**Both** - Architecture decisions + implementation

## Prerequisites
- Phase 3 complete (Workers API)

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

```typescript
// On first visit
const userId = cookies.get('uid') || crypto.randomUUID();
setCookie('uid', userId, { maxAge: 365 * 24 * 60 * 60 });
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

## Middleware Pattern

```typescript
// workers/src/middleware/auth.ts

export async function withAuth(
  request: Request,
  env: Env
): Promise<{ userId: string; isAuthenticated: boolean }> {
  const cookies = parseCookies(request.headers.get('Cookie') || '');

  // Check session cookie (for authenticated users)
  const sessionId = cookies.session;
  if (sessionId) {
    // Validate session...
    // Return authenticated user
  }

  // Fall back to anonymous UUID
  const anonId = cookies.uid || crypto.randomUUID();
  return { userId: anonId, isAuthenticated: false };
}
```

---

## Scaling Considerations

| Users | Architecture | Notes |
|-------|--------------|-------|
| 1-100 | Current setup | Anonymous users, R2 storage |
| 100-10K | Add auth | Email magic link, optional OAuth |
| 10K-100K | Same | Works fine with proper indexing |
| 100K+ | Consider DO | Per-user Durable Objects for isolation |

---

## D1 Schema for Users

When ready to implement authentication, add this D1 migration:

### migrations/0003_create_users.sql

```sql
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,              -- UUID
    email TEXT UNIQUE,                -- Optional, for magic link
    stripe_customer_id TEXT,          -- Linked when they pay
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,              -- Session token
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS login_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
```

---

## Full Middleware Implementation

```typescript
// workers/src/middleware/auth.ts

export async function withAuth(
  request: Request,
  env: Env
): Promise<{ user: User | null; userId: string }> {
  const cookies = parseCookies(request.headers.get('Cookie') || '');

  // Check session cookie
  const sessionId = cookies.session;
  if (sessionId) {
    const session = await env.DB.prepare(`
      SELECT s.*, u.* FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = ? AND s.expires_at > datetime('now')
    `).bind(sessionId).first();

    if (session) {
      return { user: session, userId: session.user_id };
    }
  }

  // Fall back to anonymous UUID
  const anonId = cookies.uid || crypto.randomUUID();
  return { user: null, userId: anonId };
}

// Usage in route
export async function handleGetProjects(request: Request, env: Env) {
  const { userId } = await withAuth(request, env);

  const projects = await env.DB.prepare(`
    SELECT * FROM projects WHERE user_id = ?
  `).bind(userId).all();

  return json(projects);
}
```

---

## Magic Link Flow

```typescript
// POST /api/auth/login
export async function handleLoginRequest(request: Request, env: Env) {
  const { email } = await request.json();

  // Generate secure token
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store token
  await env.DB.prepare(`
    INSERT INTO login_tokens (token, email, expires_at) VALUES (?, ?, ?)
  `).bind(token, email, expires.toISOString()).run();

  // Send email (using Resend, SendGrid, etc.)
  await sendEmail(email, {
    subject: 'Login to Reel Ballers',
    html: `Click to login: <a href="${env.APP_URL}/auth/verify?token=${token}">Login</a>`
  });

  return json({ success: true });
}

// GET /api/auth/verify?token=xxx
export async function handleVerifyToken(request: Request, env: Env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  // Find and validate token
  const loginToken = await env.DB.prepare(`
    SELECT * FROM login_tokens
    WHERE token = ? AND expires_at > datetime('now') AND used_at IS NULL
  `).bind(token).first();

  if (!loginToken) {
    return new Response('Invalid or expired token', { status: 400 });
  }

  // Mark token as used
  await env.DB.prepare(`
    UPDATE login_tokens SET used_at = datetime('now') WHERE token = ?
  `).bind(token).run();

  // Create or get user
  let user = await env.DB.prepare(`
    SELECT * FROM users WHERE email = ?
  `).bind(loginToken.email).first();

  if (!user) {
    const userId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO users (id, email) VALUES (?, ?)
    `).bind(userId, loginToken.email).run();
    user = { id: userId, email: loginToken.email };
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
  `).bind(sessionId, user.id, sessionExpires.toISOString()).run();

  // Redirect with session cookie
  return new Response(null, {
    status: 302,
    headers: {
      'Location': env.APP_URL,
      'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`
    }
  });
}
```

---

## 100K CCU Architecture

```
                    +-----------------------------+
                    |     Cloudflare Workers      |
                    |   (auto-scales, stateless)  |
                    +-------------+---------------+
                                  |
        +-------------------------+-------------------------+
        |                         |                         |
        v                         v                         v
+---------------+       +-----------------+       +-----------------+
|      D1       |       | Durable Objects |       |       R2        |
|   (shared)    |       |   (per-job)     |       |    (shared)     |
|               |       |                 |       |                 |
| - users       |       | ExportJobState  |       | {user}/input/   |
| - wallet      |       | - WebSocket hub |       | {user}/output/  |
| - export_jobs |       | - Job progress  |       |                 |
+---------------+       +-----------------+       +-----------------+
```

---

## Rate Limits to Consider

| Resource | Free Limit | Paid Limit |
|----------|------------|------------|
| Worker requests | 100K/day | Unlimited |
| D1 reads | 5M/day | $0.75/billion |
| D1 writes | 100K/day | $1/million |
| Durable Object requests | 1M/day | Unlimited |
| R2 operations | 10M/month | $0.36/million |

### For 100K CCU

- **Workers**: No problem, scales automatically
- **D1**: May need to optimize queries, batch writes
- **Durable Objects**: 1 per active export (not per user)
- **R2**: No problem
- **RunPod**: Configure max concurrent workers based on budget

---

## Handoff Notes

Start with anonymous users. Add authentication when:
- Users ask for cross-device sync
- You need to prevent abuse
- You're adding payments (link to Stripe customer)
