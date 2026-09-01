# T8150: Game vanishes from list after "Game ready!" (credits debited)

**Status:** WIP
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
1. [ ] Reproduce + failing test
2. [ ] Root cause (expert agent if the mechanism is not obvious on first read)
3. [ ] Fix + prod read-only sweep for existing victims
4. [ ] Verify the second anomaly (old-game-opens) is or is not the same root cause

## Acceptance Criteria

- [ ] Reproducing test exists and passes with the fix
- [ ] Upload success toast is never shown for a game that will not appear in the list
- [ ] Prod checked read-only for existing victims; any found are filed for repair
