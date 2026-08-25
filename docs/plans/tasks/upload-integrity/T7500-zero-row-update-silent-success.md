# T7500: Write handlers report success on zero-row UPDATE (finish-annotation and siblings)

**Status:** WIP
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

- [x] finish-annotation on a missing game returns 404, records no milestone, logs a warning
- [x] Audit sweep completed; every fixed site has the rowcount guard; findings list in the
      progress log names each site checked
- [x] No user-facing error from the legitimate teardown-after-delete sequence
- [x] Tests pass; CI green

## Progress Log

### 2026-08-25 — Implementation (M tier)

**Primary fix** (`games.py` `finish_annotation`): added `if cursor.rowcount == 0` guard in
the `viewed_duration > 0` branch — logs a WARNING naming the game id, raises 404, and does
NOT call `record_milestone`. The `else` (no-progress) branch is untouched (nothing written).

**Audit sweep** — searched `app/routers/*.py` + `app/services/*.py` for every
`record_milestone(` / `record_achievement(` call site and traced each back to its preceding
write. `finish_annotation` was the ONLY unguarded write-then-side-effect-by-id case. Every
site checked:

| Site | Milestone | Preceding write | Verdict |
|------|-----------|-----------------|---------|
| games.py:1909 `finish_annotation` | annotation_completed | UPDATE games WHERE id (was unchecked) | **FIXED** — rowcount guard |
| games.py:455 | game_created | INSERT games (lastrowid) | OK — INSERT always creates |
| clips.py:1289 | clip_created | INSERT raw_clips (new-clip branch only; existing-clip UPDATE branch returns earlier with NO milestone) | OK — INSERT always creates |
| collections.py:1061 | collection_downloaded | SELECT members, 404 if none | OK — read, 404-guarded |
| collections.py:1595 | share_completed | create_collection_share (INSERT) | OK — INSERT |
| collections.py:1628 | invite_sent | after emails sent | OK — no by-id write |
| downloads.py:727 | video_downloaded | SELECT final_videos, 404 if not found | OK — read, 404-guarded |
| exports.py:453 | export_started | SELECT project 404 + create_export_job INSERT | OK — 404-guarded + INSERT |
| exports.py:247 | export_completed (recovered) | gated on `result['finalized']` | OK — gated on real finalize |
| quests.py:397 | quest_completed | `credit_ledger.grant` (atomic PG), gated on `result['applied']` | OK — gated |
| quests.py:446 | (via achievement) | INSERT OR IGNORE achievements | OK — INSERT |
| overlay.py:279/280 | export_completed/overlay_exported | internal finalize; final_videos row just INSERTed; UPDATE export_jobs by real processing job | OK — not a request silent-success path |
| export_worker.py:185/186/199 | export_completed/framing_exported/export_failed | background worker on a genuinely-processing job | OK — not a request path |
| credit_ledger.py:481 | credits_consumed | SELECT reservation, `return False` if absent, then DELETE+INSERT | OK — already SELECT-guarded (honest) |
| auth.py:507 | pwa_installed | none | OK — no preceding write |
| payments.py:281/282/350/386/529 | payment/credit milestones | Stripe-webhook-driven atomic ledger grants | OK — atomic PG grant, not by-id UPDATE |

**Sibling checked (not a milestone site):** `games.py:1913 save_playhead` — UPDATE games
WHERE id with NO side effect (pure beacon persist via `navigator.sendBeacon`, response not
consumed). Does not match the "+ side effect on a no-op write" pattern; returning success on
a deleted-game beacon is harmless and unreactable. Left unchanged (not a candidate).

No ambiguous/design-question sites found; nothing filed as a follow-up.

**Frontend tolerance** (`gamesDataStore.finishAnnotation`): a 404 is now swallowed quietly
(`console.debug`, early return); genuine (non-404) failures still `console.error`. `apiFetch`
is a bare `fetch` wrapper with NO generic error-toast, so no toast exception was needed.

**Tests:** `tests/test_t7500_finish_annotation_zero_row.py` (4: missing-game 404 + no
milestone via `record_milestone` spy; missing-game zero-duration still 200; happy path
milestone+persist; existing-game zero-duration no milestone) — all pass; `test_playhead_resume.py`
(7) re-run green as the corner regression. Frontend `gamesDataStore.test.js` +2 (404 swallowed
quietly; non-404 still errors) — 8/8 pass.
