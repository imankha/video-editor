# T1580: Game Upload & Storage Credits

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-04-18
**Updated:** 2026-04-19
**Epic:** [Storage Credits](EPIC.md)

## Problem

R2 storage costs scale linearly with users and compound over time. A non-paying user adding 3 GB/week costs ~$0.07/month in perpetuity. With no storage limits, 10K users would cost ~$3,200/month in R2 alone. The app needs a sustainable cost model that charges R2 costs back to the user without heavy friction.

## Solution

Charge credits for game uploads and storage renewals based on file size. Games are stored for 30 days, then the game video is removed unless the user extends. New accounts start with 8 credits. All messaging is passive -- on game cards and button tooltips, no new popups. Expiration indicators double as buttons that open the shared Storage Extension UX (T1581).

### Economy

| Parameter | Value |
|---|---|
| New account credits | 8 |
| Upload cost | Size-based (see formula below) |
| Renewal cost | Size-based via extension UX slider (T1581) |
| Storage duration | 30 days |
| Expiry indicator appears | <= 28 days remaining |
| What expires | Game video only (`games/{hash}.mp4`) |
| What persists | Clips, working videos, final videos, metadata |
| Expired game state | Hidden from user, clips still work, can't re-annotate |

### Size-Based Upload Pricing

Upload cost is calculated from the actual file size to fairly offset R2 costs + 10% profit:

```
cost_credits = max(1, ceil(size_gb * R2_RATE * STORAGE_DAYS / 30 * (1 + MARGIN) / CREDIT_VALUE))

Where:
  R2_RATE = $0.015/GB/month
  STORAGE_DAYS = 30
  MARGIN = 0.10
  CREDIT_VALUE = $0.072 (worst-case, Best Value pack)
```

| Game Size | R2 Cost (30 days) | Upload Cost |
|---|---|---|
| 1.0 GB | $0.015 | 1 credit |
| 2.5 GB | $0.038 | 1 credit |
| 5.0 GB | $0.075 | 2 credits |
| 10.0 GB | $0.150 | 3 credits |

Most games (1-5 GB) cost 1-2 credits. The formula ensures we never lose money on large uploads.

### R2 Cost Basis

| Component | Size | R2 Cost (30 days) |
|---|---|---|
| Game video (shared, deduped) | ~2.5 GB | $0.038 |
| User clips + exports (prepaid at Framing, no expiry) | ~10-30 MB each | $0.014 for 5 years — absorbed into GPU cost |

### Credit Packs (existing, unchanged)

| Pack | Credits | Price | Per Credit |
|---|---|---|---|
| Starter | 40 | $3.99 | $0.100 |
| Popular | 85 | $6.99 | $0.082 |
| Best Value | 180 | $12.99 | $0.072 |

### What 8 Starting Credits Buys

At typical 2.5 GB game size (1 credit each):

| Journey | Credits Used |
|---|---|
| 8 uploads | 8 |
| 6 uploads + 2 extensions | 8 |
| 4 uploads + 4 extensions | 8 |

Remaining credits fund initial exports via quests. Upload credits exist purely for R2 cost recovery.

### Customer Acquisition Cost

8 credits x worst case all uploads (1cr each) = 8 games x $0.038 R2 = **$0.30 CAC**

### Team Dedup Advantage

When teammates upload the same game, the raw video is stored once. 5 teammates sharing a game: 2.5 GB shared vs 12.5 GB without dedup (80% savings on game video). Users are charged the same; margin improves with team adoption.

## Context

### Relevant Files

**Backend:**
- `src/backend/app/routers/games_upload.py` - Upload flow: prepare, finalize, create game
- `src/backend/app/routers/credits.py` - Existing credit endpoints (balance, grant, transactions)
- `src/backend/app/services/user_db.py` - Credit functions (deduct, grant, reserve), user.sqlite schema
- `src/backend/app/routers/payments.py` - Stripe integration, credit packs

**Frontend:**
- `src/frontend/src/stores/creditStore.js` - Credit balance store
- `src/frontend/src/components/CreditBalance.jsx` - Header balance pill
- `src/frontend/src/components/BuyCreditsModal.jsx` - Purchase flow
- `src/frontend/src/components/InsufficientCreditsModal.jsx` - Insufficient credits modal (reuse for upload)
- Game card components (need to identify -- wherever game list is rendered)
- Upload button component (need to identify -- wherever "Upload Game" button lives)

**Database:**
- `user.sqlite` - credits table (add `lifetime_uploads` column)
- `profile.sqlite` - games table (add `storage_expires_at`, `storage_status` columns)

### Related Tasks
- T530 (Credit System) - DONE, provides credit infrastructure
- T540 (Quest System) - DONE, awards credits via quests (covers export costs)
- T620 (Account Cleanup) - Related, could leverage storage_status for cleanup

### Technical Notes

**Game video reference counting:** Shared game videos (`games/{hash}.mp4`) are deduped in R2. Multiple users can reference the same game video. When a user's game expires, that user loses access (game grayed out), but the R2 video is NOT deleted if other users still have active references.

**R2 cleanup strategy — Hybrid (DB sweep + lifecycle safety net):**

R2 does NOT support per-object expiration. Lifecycle rules are prefix-based and apply uniformly (1,000 rule limit per bucket). The chosen approach:

1. **Central `game_storage_refs` table** in auth.sqlite (migrates to Postgres in T1960):
   ```sql
   CREATE TABLE game_storage_refs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id TEXT NOT NULL,
       profile_id TEXT NOT NULL,
       blake3_hash TEXT NOT NULL,
       game_size_bytes INTEGER NOT NULL,
       storage_expires_at DATETIME NOT NULL,
       created_at DATETIME NOT NULL DEFAULT (datetime('now')),
       UNIQUE(user_id, profile_id, blake3_hash)
   );
   ```

2. **Daily cleanup sweep** (FastAPI background task or scheduled endpoint):
   ```sql
   SELECT blake3_hash FROM game_storage_refs
   GROUP BY blake3_hash
   HAVING MAX(storage_expires_at) < datetime('now')
   ```
   For each result: delete R2 object at `{env}/games/{hash}.mp4`, then delete rows from `game_storage_refs`.

3. **R2 lifecycle safety net**: A single bucket lifecycle rule — delete objects under `{env}/games/` after 365 days. Catches any orphans the sweep misses (bugs, downtime). Not the primary mechanism.

4. **On upload:** INSERT into `game_storage_refs` with `storage_expires_at = now + 30 days`.

5. **On extension (T1581):** UPDATE `storage_expires_at` for the user's row. No R2 metadata changes needed.

**Access check (lazy, per-user):** On game list load, check `storage_expires_at` from `game_storage_refs`. Expired games are grayed out (show stats, can't load game). Clips from expired games still accessible in Draft Reels and My Reels.

**Extension stacking:** If a user extends before expiry, `new_expires = current_expires + extension_days`. If they extend after expiry but R2 object still exists (other users keeping it alive, or within 365-day safety net), restore access with fresh 30-day window. If R2 object is gone, they'd need to re-upload.

## Implementation

### Steps

#### Backend

1. [ ] Add `game_storage_refs` table to auth.sqlite schema (see Technical Notes for DDL)
2. [ ] Add `storage_expires_at` and `storage_status` columns to `games` table in profile DB schema
3. [ ] Add constants: `STORAGE_DURATION_DAYS=30`, `EXPIRY_VISIBLE_DAYS=28`, `NEW_ACCOUNT_CREDITS=8`, R2 cost formula params
4. [ ] Add size-based cost calculation utility (shared with T1581 extension UX)
5. [ ] Modify `POST /api/games` (game creation) to calculate size-based cost, deduct credits, set `storage_expires_at = now + 30 days`, INSERT into `game_storage_refs`
6. [ ] Modify `POST /api/games/prepare-upload` response to include `upload_cost` (calculated from file size), `balance`, `can_afford`
7. [ ] Add expiry check on game list load — query `game_storage_refs` for user, update `storage_status` on expired games
8. [ ] Add daily cleanup sweep — find hashes where all refs expired, delete R2 objects, delete rows
9. [ ] Set R2 lifecycle safety net rule: delete `{env}/games/*` after 365 days
10. [ ] Seed 8 credits on new account creation (modify user creation flow)

#### Frontend

11. [ ] Add upload cost display to Upload Game button (show size-based cost after file selected)
12. [ ] Add credit check before upload begins — if insufficient, open existing BuyCreditsModal
13. [ ] Gray out expired games on game list (show stats, disable load)
14. [ ] Update `creditStore` to refresh after upload

### Game Card Expiration

Expired games are grayed out on the game list — stats visible but the game can't be loaded. ExpirationBadge component (T1581) will be added in the next task. If a user re-uploads (same hash), treated as new upload (size-based cost, fresh 30-day window). Clips from expired games remain accessible in Draft Reels and My Reels.

### Upload Cost Display

After file is selected, show the size-based cost:
```
  Upload Game (2.5 GB)
  "1 credit - Stored for 30 days"

  (insufficient credits variant)
  "1 credit needed - Balance: 0"  [Buy Credits]
```

## Acceptance Criteria

- [ ] New accounts receive 8 credits (new signups only, not existing accounts)
- [ ] Game upload cost is size-based (formula in Economy section)
- [ ] Upload blocked with redirect to buy credits when balance insufficient
- [ ] Upload button shows size-based cost after file selected
- [ ] Expired games are grayed out on game list (stats visible, can't load game)
- [ ] Expired user's clips/exports still persist and work (Draft Reels + My Reels)
- [ ] `game_storage_refs` table in auth.sqlite tracks cross-user expiry
- [ ] Daily cleanup sweep deletes R2 objects when all user refs expired
- [ ] R2 lifecycle safety net: 365-day rule on `{env}/games/` prefix
- [ ] Shared game videos only deleted from R2 when last user reference expires
- [ ] No new popups or banners -- all messaging is inline/passive
- [ ] Credit transactions logged for all upload deductions
