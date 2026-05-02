# T1830: Shared Content Inbox & Claim Flow

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-25
**Updated:** 2026-05-02

## Problem

When someone shares a game or a tagged clip with a user, the recipient needs a way to see pending shares and decide which profile to associate them with. No inbox or claim mechanism exists.

## Solution

Add a `pending_shares` table in `auth.sqlite` (accessible before profile selection). Build an inbox UI where recipients see pending shares, pick a profile (or create new), and claim content. Default to the last profile used with that sharer. Claiming materializes the shared content in the recipient's profile database.

## Context

### Relevant Files (REQUIRED)

**Backend:**
- `src/backend/app/database.py` — Add `pending_shares` and `sharer_profile_defaults` tables to auth.sqlite schema
- `src/backend/app/routers/sharing.py` — Inbox endpoints + claim handlers with materialization logic
- `src/backend/app/routers/profiles.py` — Profile list for claim selection

**Frontend:**
- New: `src/frontend/src/components/SharedInbox.jsx` — Inbox UI
- New: `src/frontend/src/components/ClaimModal.jsx` — Profile selection + create new
- `src/frontend/src/stores/profileStore.js` — Profile list, create profile action
- `src/frontend/src/App.jsx` — Inbox notification badge, route

### Related Tasks
- Blocks: T1840 (tag at framing creates pending shares), T1850 (game sharing creates pending shares)
- Depends on: T1760 (Resend email delivery for notifications)

### Technical Notes

**`pending_shares` table in `auth.sqlite`:**
```sql
CREATE TABLE pending_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_type TEXT NOT NULL,              -- 'game' or 'tagged_clip'
    sharer_user_id TEXT NOT NULL,
    sharer_email TEXT NOT NULL,
    sharer_display_name TEXT,
    recipient_email TEXT NOT NULL,
    recipient_user_id TEXT,                -- NULL if recipient hasn't signed up yet
    source_data TEXT NOT NULL,             -- JSON: content varies by share_type (see below)
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

**source_data by share_type:**

`game`:
```json
{
  "game_id": "...",
  "game_name": "...",
  "blake3_hash": "...",
  "game_videos": [{"blake3_hash": "...", "sequence": 0, "duration": 5400}],
  "opponent_name": "...",
  "game_date": "2026-04-15"
}
```

`tagged_clip` (from T1840 — includes game + annotation + My Reels):
```json
{
  "game": {"game_id": "...", "blake3_hash": "...", "game_name": "...", "game_videos": [...]},
  "clip": {"start_time": 120.5, "end_time": 128.0, "rating": 5, "tags": ["Goal"], "name": "...", "notes": "..."},
  "my_reels_video": {"r2_key": "...", "filename": "...", "duration": 7.5, "width": 1080, "height": 1920}
}
```

**Claim flow:**
1. Recipient logs in → backend checks `pending_shares WHERE recipient_email = ?`
2. On first login, backfill `recipient_user_id` for any pending shares matching their email
3. Inbox shows unclaimed shares grouped by sharer
4. For each share: profile picker pre-selects last used profile with that sharer
5. Claim → backend materializes content in chosen profile's DB:
   - **game share**: create `games` + `game_videos` records (dedup by blake3_hash)
   - **tagged_clip share**: create game (dedup) + `raw_clips` record + `published_videos` record
6. Update `sharer_profile_defaults` with the chosen profile

**Signup resolution:**
When a new user signs up, query `pending_shares WHERE recipient_email = ? AND recipient_user_id IS NULL` and backfill their user_id. Inbox appears on first login.

**Endpoints:**
- `GET /api/sharing/inbox` — List unclaimed pending shares for current user
- `POST /api/sharing/inbox/{share_id}/claim` — body: `{profile_id}` — claim and materialize
- `GET /api/sharing/inbox/count` — Badge count for notification
- `GET /api/sharing/profile-default?sharer_email=` — Get default profile for sharer

## Implementation

### Steps
1. [ ] Backend: Add `pending_shares` and `sharer_profile_defaults` tables to auth.sqlite schema
2. [ ] Backend: Inbox endpoints (list, count, claim, profile default)
3. [ ] Backend: Claim handler with materialization logic (game dedup, clip + My Reels creation)
4. [ ] Backend: Signup hook — backfill `recipient_user_id` on new user registration
5. [ ] Frontend: SharedInbox component — list of pending shares grouped by sharer
6. [ ] Frontend: ClaimModal — profile picker with "Create new profile" option, pre-selected default
7. [ ] Frontend: Inbox notification badge (in header/nav)
8. [ ] Frontend: Wire claim action → backend → navigate to claimed content
9. [ ] Tests: Claim materialization for both share types, game dedup, signup resolution

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Pending shares visible in inbox after login
- [ ] Shares grouped by sharer with display name
- [ ] Profile picker shows all profiles + "Create new profile"
- [ ] Default profile pre-selected based on last claim from same sharer
- [ ] Claiming a game share materializes game + game_videos in recipient's profile DB
- [ ] Claiming a tagged_clip share materializes game + annotation + My Reels entry
- [ ] Game deduplication by blake3_hash (no duplicate if recipient already has the game)
- [ ] Inbox badge shows count of unclaimed shares
- [ ] Pending shares for non-users resolve when they sign up
- [ ] No credit cost to recipient for any claimed content
