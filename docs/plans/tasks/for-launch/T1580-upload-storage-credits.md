# T1580: Upload & Storage Credits (R2 Cost Recovery)

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-04-18
**Updated:** 2026-04-18

## Problem

R2 storage costs scale linearly with users and compound over time. A non-paying user adding 3 GB/week costs ~$0.07/month in perpetuity. With no storage limits, 10K users would cost ~$3,200/month in R2 alone. The app needs a sustainable cost model that charges R2 costs back to the user without heavy friction.

## Solution

Charge credits for game uploads and storage renewals. Games are stored for 30 days, then the game video is removed unless the user renews. New accounts start with 8 credits (covers ~3 uploads + 1 renewal). All messaging is passive -- on game cards and button tooltips, no new popups.

### Economy

| Parameter | Value |
|---|---|
| New account credits | 8 |
| Upload cost | 2 credits |
| Renewal cost | 2 credits |
| Storage duration | 30 days |
| Renew button appears | <=14 days remaining |
| What expires | Game video only (`games/{hash}.mp4`) |
| What persists | Clips, working videos, final videos, metadata |
| Expired game state | Hidden from user, clips still work, can't re-annotate |

### R2 Cost Basis

| Component | Size | R2 Cost (30 days) |
|---|---|---|
| Game video (shared, deduped) | ~2.5 GB | $0.038 |
| User clips + exports (persist, not charged) | ~2.2 GB | $0.033/month ongoing |

At $0.072-0.10 per credit, 2 credits = $0.14-0.20 per upload. Margin covers persistent clip/export storage subsidy + Fly.io amortization.

### Credit Packs (existing, unchanged)

| Pack | Credits | Price | Games (upload only) |
|---|---|---|---|
| Starter | 40 | $3.99 | 20 |
| Popular | 85 | $6.99 | 42 |
| Best Value | 180 | $12.99 | 90 |

### What 8 Starting Credits Buys

| Journey | Credits Used |
|---|---|
| 3 uploads + 1 renewal | 8 (exact) |
| 4 uploads | 8 |
| 2 uploads + 2 renewals | 8 |

No exports included -- quests award credits that cover initial exports. Upload credits exist purely for R2 cost recovery.

### Customer Acquisition Cost

8 credits x worst case all uploads = 4 games x $0.038 R2 = **$0.15 CAC**

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

**Game video reference counting:** Shared game videos (`games/{hash}.mp4`) are deduped in R2. Multiple users can reference the same game video. When a user's game expires, that user loses access (game hidden from their list), but the R2 video is NOT deleted if other users still have active references.

**R2 lifecycle-based cleanup:** No cron or lazy sweep needed. R2 manages deletion automatically via object-level expiry metadata. The flow:

1. **On upload:** Set the R2 object's expiry (`Expires` header or custom metadata) to `storage_expires_at` (now + 30 days).
2. **On renewal:** Query all users' `storage_expires_at` for this `blake3_hash`, take the MAX, and update the R2 object's expiry to that date.
3. **On user expiry:** User loses access (lazy check on login). Update the R2 object's expiry to the MAX of remaining active references. If no active references remain, the object already has the correct expiry from step 2 — R2 deletes it automatically.
4. **No orphans possible:** The R2 object always knows when it should die. Even if every user abandons the app, the object expires on schedule.

Note: R2 lifecycle rules operate on prefixes/filters, not per-object expiry headers. If R2 doesn't support per-object expiry natively, store `max_expires_at` as custom metadata and run a lightweight daily lifecycle sweep that deletes objects past their `max_expires_at`. Still simpler than cross-user ref counting on every login.

**Access check (lazy, per-user):** On user login / session init, mark games as expired where `storage_expires_at < now`. Expired games are hidden from the user's game list. No R2 deletion happens here — that's handled by the lifecycle mechanism above.

**Extension stacking:** If a user extends before expiry, new_expires = current_expires + 30 days. Update the R2 object's expiry if this is now the MAX across all users. If they extend after expiry, it's too late -- game video may be gone, they'd need to re-upload.

## Implementation

### Steps

#### Backend

1. [ ] Add `lifetime_uploads` column to `credits` table in `user_db.py`
2. [ ] Add `storage_expires_at` and `storage_status` columns to `games` table in profile DB schema
3. [ ] Add constants: `UPLOAD_CREDIT_COST=2`, `STORAGE_RENEWAL_COST=2`, `STORAGE_DURATION_DAYS=30`, `RENEWAL_WARNING_DAYS=14`, `NEW_ACCOUNT_CREDITS=8`
4. [ ] Modify `POST /api/games` (game creation) to deduct 2 credits and set `storage_expires_at = now + 30 days`
5. [ ] Modify `POST /api/games/prepare-upload` response to include `upload_cost`, `balance`, `can_afford`
6. [ ] Add `POST /api/games/{game_id}/extend` endpoint -- deduct 2 credits, extend expiry by 30 days
7. [ ] Add `GET /api/games/expiring` endpoint -- return games expiring within 14 days
8. [ ] Add expiry check to user session init -- mark games as expired where `storage_expires_at < now`
9. [ ] Add R2 cleanup for expired games -- delete game video ref, decrement shared ref count
10. [ ] Seed 8 credits on new account creation (modify user creation flow)

#### Frontend

11. [ ] Add upload cost tooltip to Upload Game button (hover: "2 credits - Stored for 30 days")
12. [ ] Add credit check before upload begins -- if insufficient, open existing BuyCreditsModal
13. [ ] Add expiry display to game cards:
    - `>14 days`: muted "N days" text
    - `<=14 days`: "Renew - 2cr" button
    - `<=2 days`: same button with red accent
    - `expired`: game hidden from list entirely
14. [ ] Add inline renew handler on game card button -- deduct credits, update expiry, show confirmation
15. [ ] Update `creditStore` to refresh after upload and renewal

#### Database Migration

16. [ ] Create migration script for existing games (set `storage_expires_at = created_at + 30 days` or a generous default for existing data)

### Game Card States

```
Active (>14 days):
  "22 days" (muted text, bottom-right of card)

Expiring (<=14 days):
  [ Renew - 2cr ] (button, replaces muted text)

Urgent (<=2 days):
  [ Renew - 2cr ] (same button, red accent)

Expired:
  Game hidden from user's game list entirely. If they re-upload (same hash), treated as new upload (2 credits, fresh 30-day window).
```

### Upload Button Tooltip

```
  Upload Game
    |  hover
  "2 credits - Stored for 30 days"

  (insufficient credits variant)
  "2 credits needed - Balance: 0"
```

## Acceptance Criteria

- [ ] New accounts receive 8 credits
- [ ] Game upload deducts 2 credits
- [ ] Upload blocked with redirect to buy credits when balance < 2
- [ ] Games show expiry countdown on cards
- [ ] Games expiring within 14 days show "Renew" button
- [ ] Renew button deducts 2 credits and extends by 30 days
- [ ] Expired games are hidden from the user's game list (even if video still exists in R2 for other users)
- [ ] Expired user's clips/exports still persist and work
- [ ] Shared game videos only deleted from R2 when last user reference expires
- [ ] Upload button shows cost on hover
- [ ] No new popups or banners -- all messaging is inline/passive
- [ ] Credit transactions logged for all upload/renewal deductions
