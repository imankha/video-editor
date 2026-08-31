# T8180: Upload-failure cleanup deletes the game the user is actively annotating (ghost session)

**Status:** WIP
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-31

## Problem

When an upload fails, the T7470 cleanup (`DELETE /api/games/{id}?only_if_empty=true`) deletes
the pending game - **even while the user is inside Annotate on that very game** (T1540
annotate-during-upload makes this the NORMAL case, since the video plays from a local blob).
The client keeps rendering the deleted game; nothing tells the user their session is now a
ghost.

Observed in bug 47p (bknoto@gmail.com, prod, 2026-08-31):
- Game 13: cleanup-deleted at 05:25:24, ~15s after the user entered Annotate on it. The user
  then annotated for **26 minutes** and clicked Ready -> `POST /api/games/13/finish-annotation`
  -> **404, silently swallowed**. No toast, no redirect - the user only learned via the games
  list later. Same for game 15 at 16:00:19.
- Their R2-synced profile DB confirms games 7-11 and 13-15 are gone; only game 12 survives.
- The "Continue where you left off" card and editor context still pointed at deleted game 15
  when the bug was filed.
- Any clips saved during a ghost session go to a deleted game_id (verify whether the clip
  POST fails loudly or writes an orphan row - bknoto has exactly 1 raw_clip).

The only_if_empty guard protects committed content, not the active session: at cleanup time
the user has annotated nothing yet, so the delete proceeds - and then the user does the work
into the void.

Distinct from T8150 (READY game vanishing after success toast) but the same product promise:
**the app must never let the user keep working in a game that no longer exists.**

## Solution

Two halves, both required:

1. **Server: don't yank the rug.** The cleanup delete must not remove a game the reporting
   client is still bound to. Options (pick at design time):
   a. Client-driven: the cleanup caller (uploadManager catch) KNOWS the user is currently in
      annotate on that gameId (uploadStore entry.gameId vs editor's current game) - skip the
      cleanup delete and instead mark the entry failed-with-retained-game so Retry can re-use
      the game row (upload session re-attach) or discard explicitly deletes it.
   b. Server-side grace: only_if_empty refuses when the game's video was accessed by a live
      session within N minutes. Weaker: adds state; prefer (a).
2. **Client: a ghost session must be impossible to miss.**
   - `finish-annotation` (and every per-game action in annotate) treating 404 as
     "game deleted": leave the screen with a clear error toast, refresh the games list -
     never a silent no-op. Today the 404 is logged as a SLOW FETCH warning and swallowed.
   - Clip saves against a 404'd game: fail LOUDLY and preserve the user's work in memory
     (offer retry once the game is recreated) - never silently drop.
   - "Continue where you left off" must not offer a deleted game.

Bug-reproduction skill: reproduce first (dev: start upload, force part failure, stay in
annotate, watch the cleanup delete land, click Ready) - failing e2e/unit before the fix.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/services/uploadManager.js` - cleanup call sites (lines ~900-930, 1020s)
- `src/frontend/src/stores/uploadStore.js` - failure handling (onEntryError), entry.gameId
- `src/backend/app/routers/games.py` - `delete_game` only_if_empty guards (1788-1836)
- Annotate container/screens - finish-annotation call + 404 handling; continue-card source
- `.claude/knowledge/annotate.md` - update with the annotate-during-upload deletion contract

### Related Tasks
- T8160 (the outage that made this path fire constantly), T8150 (vanishing ready game),
  T7470 (introduced only_if_empty cleanup), T7870 (activated-game guard), T1540
  (annotate-during-upload)
- Bug 47p evidence

## Implementation

### Steps
1. [ ] Reproduce ghost session on dev + failing test
2. [ ] Design choice (a) vs (b) - brief, in-file; no full architect gate unless it grows
3. [ ] Server/client fix + loud 404 handling in annotate
4. [ ] Verify: failed upload while annotating never strands the user; Ready either works or
       visibly errors with work preserved

## Acceptance Criteria

- [ ] A failed upload can no longer delete a game whose annotate session is active in the
      reporting client
- [ ] finish-annotation 404 surfaces visibly and exits the ghost session (test asserts)
- [ ] Clip saves to a deleted game fail loudly, work preserved in memory
- [ ] Continue-card never points at a deleted game
- [ ] knowledge doc updated
