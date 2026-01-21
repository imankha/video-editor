# Task 14: User Management & Multi-Tenancy

## Overview
Implement user authentication and multi-tenant data isolation to support scaling to many users.

## Owner
**Both** - Architecture decisions + implementation

## Prerequisites
- Task 03 complete (D1 schema)
- Task 06 complete (Workers API)

## Time Estimate
4-6 hours

---

## Architecture Options

### Option A: Single D1 + user_id Column (Recommended to Start)

**Pros**: Simple, works immediately, easy to query across users (admin)
**Cons**: No true isolation, need discipline to always filter by user_id

```sql
-- All tables include user_id
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ...
);

CREATE TABLE export_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    ...
);

-- Always filter by user_id
SELECT * FROM projects WHERE user_id = ? AND id = ?;
```

**Scale limit**: D1 handles ~10K-100K users easily with proper indexing.

---

### Option B: Durable Objects with SQLite (True Per-User Isolation)

**Pros**: Complete isolation, each user has own DB, scales infinitely
**Cons**: More complex, can't easily query across users

```typescript
// Each user gets their own Durable Object
export class UserDataStore {
  sql: SqlStorage;

  constructor(state: DurableObjectState) {
    this.sql = state.storage.sql;

    // Initialize user's personal database
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS projects (...);
      CREATE TABLE IF NOT EXISTS clips (...);
    `);
  }

  async fetch(request: Request) {
    // All operations scoped to this user's data
  }
}

// Usage in Worker
const userStore = env.USER_DATA.get(env.USER_DATA.idFromName(userId));
await userStore.fetch(new Request('/projects'));
```

**Scale limit**: Unlimited users, each DO is independent.

---

### Option C: Hybrid (Recommended for Production)

- **D1**: Shared data (user accounts, billing, export_jobs queue)
- **Durable Objects**: Per-user data (projects, clips, settings)
- **R2**: Shared bucket with `{user_id}/` prefix

```
D1 (shared)
├── users (accounts, auth)
├── wallet (billing)
├── export_jobs (job queue)
└── ledger (transactions)

Durable Objects (per-user)
├── UserDataStore
│   ├── projects
│   ├── working_clips
│   └── settings

R2 (shared bucket)
├── {user_id}/input/
├── {user_id}/output/
└── {user_id}/thumbnails/
```

---

## Authentication Options

### Option 1: Anonymous + Stripe (Simplest)

No login required. Users identified by:
1. Browser cookie with UUID
2. Linked to Stripe customer when they pay

```typescript
// On first visit
const userId = cookies.get('uid') || crypto.randomUUID();
setCookie('uid', userId, { maxAge: 365 * 24 * 60 * 60 });

// On payment, link to Stripe
await db.exec(`
  UPDATE users SET stripe_customer_id = ? WHERE uid = ?
`, stripeCustomerId, userId);
```

**Pros**: Zero friction, works immediately
**Cons**: Can't sync across devices, lose data if cookies cleared

---

### Option 2: Email Magic Link

User enters email, receives login link:

```typescript
// Request login
POST /api/auth/login
{ email: "user@example.com" }

// Send email with token
const token = crypto.randomUUID();
await db.exec(`INSERT INTO login_tokens (token, email, expires) VALUES (?, ?, ?)`,
  token, email, Date.now() + 15 * 60 * 1000);
await sendEmail(email, `Click to login: https://app.../auth/verify?token=${token}`);

// Verify token
GET /api/auth/verify?token=xxx
// Set session cookie, create/get user
```

**Pros**: No password to remember, works across devices
**Cons**: Requires email service (Resend, SendGrid)

---

### Option 3: OAuth (Google/GitHub)

Use Cloudflare Access or implement OAuth flow:

```typescript
// Redirect to Google
GET /api/auth/google
→ Redirect to accounts.google.com/oauth...

// Callback
GET /api/auth/callback?code=xxx
→ Exchange code for tokens
→ Get user email from Google
→ Create/get user, set session
```

**Pros**: Trusted, users already have accounts
**Cons**: More complex, dependency on OAuth providers

---

### Option 4: Cloudflare Access (Enterprise)

Cloudflare's built-in auth layer. Handles login UI, session management.

**Pros**: Zero code for auth, enterprise-grade
**Cons**: Paid feature, less customizable

---

## Recommended Path

### Phase 1: Anonymous (Now)
- UUID in cookie
- Works immediately
- Good for MVP/testing

### Phase 2: Email Magic Link (When needed)
- Add when users want cross-device sync
- Simple to implement
- Use Resend.com for email (~$0.001/email)

### Phase 3: OAuth (Optional)
- Add Google login for convenience
- Keep magic link as fallback

---

## D1 Schema for Users

```sql
-- 0003_create_users.sql

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

## Middleware Pattern

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

## R2 Multi-Tenancy

Organize files by user:

```
reel-ballers-videos/
├── {user_id}/
│   ├── input/{job_id}/video.mp4
│   ├── output/{job_id}/video.mp4
│   └── thumbnails/...
```

```typescript
// Generate user-scoped keys
const inputKey = `${userId}/input/${jobId}/video.mp4`;
const outputKey = `${userId}/output/${jobId}/video.mp4`;
```

---

## Scaling Considerations

### 100K CCU Architecture

```
                    ┌─────────────────────────────┐
                    │     Cloudflare Workers      │
                    │   (auto-scales, stateless)  │
                    └─────────────┬───────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌───────────────┐       ┌─────────────────┐       ┌─────────────────┐
│      D1       │       │ Durable Objects │       │       R2        │
│   (shared)    │       │   (per-job)     │       │    (shared)     │
│               │       │                 │       │                 │
│ - users       │       │ ExportJobState  │       │ {user}/input/   │
│ - wallet      │       │ - WebSocket hub │       │ {user}/output/  │
│ - export_jobs │       │ - Job progress  │       │                 │
└───────────────┘       └─────────────────┘       └─────────────────┘
```

### Rate Limits to Consider

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

**Start with Option A** (single D1 + user_id) for simplicity. Migrate to Durable Objects per-user if you need true isolation or hit D1 limits.

**For auth, start anonymous** (UUID cookie). Add email magic link when users ask for cross-device sync.
