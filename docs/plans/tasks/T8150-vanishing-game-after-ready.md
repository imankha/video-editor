# T8150: Game vanishes from list after "Game ready!" (credits debited)

**Status:** STAGING
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-31

## Problem

During the 2026-08-31 ux-investigator investigation's dev reproduction, a freshly uploaded
game showed the "Game ready!" success toast and then was ABSENT from the games list.
Credits were debited; the R2 object was durable; the game row was gone. This is the same
shape as the ojedalucas19 prod incident (T7870: charged + orphaned upload) and adjacent
to the ref_count drift family (T6770 fixed the derived-set half).

Second, lower-confidence anomaly from the same session (possibly dev-account
contamination, flagged in the theory doc): after an upload with a pre-existing game,
Annotate opened the OLD game while the toast announced the new one.

Why P1: this failure eats money and trust at the exact step the whole first-clip funnel
depends on; every UX fix upstream is defeated if the upload's success message lies.

## Solution

Bug-reproduction skill: reproduce FIRST, failing test before any fix.

1. Reproduce on dev: fresh profile, upload, watch the games list + Postgres/user-db rows
   + R2 across the finalize window. The investigation's repro context: e2e dev account,
   freshly created No-Sport profile ("UX Fresh" residue profile still exists with 1 game
   + 1 clip - inspect it before cleaning it up; it may hold the evidence).
2. Suspects, in depth order: finalize/cleanup race deleting or never-committing the game
   row after the ready toast; list-refresh reading a different profile DB than the write
   landed in (cross-profile write); sweep/reaper misclassifying the fresh game as
   stranded (T7880's reap tooling shipped recently - verify its filters).
3. Cross-check prod read-only: any game rows or R2 objects whose upload succeeded but
   which no current games list would show (the T7870 probe recipes apply).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/` upload finalize path + games list endpoint
- `src/backend/app/services/sweep_scheduler.py` / reap filters (T7880)
- Frontend games list refresh after upload success toast

### Related Tasks
- Same family: T7870 (ojedalucas19), T7880 (stranded reap), T6770 (ref_count drift)
- Unblocks confidence in: first-clip-funnel epic (T8120-T8140)

## Implementation

### Steps
1. [x] Reproduce + failing test
2. [x] Root cause (expert agent - mechanism was not obvious on first read)
3. [x] Fix - `activate_game` and `create_game` (games.py) were not durable_sync routes;
       the pending->ready flip rode a fire-and-forget R2 sync that a lock-defer or CAS
       re-heal could discard, reverting the game to `pending` (filtered from readyGames)
       while the credit debit stayed durable in Postgres. Added `Depends(durable_sync)`.
       No schema change. Reviewed and approved (1 blocking lint fix applied).
4. [x] Verify the second anomaly - CONFIRMED separate root cause (create_game's
       dedup/reuse logic returns an old game id), NOT fixed by this change. Split out as
       [T8340](../T8340-annotate-opens-old-game-after-upload.md).
5. [x] Prod read-only sweep for existing victims - run 2026-09-01 by the supervisor
       (`scripts/scan_charged_reverted_games.py` logic, driven via `edit-user-db.py`'s
       per-user R2 download): found all 19 prod accounts with a `game_upload` debit
       (`credit_transactions.source='game_upload' AND amount<0`) - arshia.kalantari (19
       debits), bknoto (3), imankh (10), sarkarati (7), kristi.defelice (4), lisagee1443
       (3), drewsoccerati (2), cschwartz78/eticatch/jautomo/jordark91330/lincdyn.j19/
       l.piress17/mikhail.k.taylor/mostafaali452010/ojedalucas19/rikusbothainnz/
       stephmckinnon86/trog3920 (1 each) - then checked every profile.sqlite across all
       of each user's profiles for `status='pending'` games. **RESULT: zero pending games
       found across all 19 accounts.** No existing charged-but-reverted victims on prod.

### Progress Log

**2026-09-01**: Fixed, tested, reviewed, pushed (`feature/T8150-vanishing-game-after-ready`),
Branch CI green. Prod read-only sweep run: 0 victims found (19 charged accounts checked,
all clean). Awaiting user test + merge.

## Acceptance Criteria

- [x] Reproducing test exists and passes with the fix
- [x] Upload success toast is never shown for a game that will not appear in the list
- [x] Prod checked read-only for existing victims; 0 found (19 charged accounts checked,
      all clean) - nothing to file for repair
