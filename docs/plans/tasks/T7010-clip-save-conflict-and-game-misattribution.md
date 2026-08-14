# T7010: Clip-save "couldn't save" error + both clips landed under the same game (needs better logging)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-14
**Updated:** 2026-08-14

## Problem

User report 2026-08-14 while live-testing on the T6820 container stack (localhost:5178,
backend :8005): creating the first clip produced a "couldn't save" error. Creating a second
clip (reportedly in a **different game**) succeeded — but both clips now show up as Not Started
drafts grouped under the **same** game, "Legends Mar 28" (screenshot: two tiles, "Brilliant
Dribble and Pass" and "Brilliant Dribble, Pass and Goal", both under one `at Legends Mar 28`
group). User asked this be investigated separately from the T6820 feature work, with backend
logs examined and a ticket filed to improve logging (the trail was hard to read after the fact).

## What the backend log confirms (`/tmp/backend.log` in `reel-task-t6820`, 04:11:21-04:11:33 UTC)

1. **The "couldn't save" error is a real CAS sync conflict, not a UI glitch:**
   ```
   PUT /api/clips/raw/131 (create_project=True)
   -> [CreateReel] creates auto-project 60 ("Brilliant Dribble and Pass"), clip updated
   -> [SYNC_CONFLICT] loaded=v2954 r2=v2965 reason=stale_baseline -- NOT uploading
   -> PUT /api/clips/raw/131 -> 503
   ```
   R2 was **11 versions ahead** of this container's local baseline at the moment of the write.
2. **Automatic retry triggered a full profile-DB re-heal**, which re-ran the same request from
   scratch on the freshly-downloaded v2965 database:
   ```
   PUT /api/clips/raw/131 (retry) -> [SYNC_CONFLICT] reason=unconfirmed_baseline
   -> [Restore] downloading fresh DB from R2 (version 2965)
   -> [CreateReel] update_raw_clip called AGAIN for clip_id=131 (re-run against the healed DB)
   -> PUT /api/clips/raw/131 -> 200
   ```
3. **Root cause of the version jump: known multi-container collision.** This session was
   running 4-5 `/dotask` container stacks simultaneously (t4945, t6890, t6990, t6820, t6980),
   several performing their own live QA against the same real dev account/profile — matching
   the already-documented pattern in
   [[project_container_ports_r2_cors]]: *"multi-container QA on ONE dev account causes
   recurring `stale_baseline` CAS freezes — each container's backend advances R2 versions
   behind the others' backs."* This is very likely the trigger here, not a new defect in the
   sync primitive itself.
4. **`update_raw_clip` reads `game_id` straight from the `raw_clips` row** (`clips.py:1178`,
   `rc.game_id` via a plain `SELECT ... WHERE rc.id = ?`) — it does not take a game_id from the
   request or any frontend-supplied "current game" context. Both clip 131 and clip 134 show
   `game_id=6` in the log at the moment `update_raw_clip` read them, meaning **either the two
   raw clips already had the same `game_id` before this endpoint ever ran (assigned upstream at
   raw-clip creation, `POST /clips/raw/save` — not audited in this pass), or the user's
   navigation between "two games" didn't actually leave game 6's Annotate context** despite
   appearing to. **Not yet distinguished — this is the open question for whoever picks this
   up.**

## Two hypotheses (unconfirmed, need investigation)

- **A — Pre-existing data:** both raw clips were extracted from game 6 to begin with (the user's
  recollection of "2 separate games" doesn't match `game_id`); nothing to fix beyond the sync
  conflict itself. Check by inspecting `raw_clips.game_id` for clips 131/134 directly and
  correlating with what game the Annotate URL/route actually pointed at when each clip was
  captured (need frontend nav logs — see logging ask below, they don't exist today).
- **B — Real bug:** the "couldn't save" error + retry/heal cycle left the frontend's active-game
  context stale (e.g., a route param, cached game object, or in-memory "current game" store slot
  that a full recovery reload doesn't refresh), so a clip captured against what the UI displayed
  as "a different game" was actually saved with the old game's id. This would be a new instance
  of the T4060/T1670-class "screen doesn't reinitialize context on navigation" bug family — check
  whether the recovery path (503 -> retry -> DB re-heal) intersects any of the Annotate screen's
  game-load effects.

## Logging ask (explicit user request)

The trail above only reconstructs cleanly because of `req_id` correlation across scattered log
lines — there is no single log line that would have let a human immediately see "clip 134 was
saved under game 6 while the UI showed game X." Add:
- A log line at clip-save time that includes **which game the frontend's route/state believed it
  was in** (not just what the backend read from the DB row) — even a simple query param or
  header carrying the frontend's active game id, logged alongside the backend's `rc.game_id`,
  would make a future mismatch instantly visible instead of requiring DB archaeology.
- A CRITICAL-level (not just INFO) log line whenever a mid-request DB heal (`[Restore] First
  access...downloading fresh DB from R2`) occurs **while a write was in flight**, naming exactly
  what in-progress work (e.g., "auto-project 60 creation") was discarded/re-run as a result —
  today this is inferable only by manually correlating `[CreateReel]` lines before and after the
  `[Restore]` line.

## Context

### Relevant Files
- `src/backend/app/routers/clips.py` — `update_raw_clip` (~line 1155), reads `game_id`
- `src/backend/app/routers/clips.py` — raw clip creation, `POST /clips/raw/save` (not yet
  audited this pass — start here for Hypothesis A/B)
- `.claude/knowledge/persistence-sync.md` — CAS/`SYNC_CONFLICT`/`stale_baseline` mechanics
- `.claude/knowledge/annotate.md` — Annotate screen game-load/navigation effects (Hypothesis B)
- Memory: [[project_container_ports_r2_cors]] (multi-container collision precedent)

### Technical Notes
- This was observed on a `/dotask` container stack with several sibling containers live at the
  same time — reproducing on a normal single-stack dev session (no concurrent containers) would
  help confirm/rule out Hypothesis A vs. a genuine frontend bug independent of the sync
  collision.
- Not urgent/blocking — the save DID eventually succeed (200 on retry) and no data was lost;
  this is a data-correctness + diagnosability investigation, not an active outage.

## Acceptance Criteria
- [ ] Confirm whether raw clips 131/134 (or their equivalents on a fresh repro) genuinely share
      one `game_id` at creation time, or whether the frontend's active-game context went stale
      after the save-error/retry/heal cycle
- [ ] If Hypothesis B (real bug): fix the stale-context path so a clip always saves against the
      game the user was actually looking at
- [ ] Logging: frontend-believed game id logged alongside backend-read game id at clip-save time
- [ ] Logging: mid-request DB heal logs CRITICAL with the specific in-flight work it discarded
- [ ] Tests pass
