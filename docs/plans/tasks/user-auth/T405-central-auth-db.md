# T405: Central Auth + Cross-Device Recovery

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

After T400/T401, auth works but is single-device only. Auth data lives in per-user SQLite, which means:
- **Clear cookies → lose account.** No way to find which guest_XXXXXXXX owns an email.
- **New device → start over.** Can't look up "this email belongs to user guest_abc123."
- **Stripe can't find users.** Webhook says "user X paid" but we need email→user_id lookup.

We need a central database that answers: "given this email, which user_id is it?"

## Solution

Cloudflare D1 (free, already in our infra) as the central auth database. Migrate auth data from per-user SQLite to D1. All auth lookups go through D1. Per-user SQLite auth tables become deprecated.

## Context

### Relevant Files
- `src/backend/app/services/auth_db.py` - NEW: D1 client + query functions
- `src/backend/app/routers/auth.py` - Migrate Google/OTP/session logic from per-user SQLite to D1
- `src/backend/app/middleware/db_sync.py` - Session validation now checks D1
- `src/backend/app/database.py` - Per-user auth tables become deprecated
- `src/frontend/src/components/LoginPage.jsx` - NEW: full-screen login for return visitors

### Related Tasks
- Depends on: T400, T401 (auth is working on per-user SQLite)
- Blocks: T420 (cross-device session management)
- Blocks: T505 (credit system uses D1 for balance)
- Blocks: T525 (Stripe needs central email→user_id lookup)

### Technical Notes

**D1 Schema:**
```sql
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,           -- guest_XXXXXXXX (preserved)
    email TEXT UNIQUE,
    google_id TEXT UNIQUE,
    verified_at TEXT,
    stripe_customer_id TEXT,            -- NULL until T525
    created_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT
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

CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
```

---

## The Transition: Per-User SQLite → Central D1

### What changes for the user?

**Nothing visible.** The auth modal looks exactly the same. Google and OTP work exactly the same. The user doesn't know or care where their auth data lives.

The only NEW capability is: **they can now recover their account from a new device or cleared cookies.**

### When do we trigger the transition?

**On T405 deploy — transparent, no user action required.**

1. Backend migration script copies all verified emails to D1
2. Auth endpoints switch from per-user SQLite to D1
3. Existing session cookies continue to work (session IDs are the same, just validated against D1 now)
4. Users don't re-authenticate, don't see anything different

### Do we force users to "create an account"?

**No. There is no separate "account creation" step.** Every user who verified via Google or OTP in T400/T401 already HAS an account — they just don't know (or need to know) that it moved from per-user SQLite to D1. The concept of "account" is just "verified email linked to a guest_ID." That's it.

### Is the migration in our interest?

**Yes, critically.** Without central auth we cannot:

| Capability | Why it needs D1 |
|------------|----------------|
| **Stripe payments** | Webhooks identify users by email — need email→user_id lookup to credit the right account |
| **Cookie recovery** | User clears cookies → "enter your email" → D1 finds their user_id → restore session |
| **Cross-device** | New phone/laptop → same email → D1 → same user_id → R2 pulls their data |
| **Abuse prevention** | One account per email, enforced centrally |
| **Analytics** | Count real verified users vs abandoned guest shells |
| **Support** | "I can't find my videos" → look up by email → point to their data |

### Do we bribe users?

**Not for this migration** — it's invisible to them. The "bribe" already happened at the auth gate (T400/T401): **free trial credits** (T515). Users were incentivized to verify their email. T405 just moves where that verification is stored.

### What's new for users after T405?

**The "Welcome back" login page.** Before T405, clearing cookies = lost account. After T405:

```
User opens app with no cookie (cleared, new browser, new device)
                ↓
┌─────────────────────────────────────────┐
│                                         │
│  Welcome back                           │
│                                         │
│  [G] Continue with Google               │
│                                         │
│  ───── or ─────                         │
│                                         │
│  Email: [_________________________]     │
│  [Send Code]                            │
│                                         │
│  ─────                                  │
│                                         │
│  Or [continue as guest]                 │
│                                         │
└─────────────────────────────────────────┘
```

- Google/OTP → D1 lookup finds their user_id → new session → R2 pulls their data
- "Continue as guest" → new guest_XXXXXXXX, fresh start (for genuinely new users)

### Migration mechanics

**One-time batch migration on deploy:**
```python
# Pseudocode for migration script
for user_dir in glob("user_data/*/"):
    user_id = user_dir.name
    db = open_sqlite(user_dir / "profiles/*/database.sqlite")
    auth = db.query("SELECT email, google_id, verified_at FROM auth_profile LIMIT 1")
    if auth and auth.email:
        d1.execute(
            "INSERT OR IGNORE INTO users (user_id, email, google_id, verified_at) VALUES (?, ?, ?, ?)",
            (user_id, auth.email, auth.google_id, auth.verified_at)
        )
```

After migration, auth.py endpoints switch from:
```python
# Before (per-user SQLite)
db = get_user_db(user_id)
db.execute("SELECT * FROM auth_profile")

# After (D1)
d1.execute("SELECT * FROM users WHERE email = ?", (email,))
```

---

## Implementation

### Steps
1. [ ] Create D1 database via Wrangler CLI or Cloudflare dashboard
2. [ ] Run D1 schema migrations
3. [ ] Create auth_db.py service with D1 REST API client
4. [ ] Implement: create_user, get_user_by_email, get_user_by_google_id
5. [ ] Implement: store_otp, verify_otp (move from per-user SQLite to D1)
6. [ ] Implement: create_session, validate_session, invalidate_user_sessions
7. [ ] Write migration script: scan per-user auth_profile tables → populate D1
8. [ ] Migrate auth.py endpoints from per-user SQLite to D1
9. [ ] Update session validation in middleware to check D1
10. [ ] Create LoginPage.jsx (full-screen, for cookie-less visitors)
11. [ ] Add "continue as guest" option to LoginPage
12. [ ] Update sessionInit.js: if no cookie, show LoginPage instead of auto-creating guest
13. [ ] Add D1 API credentials to env vars (staging + production)
14. [ ] Test: existing user → deploy T405 → session still works (no re-auth)
15. [ ] Test: clear cookies → LoginPage → OTP → recover account + data
16. [ ] Test: new device → LoginPage → Google → same data appears
17. [ ] Test: "continue as guest" → fresh guest_XXXXXXXX, no old data

## Acceptance Criteria

- [ ] D1 database created with auth schema
- [ ] Existing verified users migrated from per-user SQLite to D1
- [ ] Google OAuth now reads/writes D1 (not per-user SQLite)
- [ ] Email OTP now reads/writes D1 (not per-user SQLite)
- [ ] Session validation now checks D1
- [ ] LoginPage appears when no cookie present
- [ ] "Continue as guest" creates fresh guest account
- [ ] Cross-device: login on new device → data loads from R2
- [ ] Existing sessions survive the migration (no forced re-auth)
