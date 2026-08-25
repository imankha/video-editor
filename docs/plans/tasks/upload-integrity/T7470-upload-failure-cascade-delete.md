# T7470: Upload-failure cleanup cascade-deletes user annotation work

**Status:** WAITING ON USER
**Priority:** P1
**Impact:** 9
**Complexity:** 4
**Created:** 2026-08-24
**Updated:** 2026-08-24
**Epic:** [Upload Failure Integrity](EPIC.md)

## Problem

When a game-video upload fails, the frontend "cleanup" path deletes the pending game row via
`DELETE /api/games/{game_id}`. That endpoint runs `_delete_game_cascade`, whose blast radius
is documented in its own docstring: raw_clips cascade from games (ON DELETE CASCADE), which
cascades to working_clips; projects referencing those clips are pruned when emptied.

This collides head-on with the T1540 annotate-during-upload design: the client receives a
usable `game_id` seconds after the upload starts, precisely so the user can annotate while
the video transfers. Any user who annotates N clips during a long upload and then hits a
transfer failure has all N clips, their working_clips, and their auto-created draft project
**silently cascade-deleted by our own cleanup handler**, with no warning and no undo.

### Proven on prod (2026-08-24 investigation)

bigajosue@gmail.com (user `fb40690a-edcf-4504-a51f-f9df6f84ac4f`, profile `97b76ac0`), a
PAYING user (399 cents, 88 credits):

| time (UTC) | event |
|---|---|
| 04:03:03 | pays $3.99, +80 credits |
| 04:03:05 / :16 / :34 | 3 x `game_created` "Vs ADF Aug 23": three rapid retries, each failing in 11-18 s |
| 04:07:21 | `game_created` #4 "Vs iddkdk Aug 23"; user annotates against the local blob (T1540) |
| ~04:11:1x | upload #4 fails -> catch block -> `DELETE /api/games/4` -> cascade |
| 04:11:20-25 | 4 x `annotation_completed` fired against the already-deleted row (see T7500) |
| 04:11:25 | profile.sqlite synced to R2 with `games=0`, `sqlite_sequence.games=4` |

The `sqlite_sequence.games=4` with 0 surviving rows proves 4 inserts + 4 deletes in this
exact file. These two users happened to have created zero clips, so the cascade destroyed
only game rows; the destructive path for annotation work is live in prod today and is
limited only by luck.

## Solution

**A failed upload must not delete a game that has acquired user content.** Direction (final
shape may be adjusted during implementation):

1. Frontend (`uploadManager.js` catch blocks): before issuing the cleanup DELETE, check
   whether the game has user content (raw_clips exist, or viewed_duration > 0). If it does,
   do NOT delete; leave the game at `status='pending'` and surface a retry/resume affordance
   (T7490 builds the surfacing; this task must at minimum stop the deletion).
2. Backend defense-in-depth: the cleanup delete and a deliberate user delete are different
   intents hitting the same endpoint. Give the cleanup path a way to say "delete only if
   still empty" (e.g. a query param like `?only_if_empty=true`, or a dedicated cleanup
   endpoint) so a race (clips committed between the frontend check and the DELETE) cannot
   destroy work. A user-gestured delete from the UI keeps full cascade semantics unchanged.
3. Never rely on the frontend check alone: the backend guard is the invariant, the frontend
   check is the UX.

Rejected: keeping the delete but warning first. The upload failure is not the user's
decision point; their annotation work must simply survive it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/services/uploadManager.js` - cleanup DELETE at ~795-802 and the
  identical block at ~903-910; `ensureVideoInR2` ~478-619
- `src/backend/app/routers/games.py` - `_delete_game_cascade` ~1647-1691, `delete_game`
  ~1694-1712
- `src/backend/app/routers/games_upload.py` - upload prepare/finalize flow, pending_uploads
- `src/frontend/src/stores/gamesDataStore.js` - pending filter (context for what the user
  sees after the fix)

### Related Tasks
- Epic sibling T7480 (why uploads fail), T7490 (pending visibility + retry), T7500
  (zero-row UPDATE hardening)
- T1540 (annotate-during-upload design, the reason game_id exists before upload completes)
- T7360 (upload store rework, singular -> collection): touches uploadManager surface, queue
  behind or coordinate

### Technical Notes
- Persistence rules apply: the retained pending game is already-persisted state, no new
  reactive writes. The "keep, don't delete" decision happens inside the existing failure
  handler (a gesture-originated flow).
- Watch the retry-storm shape seen on prod: 3 attempts in 30 seconds for the same file, each
  creating a NEW game row. Deduplicating retries onto the same pending row (rather than
  create+delete per attempt) is in scope if it falls out naturally; a full retry redesign is
  T7490's problem.
- Test the race explicitly: clip committed between frontend content-check and cleanup
  DELETE must not lose the clip (backend guard catches it).

## Implementation

### Steps
1. [ ] Backend: add only-if-empty semantics for the cleanup delete; full cascade unchanged
       for user-gestured deletes; test both + the race
2. [ ] Frontend: uploadManager failure paths stop deleting games with content; leave
       pending + minimal user-visible failure state (toast at minimum until T7490)
3. [ ] Tests: backend (delete guard, race), frontend unit (failure path keeps game),
       relevant-set only
4. [ ] Verify on staging with a deliberately failed upload after annotating clips

## Acceptance Criteria

- [ ] A failed upload after annotating clips leaves games/raw_clips/working_clips/projects
      rows intact (verified in profile.sqlite, not just UI)
- [ ] A deliberate user delete of a game still cascades exactly as before
- [ ] The race (content committed mid-cleanup) cannot destroy work (backend-enforced)
- [ ] Tests pass; CI green
