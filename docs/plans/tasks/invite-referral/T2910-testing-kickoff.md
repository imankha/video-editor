# T2910 Test & Fix: Referral Graph

## Task

Read this handoff document and help me test, debug, and fix T2910: referral attribution graph with admin analytics.

## What Was Built

Backend referral attribution system that records who referred whom during signup (via invite codes) and share acceptance (via teammate clip shares, game shares, annotation shares, and reel shares). Includes admin endpoints for leaderboard, channel breakdown, per-user referrals, and recursive referral trees.

**Branch:** `feature/T2910-referral-graph`
**Status:** TESTING (12 automated tests pass)
**Migration:** v004 already applied to dev DB.

---

## Architecture

```
                    REFERRAL CHANNELS (5 total)
                    ===========================
invite_link      - User signs up via ?ref={invite_code} in URL
teammate_share   - Clip share with tagged teammates (tag_name != null)
game_share       - Full game share, no tag filtering (tag_name is null, share_type='game')
annotation_share - Annotated playback share (share_type='annotation_playback')
reel_share       - Exported video share (share_type='video')


                    SIGNUP FLOW (invite_link channel)
                    ================================
User A calls GET /api/me/invite-code
  -> generates sha256(user_id)[:8]
  -> persists to users.invite_code column (first call only)
  -> returns { invite_code, invite_url }

User A sends invite link to User B

User B visits reelballers.com?ref={code}
  -> frontend stores ref in sessionStorage
  -> on signup, ref sent in auth request body (GoogleAuthRequest.ref / VerifyOtpRequest.ref)
  -> _find_or_create_user() creates new user
  -> resolve_invite_code(ref) -> looks up users.invite_code -> referrer user_id
  -> record_referral(referrer_id, new_user_id, 'invite_link', ref)
  -> INSERT INTO referrals (UNIQUE on referred_id, first wins)

Note: Only fires for NEW users. Existing users logging in with ?ref= get no attribution.


                    SHARE FLOW (4 share channels)
                    =============================
User A shares clips/game/annotation/video to User B's email
  -> Creates shares row + pending_teammate_shares row

User B signs up and resolves pending shares via POST /api/clips/resolve-pending-shares
  -> For each pending share:
     1. If pending.tag_name is not null -> channel = 'teammate_share'
     2. Else look up shares.share_type and map:
        'game'                -> 'game_share'
        'annotation_playback' -> 'annotation_share'
        'video'               -> 'reel_share'
     3. record_referral(sharer_id, user_id, channel, share_id)
     4. ON CONFLICT (referred_id) DO NOTHING -- first attribution wins

Priority: invite_link (fires at signup) always wins over share-based (fires later at resolve).


                    ADMIN QUERIES
                    =============
GET /api/admin/referrals/leaderboard     -> referral counts per user, desc
GET /api/admin/referrals/by-channel      -> counts per channel
GET /api/admin/referrals/user/{user_id}  -> direct referrals for one user
GET /api/admin/referrals/tree/{user_id}  -> recursive tree size (depth <= 5)
```

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `src/backend/app/migrations/postgres/v004_referral_graph.py` | **NEW** - Migration: `referrals` table + `invite_code` column on `users` |
| `src/backend/app/migrations/postgres/__init__.py` | Register V004ReferralGraph |
| `src/backend/app/services/pg.py` | Add referrals table + invite_code to `_SCHEMA_DDL` |
| `src/backend/app/services/sharing_db.py:348-396` | Add `record_referral()`, `resolve_invite_code()`, `persist_invite_code()`, `SHARE_TYPE_TO_CHANNEL` |
| `src/backend/app/routers/auth.py:274-281` | Hook referral attribution into `_find_or_create_user()` for new users with `ref` param |
| `src/backend/app/routers/users.py:21-28` | Persist invite_code to DB on `GET /api/me/invite-code` |
| `src/backend/app/routers/clips.py:2387-2399` | Hook share-based attribution into `resolve_pending_shares()`, teammate_share detection via tag_name |
| `src/backend/app/routers/admin.py` (bottom) | 4 referral admin endpoints |
| `src/backend/tests/conftest.py` | Added referrals cleanup + migration runner to pg_conn fixture |
| `src/backend/tests/test_migrations.py` | Fixed stale migration count assertions |

### Tests
| File | Tests |
|------|-------|
| `src/backend/tests/test_referrals.py` | 12 tests: record_referral CRUD, self-referral, duplicates, resolve_invite_code, persist_invite_code, channel mapping, integration |

---

## How to Test Manually

### Prerequisites

1. Backend running: `cd src/backend && uvicorn app.main:app --reload`
2. Frontend running: `cd src/frontend && npm run dev`
3. v004 migration already applied to dev DB (confirmed).
4. Admin user: `imankh@gmail.com` is in `admin_users` table.

### Auth Bypass (for browser testing)

Use Playwright or manual API calls with these headers in dev:

```
X-User-ID: <user-id>
X-Test-Mode: true
```

Or use `POST /api/auth/test-login` with `X-Test-Mode` header to get a session cookie.

For Zustand store bypass (frontend):
```javascript
useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false })
```

### DB Query Helper

To check referral state during testing, run queries via Python:

```bash
cd src/backend && .venv/Scripts/python.exe -c "
from dotenv import load_dotenv; load_dotenv('../../.env')
from app.services.pg import init_pg_pool, get_pg
init_pg_pool()
with get_pg() as conn:
    cur = conn.cursor()
    cur.execute('SELECT * FROM referrals ORDER BY created_at DESC LIMIT 10')
    for r in cur.fetchall(): print(dict(r))
"
```

Replace the query as needed:
- `SELECT user_id, email, invite_code FROM users WHERE invite_code IS NOT NULL` -- see who has invite codes
- `SELECT * FROM referrals WHERE referrer_id = '{user_id}'` -- see who a user referred
- `SELECT * FROM referrals WHERE referred_id = '{user_id}'` -- see who referred a user

### Test Flow

#### 1. Invite code generation + persistence
- Log in as your account (imankh@gmail.com)
- Call `GET /api/me/invite-code`
- Verify response has `invite_code` and `invite_url` fields
- Verify DB: `SELECT invite_code FROM users WHERE email = 'imankh@gmail.com'` should now be non-null
- Call endpoint again -- same code returned, DB unchanged

#### 2. Invite-link referral attribution
- User A: get invite code (e.g., `abc12345`)
- User B: sign up via OTP or Google with `ref=abc12345` in the auth request body
- Verify DB: `SELECT * FROM referrals WHERE referred_id = '{user_b_id}'`
- Expected: `channel = 'invite_link'`, `referrer_id = '{user_a_id}'`, `source_id = 'abc12345'`

#### 3. Teammate clip share attribution
- User A tags teammates on clips in a game, then shares via `POST /api/clips/share-with-teammates`
- User B (new user) signs up from the share email
- User B resolves pending shares
- Verify DB: `SELECT * FROM referrals WHERE referred_id = '{user_b_id}'`
- Expected: `channel = 'teammate_share'` (because `tag_name` is not null on the pending share)

#### 4. Game share attribution (no tag)
- User A shares a full game via `POST /api/games/{id}/share-game` (no teammate tag filtering)
- User B (new user) signs up, resolves pending share
- Expected: `channel = 'game_share'` (tag_name is null, share_type='game')

#### 5. First-attribution-wins
- User A sends invite link to User B
- User A also shares clips with User B's email
- User B signs up with `?ref={code}` -- invite_link referral fires at signup
- User B resolves pending share -- share attribution is a no-op (UNIQUE constraint)
- Verify only 1 row in referrals for User B

#### 6. Admin endpoints
All require admin session (imankh@gmail.com):
- `GET /api/admin/referrals/leaderboard` -- returns `[{ referrer_id, email, referral_count }]`
- `GET /api/admin/referrals/by-channel` -- returns `[{ channel, count }]`
- `GET /api/admin/referrals/user/{user_id}` -- returns `[{ referred_id, email, channel, source_id, created_at }]`
- `GET /api/admin/referrals/tree/{user_id}` -- returns `{ user_id, total, by_depth: [{ depth, count }] }`

### Edge Cases to Test

1. **Self-referral**: User signs up with their own invite code -> no referral row created
2. **Unknown invite code**: Signup with `ref=xxxxxxxx` (not in DB) -> no referral, no error, user still created
3. **Existing user with ref**: Already-registered user logs in with `?ref={code}` -> no attribution (only new users)
4. **Invite code idempotency**: Calling `GET /api/me/invite-code` multiple times returns same code, doesn't overwrite
5. **Multiple pending shares, one user**: Only first resolved share records attribution; subsequent ones are no-ops
6. **Annotation playback share**: Share type='annotation_playback' should map to channel='annotation_share'

---

## Known Potential Issues

1. **Migration not run**: If you see `UndefinedColumn: column "invite_code" does not exist` or `UndefinedTable`, run `POST /api/admin/migrate`. (Already applied to dev DB for this session.)
2. **Referral attribution silently fails**: Attribution errors are caught and logged as warnings, not raised. Check backend logs for:
   - `[Auth] referral attribution failed for ref=...`
   - `[resolve-pending-shares] Referral attribution failed for pending_id=...`
3. **Admin 403**: Requesting user must be in `admin_users` Postgres table. imankh@gmail.com is seeded.
4. **invite_code NULL until first call**: The `invite_code` column starts NULL. It's populated lazily on the first `GET /api/me/invite-code` call. If a referral lookup fails for a valid user's code, check whether they've ever called the invite-code endpoint.
5. **Channel detection relies on tag_name**: The `teammate_share` vs `game_share` distinction is based on `pending_teammate_shares.tag_name` being non-null vs null. If the game share flow sets tag_name unexpectedly, the channel will be wrong.

---

## Running Automated Tests

```bash
# Referral tests only (12 tests)
cd src/backend && .venv\Scripts\python.exe -m pytest tests/test_referrals.py -v

# Invite tests (T2900, 17 tests)
cd src/backend && .venv\Scripts\python.exe -m pytest tests/test_invite.py -v

# Migration tests
cd src/backend && .venv\Scripts\python.exe -m pytest tests/test_migrations.py -v

# Full suite
cd src/backend && .venv\Scripts\python.exe run_tests.py
```

---

## Key Code Locations for Debugging

| What | Where |
|------|-------|
| Referral service functions | `src/backend/app/services/sharing_db.py:348-396` |
| `record_referral()` | `src/backend/app/services/sharing_db.py:360-377` |
| `resolve_invite_code()` | `src/backend/app/services/sharing_db.py:380-386` |
| `persist_invite_code()` | `src/backend/app/services/sharing_db.py:389-396` |
| `SHARE_TYPE_TO_CHANNEL` mapping | `src/backend/app/services/sharing_db.py:353-357` |
| Invite code endpoint | `src/backend/app/routers/users.py:20-28` |
| Signup attribution hook | `src/backend/app/routers/auth.py:274-281` |
| `_find_or_create_user()` | `src/backend/app/routers/auth.py:247-281` |
| Share attribution hook | `src/backend/app/routers/clips.py:2387-2399` |
| `resolve_pending_shares()` | `src/backend/app/routers/clips.py:2336-2410` |
| `share-with-teammates` endpoint | `src/backend/app/routers/clips.py:2091-2250` |
| `create_game_share()` | `src/backend/app/services/sharing_db.py:141-177` |
| Admin referral endpoints | `src/backend/app/routers/admin.py` (bottom of file, 4 endpoints) |
| Migration | `src/backend/app/migrations/postgres/v004_referral_graph.py` |
| Postgres schema DDL | `src/backend/app/services/pg.py:20-178` |

---

## Acceptance Criteria

- [ ] `GET /api/me/invite-code` returns code AND persists to `users.invite_code`
- [ ] Calling invite-code endpoint multiple times returns same code (idempotent)
- [ ] New user signup with valid `ref` param creates referral row (`channel='invite_link'`)
- [ ] New user signup with invalid/unknown `ref` does not error, just no referral
- [ ] Existing user login with `ref` does NOT create referral
- [ ] Resolving a teammate clip share (tag_name not null) records `channel='teammate_share'`
- [ ] Resolving a plain game share (tag_name null) records `channel='game_share'`
- [ ] Resolving an annotation playback share records `channel='annotation_share'`
- [ ] First attribution wins (UNIQUE on referred_id, ON CONFLICT DO NOTHING)
- [ ] Self-referral is blocked (referrer_id == referred_id returns False)
- [ ] Admin leaderboard endpoint returns correct counts
- [ ] Admin by-channel endpoint returns correct breakdown (all 5 channels possible)
- [ ] Admin user/{id} endpoint returns direct referrals
- [ ] Admin tree/{id} endpoint returns recursive tree (depth <= 5)
- [ ] All 12 automated tests pass
