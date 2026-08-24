# T7500: Write handlers report success on zero-row UPDATE (finish-annotation and siblings)

**Status:** TODO
**Priority:** P1 (member of the P1 epic; smallest child)
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-24
**Updated:** 2026-08-24
**Epic:** [Upload Failure Integrity](EPIC.md)

## Problem

`POST /api/games/{id}/finish-annotation` (`games.py` ~1830-1858) runs
`UPDATE games SET viewed_duration = ... WHERE id = ?` without checking `cursor.rowcount`.
When the row does not exist, the handler still returns `{"success": true}` and still calls
`record_milestone("annotation_completed")`.

Proven consequence on prod (2026-08-24 investigation, bigajosue@gmail.com): the upload
failure handler cascade-deleted game 4 (see T7470), then the annotate view's teardown fired
4 finish-annotation calls against the deleted row. All four "succeeded" and recorded
`annotation_completed` milestones, manufacturing the false activity trail that made the
admin dashboard show a busy user whose account was actually empty. This is a live violation
of the "no silent fallbacks for internal data" coding rule: an impossible state (finishing
annotation on a nonexistent game) was absorbed silently instead of failing visibly.

## Solution

1. `finish_annotation`: check `cursor.rowcount`; zero rows -> 404, no milestone, log a
   warning naming the game id (a deleted-row write is always a bug trail worth seeing).
2. **Audit sweep**: grep the backend for the same pattern (UPDATE/DELETE by id followed by
   unconditional success + side effects, especially `record_milestone` /
   `record_achievement` calls). Fix each site the same way: rowcount check, honest error,
   no side effects on a zero-row write. Keep the sweep mechanical; anything that turns out
   to be a design question gets filed, not improvised.
3. Frontend callers of finish-annotation must tolerate the new 404 gracefully (the teardown
   fires it after a delete; a 404 there is correct and should be swallowed quietly by the
   caller with a debug log, not a user-facing error toast, since the game is already gone
   by user/cleanup action).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games.py` - `finish_annotation` ~1830-1858 (milestone at ~1850)
- Sweep scope: `src/backend/app/routers/*.py` for the pattern (exact file list comes out of
  the audit step)
- Frontend caller(s) of finish-annotation (annotate teardown path, likely
  `useAnnotate.js` / AnnotateScreen container)

### Related Tasks
- Epic siblings T7470 (the deletion that exposed this), T7480, T7490
- T7510 (attempted-vs-successful analytics): this task stops FALSE success events at the
  source; T7510 redefines what events mean. Complementary, not overlapping.

### Technical Notes
- Coding standards: "No silent fallbacks for internal data" and "Invalid state should log
  and fail visibly, never self-repair silently." This task is a direct application.
- Do NOT add defensive existence-checks before every write; the rowcount check on the write
  itself is the correct, race-free form.
- Milestone recording must remain tied to a write that actually happened; that is the
  invariant the sweep enforces.

## Implementation

### Steps
1. [ ] Fix `finish_annotation` (rowcount check, 404, no milestone, warning log)
2. [ ] Audit sweep for sibling patterns; fix mechanical cases, file design questions
3. [ ] Frontend: tolerate 404 from finish-annotation quietly
4. [ ] Tests: zero-row finish-annotation returns 404 and records nothing; happy path
       unchanged; relevant set only

## Acceptance Criteria

- [ ] finish-annotation on a missing game returns 404, records no milestone, logs a warning
- [ ] Audit sweep completed; every fixed site has the rowcount guard; findings list in the
      progress log names each site checked
- [ ] No user-facing error from the legitimate teardown-after-delete sequence
- [ ] Tests pass; CI green
