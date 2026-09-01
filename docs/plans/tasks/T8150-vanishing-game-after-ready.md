# T8150: Game vanishes from list after "Game ready!" (credits debited)

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-31

## Problem

During the 2026-08-31 ux-designer investigation's dev reproduction, a freshly uploaded
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
       [T8310](../T8310-annotate-opens-old-game-after-upload.md).
5. [ ] Prod read-only sweep for existing victims - read-only probe script written
       (`scripts/scan_charged_reverted_games.py`, downloads a profile.sqlite + queries
       Postgres `credit_transactions` for a debit against a still-`pending` game); not yet
       run (needs prod R2/Postgres access, loops over real accounts - awaiting go-ahead).

### Progress Log

**2026-09-01**: Fixed, tested, reviewed, pushed (`feature/T8150-vanishing-game-after-ready`),
Branch CI green. Awaiting user test + merge. Prod victim sweep (step 5) not yet run.

## Acceptance Criteria

- [x] Reproducing test exists and passes with the fix
- [x] Upload success toast is never shown for a game that will not appear in the list
- [ ] Prod checked read-only for existing victims; any found are filed for repair
      (probe script ready, not yet executed)
