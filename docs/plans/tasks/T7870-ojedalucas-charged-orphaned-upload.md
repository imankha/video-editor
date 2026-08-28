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
1. [x] Pin deploy timestamp vs deletion timestamp
2. [x] Read `user_action_log` timelines (read-only, live machine) + any server logs
3. [x] Name the deleting code path with evidence
4. [x] Fix (Verdict A, see below) with regression test — commit `40eca8f5`, branch
   `feature/T7870-ojedalucas-charged-orphaned-upload`, Branch CI green
5. [x] Dry-run heal proposal -> user sign-off -> apply -> verify in R2 + live DB
6. [x] Update T7610 segment addendum with the verdict

### Progress Log

**2026-08-28 — Forensics + verdict + fix:**

**Deploy timeline (fly releases --json + git merge commit timestamps):** prod ran v276
(deployed 2026-08-24T19:31:59Z) for the ENTIRE incident window — the next deploy (v277)
didn't land until 2026-08-27T06:52:50Z, almost 8 hours after the incident. T7470's guard
merged to master 2026-08-25T02:27:40Z (also T7490, T7500) — all inside the gap, never
reached prod before 22:04 UTC Aug 26.

**user_action_log (read-only fly ssh probe):** `game_created` (22:03:41), `annotation_completed`
x2 (22:05:17, 22:05:27), last activity 22:05:37. `games`/`game_videos`/`game_storage`
sqlite_sequence all show seq=1 with zero surviving rows — full cascade delete ran. No
`raw_clips` sqlite_sequence entry at all -> no clip was ever inserted (only watched video,
consistent with `annotation_completed`'s `viewed_duration > 0` semantics, not a saved clip).
PG: `credit_transactions` shows only the expected 2 rows (261 signup bonus, 262 the
`game_upload:1` debit); `game_storage_refs` empty (confirms `delete_ref` ran, not the sweep
scheduler); no `r2_grace_deletions` row for the object hash -> the orphaned 164MB object has
**no reclamation deadline**, safe to heal at leisure.

**Verdict A, confirmed with the expert agent (Opus) given the async-timing reasoning
involved:** the pre-T7470 code (running in prod for the whole incident window) had NO
content guard at all on `DELETE /api/games/{id}` — `uploadManager.js`'s failure catch block
called it unconditionally whenever a game_id existed. `activateGame()` succeeded server-side
(R2 validated, credits charged, status->ready) around 22:04:07-09, but some later step in the
SAME client-side try block (a lost response, a slow request, or the final `commit()` racing
the annotate screen's own writes — cannot be narrowed further, no surviving Aug-26 server logs)
threw, and the unconditional cleanup DELETE cascaded the whole game away.

**Not purely a "fix hadn't shipped" story — a live gap survived T7470 into current master:**
`_game_has_user_content` checks `raw_clips`/`viewed_duration` but never game `status`. A
client that misses `activateGame`'s 200 still runs the cleanup DELETE against a game the
server already validated and charged credits for — the content check can't catch it because,
at that instant, there IS no content yet (this is exactly what happened here: zero raw_clips
ever existed). **Fixed** (commit `40eca8f5`): `delete_game`'s `only_if_empty` branch now also
refuses when `status != PENDING` (200 no-op, `reason: 'activated'`); `uploadManager.js` tracks
an `activated` flag (set once `activateGame` or the `already_owned` dedup path succeeds) that
suppresses the cleanup call entirely as defense in depth. 8/8 backend + 25/25 frontend tests
green (2 new backend cases, 1 new frontend case pinning the exact ojedalucas shape).

**User-initiated delete (Verdict B) not fully excluded but low confidence (~20%, per expert):**
would require navigating to Projects, opening the tile menu, and confirming a two-tap delete
within an ~88-second window on a 3-minute-old account, with zero retry afterward
(`sqlite_sequence(games)=1` proves no second game was ever created). The cleanup-path
explanation matches the same bug class T7470 itself documents happening to another prod user
(bigajosue) that same week.

**Idempotency-key finding that shapes the heal decision:** `deduct_credits` keys on
`game_upload:{game_id}`. His consumed key is `game_upload:1`. Restoring game row id 1 costs
him nothing extra on re-activation (idempotent). If he instead re-uploads from scratch, the
new game becomes id 2 -> key `game_upload:2` -> **he would be charged 2 credits again** for
the same video. This asymmetry argues for restore-in-place over refund-and-let-him-reupload.

**2026-08-28 — Heal executed and verified:** user approved "restore game row in-place." Script
co-designed with the expert agent (safest strategy: insert `pending` rows matching real
`create_game` output, then invoke the actual `activate_game(1)` production code path so R2
validation + ffprobe backfill + ref-counting all run through real code, not hand-rolled SQL —
see full reasoning in the agent transcript). Dry-run then apply, both via
`fly ssh console -a reel-ballers-api -C "python3 -"` (stdin-piped, per the read-only-probe
recipe). Result, fully verified:
- `games` id=1 status=ready, `video_duration=225.113356s`, `512x1108 @ 30fps` (real ffprobe
  against the durable R2 object, not fabricated)
- `game_videos` id=1 restored; `game_storage` + PG `game_storage_refs` (id 38) recreated;
  `r2_grace_deletions` empty (no reclamation deadline, confirmed both before and after)
- R2 sync durable: db-version 20 -> 21, round-tripped and re-downloaded to confirm
- **Credit ledger unchanged**: `credit_transactions` still exactly 2 rows (261 signup bonus,
  262 the original `game_upload:1` debit), `credits.balance` 6 before and after —
  `activate_game`'s idempotent debit logged `applied=False (retry)`, proving no double charge
- Also fixed in the same pass: the stale schema comment at `database.py:1298` claiming
  single-video games have no `game_videos` rows (false since T82 — `create_game` always
  writes one) — this staleness is what made the restore's exact row shape ambiguous until the
  expert traced `create_game` directly.
- `feature/T7870-ojedalucas-charged-orphaned-upload` Branch CI: green.

## Acceptance Criteria

- [x] Deleting actor identified with evidence (code path + timestamp), written up here
- [x] Code bug confirmed (Verdict A) — fixed + regression tests (commit `40eca8f5`)
- [x] Account heal executed and verified: game 1 restored to `ready`, durable in R2, PG ref
      recreated, credit ledger provably unchanged
- [x] T7610 addendum updated for this user (see that task file)
