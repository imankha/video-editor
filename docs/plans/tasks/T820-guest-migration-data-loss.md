# T820: Guest-to-Email Migration Silently Fails, Orphaning User Data

**Status:** TESTING
**Impact:** 10
**Complexity:** 6
**Created:** 2026-04-01
**Updated:** 2026-04-02
**Depends On:** T920

## Problem

When a guest user logs in with Google (email), the system attempts to migrate their guest profile data to the email account via `_migrate_guest_profile()`. If R2 is unreachable during this migration, the function silently returns, the session switches to the email account's user_id, and the guest's games/projects/clips become permanently inaccessible.

The user sees a blank account with none of their work. The guest data still exists in R2 under the old user_id but there's no way to access it — the guest session is gone and the migration was skipped.

### Observed Scenario (2026-04-01)

1. User worked as guest `68d5bee9...` — had 2 games, "Spring 2026" project with 37 clips, framing edits
2. R2 connectivity became intermittent
3. User logged in with `imankh@gmail.com` → existing account `bee3ab2c...` found
4. `_migrate_guest_profile(68d5bee9, bee3ab2c)` called
5. R2 read for guest profile failed → migration silently skipped (line 274-276)
6. Session switched to `bee3ab2c...` — user sees empty account
7. Guest session expired — no way to re-access guest data

### User Impact
- **Complete data loss** — all games, clips, projects, framing edits gone
- **No warning** — user sees blank account with no error message
- **No recovery path** — guest session expired, data orphaned in R2
- **Credit orphaning** — guest's credits in user.sqlite are lost (separate user_id)

## Root Causes

1. **Silent failure on R2 error** (auth.py:274-276) — `except R2ReadError: return`
2. **Broad `except Exception`** (auth.py:323-324) — swallows ALL migration errors
3. **No retry/deferred migration** — guest_user_id never stored for future retry
4. **Credits not transferred** — `_merge_guest_into_profile()` merges games/achievements in profile DB but never transfers credits from guest's user.sqlite to target's user.sqlite
5. **Session switches before migration confirmed** — login completes regardless of migration outcome
6. **Local guest data cleaned up independently** — session expiry removes local files regardless of migration status

## Solution

After T920, `pending_migrations` table lives in the **target user's** user.sqlite. The guest_user_id is recorded before migration attempt, ensuring recovery is always possible.

### Implementation

1. **Record migration intent FIRST** — before attempting anything, write to target's user.sqlite:
   ```python
   with get_user_db_connection(target_user_id) as conn:
       conn.execute("INSERT INTO pending_migrations (guest_user_id, status) VALUES (?, 'pending')", ...)
       conn.commit()
   ```

2. **If migration fails, block the login** — return HTTP 503: "We're having trouble transferring your data. Please try again in a moment." Don't switch the session.

3. **Transfer credits** — after profile merge, transfer guest's credit balance:
   ```python
   guest_balance = get_credit_balance(guest_user_id)  # from guest's user.sqlite
   if guest_balance > 0:
       grant_credits(target_user_id, guest_balance, 'migration_transfer', guest_user_id)
   ```

4. **Replace broad `except Exception`** — handle `R2ReadError`, `sqlite3.Error`, `OSError` specifically. Let unexpected exceptions propagate.

5. **Mark migration complete** — update pending_migrations status to 'completed'

6. **Add retry endpoint** — `POST /api/auth/retry-migration` reads pending_migrations from user.sqlite and retries

7. **Add migration status to `/api/auth/me`** — if pending migration exists, include `{ migration_pending: true }` so frontend shows a retry banner

### What Gets Migrated

| Data | Source | Target | Method |
|------|--------|--------|--------|
| Games | guest profile DB | target profile DB | Dedup by blake3_hash |
| Game videos | guest profile DB | target profile DB | Remap game_id |
| Achievements | guest profile DB | target profile DB | INSERT OR IGNORE |
| Credits | guest user.sqlite | target user.sqlite | grant_credits with 'migration_transfer' source |
| Credit history | guest user.sqlite | target user.sqlite | Copy transactions with migration reference |

## Relevant Files

- `src/backend/app/routers/auth.py` — Lines 260-324: `_migrate_guest_profile()`, Lines 181-257: `_merge_guest_into_profile()`, Lines 390-416: Google login flow
- `src/backend/app/services/user_db.py` (after T920) — pending_migrations CRUD, credit transfer
- `src/backend/app/storage.py` — R2 profile read/write

## Acceptance Criteria

- [ ] Migration intent recorded in pending_migrations BEFORE attempt
- [ ] Login blocked (HTTP 503) if migration fails and guest has data
- [ ] Guest credits transferred to target account
- [ ] Guest credit history copied with migration reference
- [ ] Broad `except Exception` replaced with specific error handling
- [ ] Retry endpoint available for frontend
- [ ] `/api/auth/me` includes migration status
- [ ] Frontend shows retry banner when migration is pending
