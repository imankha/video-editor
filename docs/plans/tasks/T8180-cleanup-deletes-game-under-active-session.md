# T8180: Upload-failure cleanup deletes the game the user is actively annotating (ghost session)

**Status:** STAGING

**2026-08-31: merged to master by AI, per explicit user authorization** ("you can approve
8180 yourself if you can provide evidence it works"). Evidence: 71 unit/backend tests green,
3/3 e2e tests green against dev with REAL seeded data (imankh, real games copied from prod),
run twice consecutively for stability, Branch CI green. A real e2e test-authoring bug (an
ambiguous "Save" button selector — this account's tag taxonomy includes a tag literally named
"Save") was found and fixed while gathering this evidence; see commit 53b62488. Merged
c2bc9484, staging auto-deploying. DONE promotion awaits the next /deploy per CLAUDE.md's
Task Status Rule (AI merges to STAGING; DONE is a user/deploy gesture).
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

### Design decision (finalized 2026-08-31): option (a) client-driven skip

Chose **(a)** — no backend state, no grace window. The uploadManager failure path already
knows the game it created for the upload (`gameResult.game_id`); in the T1540
annotate-during-upload normal case that IS the game the user is annotating. The client can
therefore decide, at failure time, whether the user is still bound to that game and skip the
cleanup delete when they are. Rejected (b) server-side grace window: it adds "last accessed by
a live session" state to the game row for no gain over the client check, which is exact.

**Mechanism — how the cleanup caller knows the user is bound.** The active annotate game id
lives in a React hook (`useAnnotateState`), unreadable from the `uploadManager` service. Mirror
it into `editorStore.activeAnnotateGameId` (a pure client UI mirror, same class as the existing
`annotateHasSelectedClip`) via a one-line sync effect in `AnnotateContainer` — NOT a persistence
path (no DB/R2 write). `uploadManager`'s two catch blocks then read
`useEditorStore.getState()` and SKIP the `only_if_empty` DELETE when
`isAnnotateMode() && activeAnnotateGameId === gameResult.game_id`. The `isAnnotateMode()` gate
means "left annotate" reverts to the current cleanup behavior — exactly (a)'s "not bound" branch.
The errored upload entry stays in `status:error` (uploadStore already retains it), so Retry
re-uses the retained game row and Discard (dismiss gesture) is the only path that removes it.

**Second half — ghost sessions impossible to miss (three loud 404 paths):**
1. `finish-annotation` 404: `gamesDataStore.finishAnnotation` returns `{ notFound: true }`
   (was a silent no-op, T7500). `AnnotateScreen.persistAnnotateProgress` reacts by surfacing a
   toast, refreshing the games list, and redirecting to the project manager (exits the ghost).
2. Clip save 404: `save_raw_clip` (backend) currently writes an ORPHAN raw_clip against a
   deleted game_id with NO existence check — a silent success into the void. Add a
   `SELECT 1 FROM games WHERE id = ?` guard → 404 when the game is gone. `useRawClipSave.saveClip`
   returns `{ notFound: true }` on 404; `handleAddClip` keeps the just-added region (work
   preserved in memory) and shows a loud toast with a "Back to games" action — no forced
   navigation, so the in-memory clip stays visible.
3. Continue-card: `handleLoadGame`'s existing "not found" branch already toasts + redirects on a
   /load 404; add `fetchGames()` there so the deleted game drops out of "Continue where you left
   off". The finish-annotation handler's `fetchGames()` covers the same for the normal exit.

### Files
- `stores/editorStore.js` — `activeAnnotateGameId` state + `setActiveAnnotateGameId`.
- `containers/AnnotateContainer.jsx` — sync effect; clip-save 404 handling; `fetchGames` on load-404.
- `services/uploadManager.js` — skip cleanup DELETE when bound (both catch blocks).
- `stores/gamesDataStore.js` — `finishAnnotation` returns `{ notFound: true }` on 404.
- `screens/AnnotateScreen.jsx` — `persistAnnotateProgress` reacts to `notFound` (toast+refresh+exit).
- `hooks/useRawClipSave.js` — `saveClip` returns `{ notFound: true }` on 404.
- `src/backend/app/routers/clips.py` — `save_raw_clip` 404 when game row is gone.

### Steps
1. [x] Reproduce ghost session on dev + failing test
2. [x] Design choice (a) vs (b) - option (a), documented above
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
