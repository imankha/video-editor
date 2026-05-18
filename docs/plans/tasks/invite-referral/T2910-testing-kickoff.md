# T2910 Test & Fix: Referral Graph

## Task

Read this handoff document and help me test, debug, and fix T2910: referral attribution graph with admin analytics.

## What Was Built

Backend referral attribution system that records who referred whom during signup (via invite codes) and share acceptance (via game/video/annotation shares). Includes admin endpoints for leaderboard, channel breakdown, per-user referrals, and recursive referral trees.

**Branch:** `feature/T2910-referral-graph`
**Status:** TESTING (12 automated tests pass)

---

## Architecture

```
                    SIGNUP FLOW (invite_link channel)
                    ================================
User A calls GET /api/me/invite-code
  -> generates sha256(user_id)[:8]
  -> persists to users.invite_code column
  -> returns code + URL: reelballers.com?ref={code}

User A sends invite link to User B

User B visits reelballers.com?ref={code}
  -> frontend stores ref in sessionStorage
  -> on signup, ref sent in auth request body
  -> _find_or_create_user() creates user
  -> resolve_invite_code(ref) -> referrer user_id
  -> record_referral(referrer_id, new_user_id, 'invite_link', ref)
  -> INSERT INTO referrals (UNIQUE on referred_id, first wins)

                    SHARE FLOW (game_share / annotation_share / reel_share)
                    ========================================================
User A shares a game/video/annotation to User B's email

User B signs up and resolves pending shares
  -> resolve_pending_shares() processes each pending share
  -> Looks up shares.share_type -> maps to channel
  -> record_referral(sharer_id, user_id, channel, share_id)
  -> ON CONFLICT DO NOTHING (invite_link attribution wins if exists)

                    ADMIN QUERIES
                    =============
GET /admin/referrals/leaderboard     -> counts per referrer
GET /admin/referrals/by-channel      -> counts per channel
GET /admin/referrals/user/{id}       -> direct referrals for one user
GET /admin/referrals/tree/{id}       -> recursive tree (depth <= 5)
```

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `src/backend/app/migrations/postgres/v004_referral_graph.py` | **NEW** - Migration: referrals table + invite_code column on users |
| `src/backend/app/migrations/postgres/__init__.py` | Register V004ReferralGraph |
| `src/backend/app/services/pg.py` | Add referrals table + invite_code to _SCHEMA_DDL |
| `src/backend/app/services/sharing_db.py` | Add `record_referral()`, `resolve_invite_code()`, `persist_invite_code()`, `SHARE_TYPE_TO_CHANNEL` |
| `src/backend/app/routers/auth.py` | Hook referral attribution into `_find_or_create_user()` for new users |
| `src/backend/app/routers/users.py` | Persist invite_code on `GET /api/me/invite-code` |
| `src/backend/app/routers/clips.py` | Hook share-based attribution into `resolve_pending_shares()` |
| `src/backend/app/routers/admin.py` | 4 referral admin endpoints |

### Tests
| File | Tests |
|------|-------|
| `src/backend/tests/test_referrals.py` | 12 tests (record_referral, resolve_invite_code, persist, channel mapping, integration) |
| `src/backend/tests/conftest.py` | Added referrals cleanup + migration runner to pg_conn fixture |

---

## How to Test Manually

### Prerequisites

1. Backend running: `cd src/backend && uvicorn app.main:app --reload`
2. Frontend running: `cd src/frontend && npm run dev`
3. **Run migration on dev DB:** `POST /api/admin/migrate` (creates referrals table + invite_code column)

### Test Flow

1. **Invite code generation + persistence:**
   - Log in as any user
   - Call `GET /api/me/invite-code`
   - Verify response has `invite_code` and `invite_url`
   - Check DB: `SELECT invite_code FROM users WHERE user_id = '{user_id}'` should have the code

2. **Invite-link referral attribution:**
   - User A: get invite code via `GET /api/me/invite-code`
   - User B: sign up with `?ref={code}` in the URL (or pass `ref` in auth body)
   - Check DB: `SELECT * FROM referrals WHERE referred_id = '{user_b_id}'`
   - Should show `channel = 'invite_link'`, `referrer_id = '{user_a_id}'`

3. **Share-based referral attribution:**
   - User A shares a game to User B's email
   - User B signs up and resolves the pending share
   - Check DB: `SELECT * FROM referrals WHERE referred_id = '{user_b_id}'`
   - Should show appropriate channel (`game_share`, `annotation_share`, or `reel_share`)

4. **First-attribution-wins:**
   - If User B was already attributed via invite link, share-based attribution should be a no-op
   - Verify only one row per `referred_id`

5. **Admin endpoints (requires admin user):**
   - `GET /api/admin/referrals/leaderboard` - returns referral counts per user
   - `GET /api/admin/referrals/by-channel` - returns counts per channel
   - `GET /api/admin/referrals/user/{user_id}` - returns direct referrals
   - `GET /api/admin/referrals/tree/{user_id}` - returns recursive tree with depth breakdown

### Edge Cases to Test

1. **Self-referral**: User signs up with their own invite code -> no referral row created
2. **Unknown invite code**: Signup with `ref=xxxxxxxx` (invalid) -> no referral, no error
3. **Existing user with ref**: Already-registered user logs in with `?ref={code}` -> no attribution (only new users)
4. **Invite code idempotency**: Calling `GET /api/me/invite-code` multiple times should return the same code and not overwrite

---

## Known Potential Issues

1. **Migration not run**: If you see `UndefinedColumn: column "invite_code" does not exist`, run `POST /api/admin/migrate`
2. **Referral attribution silently fails**: Attribution errors are caught and logged as warnings. Check backend logs for `[Auth] referral attribution failed` or `[resolve-pending-shares] Referral attribution failed`
3. **Admin 403**: Make sure the test user's email is in the `admin_users` table

---

## Running Automated Tests

```bash
cd src/backend && .venv\Scripts\python.exe -m pytest tests/test_referrals.py -v
```

Full suite:
```bash
cd src/backend && .venv\Scripts\python.exe run_tests.py
```

---

## Key Code Locations for Debugging

| What | Where |
|------|-------|
| Referral service functions | `src/backend/app/services/sharing_db.py` (bottom of file) |
| Invite code persistence | `src/backend/app/routers/users.py:21` |
| Signup attribution hook | `src/backend/app/routers/auth.py:274-281` |
| Share attribution hook | `src/backend/app/routers/clips.py:2388-2400` |
| Admin referral endpoints | `src/backend/app/routers/admin.py` (bottom of file) |
| Migration | `src/backend/app/migrations/postgres/v004_referral_graph.py` |

---

## Acceptance Criteria

- [ ] `GET /api/me/invite-code` returns code AND persists to users.invite_code
- [ ] New user signup with valid `ref` param creates referral row (channel=invite_link)
- [ ] New user signup with invalid `ref` does not error, just no referral
- [ ] Existing user login with `ref` does NOT create referral
- [ ] Resolving a pending share creates referral row with correct channel
- [ ] First attribution wins (UNIQUE on referred_id, ON CONFLICT DO NOTHING)
- [ ] Self-referral is blocked
- [ ] Admin leaderboard endpoint returns correct counts
- [ ] Admin by-channel endpoint returns correct breakdown
- [ ] Admin user/{id} endpoint returns direct referrals
- [ ] Admin tree/{id} endpoint returns recursive tree (depth <= 5)
- [ ] All 12 automated tests pass
