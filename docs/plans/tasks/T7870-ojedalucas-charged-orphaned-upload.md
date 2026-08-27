# T7870: ojedalucas19 - upload succeeded, credits charged, game row deleted (investigate + heal)

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-08-27 (from the 2026-08-27 drop-off report refresh)

## Problem

The clearest single failure found in the 2026-08-27 drop-off refresh, and it happened
**the same day the Upload Failure Integrity epic deployed to prod (2026-08-26)** — so it is
either a hole in the T7470 `only_if_empty` guard, or an unguarded deletion path, or a
user-initiated delete with bad consequences (credits kept, bytes orphaned). All timestamps UTC:

| When (2026-08-26) | What | Evidence |
|---|---|---|
| 22:02:44 | Signup | `users` row, ojedalucas19@gmail.com, user `69b36823-9074-4990-9475-6231203ee02e`, profile `839cf767` |
| 22:03:40 | `game_created` milestone (count 1) | PG `user_actions` |
| 22:04:07 | **164,302,556-byte object lands durably in R2** | `games/6202cf901877d4a5e58f68f673144bb6799058b91a291c86a32d230a5aea8695.mp4`, still present 2026-08-27 |
| 22:04:09 | **2 credits debited** | `credit_transactions` id 262, `game_upload:1` |
| 22:05:17 | `annotation_completed` milestone (count 2) | PG `user_actions` — user did annotate-flow work AFTER the upload finished |
| 22:05:37 | Last activity ever | `user_segments.last_active_at`; 85 s total usage |
| now | Profile DB: `games=0, raw_clips=0`, `sqlite_sequence` shows games=1, game_storage=1 | live machine probe 2026-08-27 |

Net: the upload SUCCEEDED, the user paid credits and did work, and his account renders
completely empty. No `game_storage_refs` row exists (the 2026-08-27 backfill walks live
game rows, and his was deleted). He has not returned.

Why this is P1: it is the exact class the upload-integrity epic was built to close
(bigajosue: paid then lost everything), recurring possibly AFTER the fix was live.

## Solution

Investigate first, then heal; the fix depends on the verdict.

1. **Establish the deploy timeline.** Was the 2026-08-26 prod deploy before or after
   22:04 UTC? (`fly releases -a reel-ballers-api`, git merge timestamps.) If the deletion
   pre-dates the deploy, this is the old bug class and only the heal + refund questions remain.
2. **Forensics (read-only).** His per-user `user_action_log` (profile SQLite on the live
   machine, plus `user.sqlite`) holds the event-grain timeline — look for an explicit
   game-delete action vs an upload-failure cleanup. Server logs around 22:04-22:06 if retained
   (`fly logs` window is short; check the log tooling). Key question: which code path issued
   the DELETE — `uploadManager.js` failure handler (`?only_if_empty=true`) or the
   unconditional user-facing delete?
3. **Verdict A — a cleanup path deleted a game with user content / after success:**
   fix the path (the guard must refuse), add a regression test, heal the account.
4. **Verdict B — user deleted his own game:** no code deletion bug, but two follow-ups:
   (a) deleting a just-uploaded game keeps the 2-credit charge — decide refund policy
   (credits idempotency key `game_upload:1` would collide on re-upload of game id 1 —
   check `credits.py` behavior for re-grant); (b) check what the delete-confirmation UX
   showed him 90 seconds after his first-ever upload.
5. **Heal (gated on user sign-off, data-safety rule).** The 164 MB object is durable and
   healthy. Options: restore the `games` row pointing at the existing blake3 object
   (edit-user-db.py playbook / gated migration, v022 re-point precedent), or refund credits
   and let T7880 reclaim the object. User decides which.
6. **Feed T7610:** his outreach segment depends on the verdict (hold his email until this
   resolves — noted in T7610's addendum).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games.py` — `delete_game` (line ~1789), `_game_has_user_content`
- `src/frontend/src/services/uploadManager.js` — failure handlers calling `DELETE ...?only_if_empty=true`
- `src/backend/app/services/credits.py` (or equivalent) — `game_upload:{id}` idempotency on refund/re-charge
- `scripts/edit-user-db.py` — heal tool (dry-run default)
- Read-only probe recipe: memory `dropoff-refresh-2026-08-27` (fly ssh + python3 stdin)

### Related Tasks
- Follows: Upload Failure Integrity epic (T7470-T7500, DONE 2026-08-26)
- Blocks: T7610 send for this user; informs T7880 (fate of the orphaned object)

## Implementation

### Steps
1. [ ] Pin deploy timestamp vs deletion timestamp
2. [ ] Read `user_action_log` timelines (read-only, live machine) + any server logs
3. [ ] Name the deleting code path with evidence
4. [ ] Fix (if Verdict A) with regression test, or file the UX/refund follow-up (if Verdict B)
5. [ ] Dry-run heal proposal -> user sign-off -> apply -> verify in R2 + live DB
6. [ ] Update T7610 segment addendum with the verdict

## Acceptance Criteria

- [ ] Deleting actor identified with evidence (code path + timestamp), written up here
- [ ] If a code bug: fixed + regression test; if user-initiated: refund decision + UX finding recorded
- [ ] Account heal (or explicit decision not to) signed off by user and executed
- [ ] T7610 addendum updated for this user
