# T6350: move-to-profile half-applies — target keeps the reels, user is told "not moved"

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-08-02
**Found by:** T5810 step 4 (real-flow verification on staging), 2026-08-02

## Problem

`POST /api/downloads/move-to-profile` returned **503** with:

```json
{"detail":"Could not save to the cloud. Your reel was not moved. Please try again.",
 "code":"sync_failed","retryable":true}
```

**but the move had already committed to the target profile, durably.** Verified directly against
staging R2 (not just the API):

| Where | State after the "failed" move |
|---|---|
| Target profile `a243df17` in **R2** | `games=1`, `final_videos=2` — the reference game AND both reels |
| Source profile `9fa7378c` via API | still has reels 8 and 7 — nothing deleted |
| User-facing message | *"Your reel was not moved."* |

So the reels existed in **both** profiles, and the caller was told the operation did not happen.
The T4850 all-or-nothing contract is violated on this path, and the error message is actively
false — a user who believes it will retry and (once the sync succeeds) end up with the reel in the
target while the source copy also lingers, or will simply not know their library now has
duplicates.

**This is a failure-path bug, not a feature bug.** The T5800/T5810 logic itself was verified
CORRECT in the same run: one reference row for two reels from the same game (dedup),
`is_reference=true`, `source_profile_id`/`source_game_id` correct, `storage_expires_at=None`.
Everything the epic promised worked. What is broken is what happens when the sync step fails
partway.

## Why it happens (hypothesis to confirm)

T4850's phases: **target written + explicitly synced FIRST**
(`sync_db_to_r2_explicit(user_id, target_profile_id)`), **source deleted second under
`durable_sync`**. Since the target's rows are in R2, phase 1 completed and was durable. The 503
therefore came from the SOURCE-side durable sync in phase 2 — after the target was already
committed — and the handler reported the whole operation as failed without unwinding phase 1.

Order is not the bug (invariant 6b requires target-first, so a crash never orphans media). The bug
is that **a phase-2 failure has no compensating action and no honest message**.

## What to decide (design gate)

Pick ONE and make the message match reality:

1. **Compensate**: on phase-2 failure, delete the target rows just written and re-sync the target,
   returning to the pre-move state. Must itself be failure-tolerant (a failed compensation is the
   same class of bug one level down).
2. **Roll forward**: treat the target write as authoritative, retry/queue the source delete, and
   report *success with a pending cleanup* — never "not moved".
3. **Report honestly and stop**: keep both copies, tell the user the reel WAS copied to the target
   but the original could not be removed, and surface a retry that only re-runs the source delete
   (idempotent).

Option 3 is the smallest correct change and matches the project's "fail loudly, never lie about
state" stance; option 2 risks a silent divergence if the queued delete never runs. **The message
must never claim a state the DB contradicts.**

## Reproduction (exact, staging, 2026-08-02)

1. `POST /api/auth/dev-login` (X-Test-Mode) as `imankh@gmail.com` → profile `9fa7378c`, 35 reels
2. `POST /api/profiles {name, color, sport}` → new profile `a243df17`
3. `POST /api/downloads/move-to-profile {"video_ids":[8,7],"target_profile_id":"a243df17"}`
   with `X-Profile-ID: 9fa7378c` → **503 sync_failed**
4. `GET /api/games` + `GET /api/downloads` with `X-Profile-ID: a243df17` → 1 game, 2 reels
5. Direct R2 read of `staging/users/{uid}/profiles/a243df17/profile.sqlite` → `games=1`,
   `final_videos=2` (durable, not just a live-process artifact)

The target was a **brand-new profile** (created seconds earlier, `db-version=3`), while the source
is long-lived (`db-version=2698`) — worth testing whether a fresh target, or a busy source, is what
makes the phase-2 sync fail. Staging was restored by deleting the test profile.

## Context

### Relevant Files
- `src/backend/app/routers/downloads.py` — `move_reels_to_profile` (phases, error handling)
- `src/backend/app/database.py` — `sync_db_to_r2_explicit`, `SyncResult`
- `src/backend/app/middleware/db_sync.py` — `durable_sync` dependency
- `.claude/knowledge/persistence-sync.md` — invariant 6b, CAS/SyncResult semantics

### Related
- **T4850** established the phases + the all-or-nothing claim this violates
- **T5810** rides the existing phase-1 target write (it did not introduce this; the same hole
  existed for a plain reel move before attribution was carried)
- **T6340** — profile_db migrations could not reach R2 from staging; if R2 writes are still flaky
  there, that may be the trigger rather than a logic fault
- Memory `project_arshia_lost_reels_move_clobber` — moved reels losing rows is exactly the family
  of damage this path can cause

## Acceptance Criteria

- [ ] A phase-2 sync failure never leaves the reel readable in BOTH profiles with a "not moved" message
- [ ] The response text always matches the persisted state (verified by reading R2, not just the API)
- [ ] Chosen strategy (compensate / roll forward / honest report) is implemented and documented in
      persistence-sync.md
- [ ] Regression test forces a phase-2 sync failure (T4120's `FORCE_R2_SYNC_FAILURE` seam) and
      asserts the resulting state + message agree
- [ ] Re-run the staging reproduction above and confirm it no longer half-applies
