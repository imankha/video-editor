# T8310: Annotate opens the OLD game while the upload-success toast announces the NEW one

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-01

## Problem

Second, lower-confidence anomaly noticed during the 2026-08-31 ux-designer investigation
and confirmed as a SEPARATE root cause while fixing T8150 (vanishing game after "Game
ready!"): after an upload with a pre-existing game already present, Annotate opened the
OLD game while the toast announced the new one.

T8150's investigation (2026-09-01) traced this to `create_game`'s dedup/reuse logic
(`games.py:274`): when the same content is detected as already present, the endpoint
returns the OLD game's id via `onGameCreated`, but the toast copy still announces a fresh
upload. This is unrelated to T8150's durable-sync root cause (fire-and-forget R2 sync on
`activate_game`) - confirmed as a distinct code path, not fixed by that task's change.

## Solution (not yet investigated in depth - scope this at pickup)

- Confirm the exact dedup/reuse condition in `create_game` (`games.py:274`) that returns
  an existing game id instead of creating a new one.
- Decide the correct UX: if the upload is a genuine duplicate (same content hash), either
  (a) the toast copy should say so explicitly ("this game is already in your account")
  instead of "Game ready!", or (b) if the dedup is a false positive for this scenario,
  fix the reuse condition so a distinct upload creates/opens a distinct game.
- Reproduce first (bug-reproduction skill) before choosing between (a) and (b).

## Context

### Relevant Files (anticipated)
- `src/backend/app/routers/games.py` - `create_game` (~line 274), dedup/reuse condition
- Frontend upload-success toast + `onGameCreated` handler (locate via grep)

### Related Tasks
- Surfaced by T8150 (vanishing game after "Game ready!") - confirmed as a DIFFERENT root
  cause during that task's fix, not resolved by it.

## Acceptance Criteria

- [ ] Reproducing test exists for the exact scenario (upload with a pre-existing game
      present)
- [ ] Annotate opens the game the toast actually announces, or the toast copy accurately
      reflects a dedup/reuse outcome
