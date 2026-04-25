# T1830: Shared Content Inbox & Claim Flow

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

When someone shares a clip or game with a user, the recipient needs a way to see pending shares and decide which profile to associate them with. No inbox or claim mechanism exists.

## Solution

Add a `pending_shares` table in `auth.sqlite` (accessible before profile selection). Build an inbox UI where recipients see pending shares, pick a profile (or create new), and claim content. Default to the last profile used with that sharer.

## Context

### Relevant Files (REQUIRED)

**Backend:**
- `src/backend/app/database.py` — Add `pending_shares` and `sharer_profile_defaults` tables to auth.sqlite schema
- `src/backend/app/routers/auth.py` or new `src/backend/app/routers/sharing.py` — Inbox endpoints
- `src/backend/app/routers/profiles.py` — Profile list for claim selection

**Frontend:**
- New: `src/frontend/src/components/SharedInbox.jsx` — Inbox UI
- New: `src/frontend/src/components/ClaimModal.jsx` — Profile selection + create new
- `src/frontend/src/stores/profileStore.js` — Profile list, create profile action
- `src/frontend/src/App.jsx` — Inbox notification badge, route

### Related Tasks
- Depends on: T1810 (player tag model — provides context for what's being shared)
- Blocks: T1840 (clip delivery), T1850 (game sharing) — both create pending shares that this inbox displays

### Technical Notes

**`pending_shares` table in `auth.sqlite`:**
```sql
CREATE TABLE pending_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_type TEXT NOT NULL,              -- 'clip' or 'game'
    sharer_user_id TEXT NOT NULL,
    sharer_email TEXT NOT NULL,
    sharer_display_name TEXT,              -- Cached for display
    recipient_email TEXT NOT NULL,
    recipient_user_id TEXT,                -- NULL if recipient hasn't signed up yet
    source_data TEXT NOT NULL,             -- JSON: game blake3_hash, clip metadata, etc.
    claimed_profile_id TEXT,               -- NULL until claimed
    claimed_at TEXT,                       -- NULL until claimed
    created_at TEXT NOT NULL
);
CREATE INDEX idx_pending_shares_recipient ON pending_shares(recipient_email);
CREATE INDEX idx_pending_shares_recipient_user ON pending_shares(recipient_user_id);
```

**`sharer_profile_defaults` table in `auth.sqlite`:**
```sql
CREATE TABLE sharer_profile_defaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    sharer_email TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, sharer_email)
);
```

**Claim flow:**
1. Recipient logs in → backend checks `pending_shares WHERE recipient_email = ?`
2. On first login, backfill `recipient_user_id` for any pending shares matching their email
3. Inbox shows unclaimed shares grouped by sharer
4. For each share: profile picker pre-selects last used profile with that sharer (from `sharer_profile_defaults`)
5. Claim → backend materializes content in chosen profile's DB (actual materialization is T1840/T1850)
6. Update `sharer_profile_defaults` with the chosen profile

**Signup resolution:**
When a new user signs up, query `pending_shares WHERE recipient_email = ? AND recipient_user_id IS NULL` and backfill their user_id. Inbox appears on first login.

**Endpoints:**
- `GET /api/sharing/inbox` — List unclaimed pending shares for current user
- `POST /api/sharing/inbox/{share_id}/claim` — body: `{profile_id}` — claim a share
- `GET /api/sharing/inbox/count` — Badge count for notification
- `GET /api/sharing/profile-default?sharer_email=` — Get default profile for sharer

## Implementation

### Steps
1. [ ] Backend: Add `pending_shares` and `sharer_profile_defaults` tables to auth.sqlite schema
2. [ ] Backend: Inbox endpoints (list, count, claim, profile default)
3. [ ] Backend: Signup hook — backfill `recipient_user_id` on new user registration
4. [ ] Frontend: SharedInbox component — list of pending shares grouped by sharer
5. [ ] Frontend: ClaimModal — profile picker with "Create new profile" option, pre-selected default
6. [ ] Frontend: Inbox notification badge (in header/nav)
7. [ ] Frontend: Wire claim action → backend → navigate to claimed content
8. [ ] Update `sharer_profile_defaults` on each claim

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Pending shares visible in inbox after login
- [ ] Shares grouped by sharer with display name
- [ ] Profile picker shows all profiles + "Create new profile"
- [ ] Default profile pre-selected based on last claim from same sharer
- [ ] Claiming marks share as claimed and materializes content (via T1840/T1850)
- [ ] New profile creation works inline during claim flow
- [ ] Inbox badge shows count of unclaimed shares
- [ ] Pending shares for non-users resolve when they sign up
