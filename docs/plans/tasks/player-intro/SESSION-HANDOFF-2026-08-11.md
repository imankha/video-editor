# Session handoff — 2026-08-11 ~02:00 UTC

**master @ `55aa9ed6`.** This session did two things: (1) wrote pre-testing documentation for the
2026-08-10 code freeze, then (2) live-QA'd the biggest risk areas via Playwright and found + is
fixing one real bug. Read this before doing anything else in a fresh session.

## What happened, in order

### 1. Code-freeze documentation (done, no action needed)

Two docs written covering everything merged to master since the last prod deploy
(`bce639d0`, 2026-08-03) — 279 commits / 52 task IDs, dominated by the Player Intro epic
(Athlete Intro Cards) and the Overlay text regions rewrite:

- [docs/testing/release-map-2026-08-10.md](../../../testing/release-map-2026-08-10.md) —
  functionality -> file/function map, 12 sections.
- [docs/testing/staging-verification-2026-08-10.md](../../../testing/staging-verification-2026-08-10.md) —
  steppable QA checklist (same format as the 2026-07-26 precedent doc), with a migration table
  (profile_db v034-v042 must run before testing anything Intro Card/Overlay-text related), a
  "known non-bugs" section (things deliberately removed by design — don't file them), and one
  flagged still-open landmine (T6550, poster-marker write path still unguarded).

Both are complete and don't need re-doing.

### 2. Live Playwright verification (done)

Drove the app locally as the real account `imankh@gmail.com` (dev-login, profile `9fa7378c`,
"Test Soccer Mehdi profile" — this account has a large library of real Athlete Intro Cards and
reels from prior QA sessions, reuse it for any follow-up testing). Full results:
[docs/testing/staging-verification-2026-08-10-RESULTS.md](../../../testing/staging-verification-2026-08-10-RESULTS.md).

**Landmine hit and resolved:** the local dev profile DB was stuck at schema `v34` (never
migrated past T5195's original table) — this produced a false-positive "subtitle doesn't
persist" finding before `POST /api/admin/migrate` was run to bring it to head (`v42`). **If you
spin up a fresh local dev environment, run the migrate endpoint before testing anything Intro
Card / Overlay-text related**, or you'll chase the same ghost.

**Confirmed real bug (the one thing left in flight — see below):** owner in-app playback
(T6710's composite scrubber) — clicking the "Intro" segment after playback has advanced into the
reel does nothing; you can't seek back to rewatch the intro card. Confirmed 3x, including a
synchronous in-page click + immediate DOM check that rules out "the intro just finished playing
again before I looked."

**Everything else checked came back PASS** — the two biggest changes in the release (Overlay
text multi-element regions T6630, card typography rewrite T6640) both held up thoroughly under
direct manipulation (add/toggle/delete elements, region creation via lane click, fact-toggling
with no layout collisions). Also PASS: card naming consistency, profile-driven title/facts
resolution, thumbnail marker click-no-op (T6560), tile hover preview graceful degradation.

## What's IN FLIGHT right now — pick this up first

**T6730** was filed for the confirmed bug and a `/dotask` container worker is running:

- Task file: [T6730-owner-playback-seek-back-to-intro-broken.md](T6730-owner-playback-seek-back-to-intro-broken.md)
- PLAN.md row added (status TODO -> the worker will move it as it progresses; check current
  status there first, it may already be STAGING or WAITING ON USER by the time you read this)
- Container: `reel-task-t6730`, checkout at `C:/work/tasks/t6730`, branch
  `feature/T6730-owner-playback-seek-back-broken`
- Kickoff file (what the worker was told): `C:\tmp\kickoff-t6730.md`
- Tier M, Opus, per `.claude/skills/dotask/SKILL.md` + `.claude/skills/spawn-worker/SKILL.md`
- **WAVE.md** at `C:/work/tasks/WAVE.md` has the manifest row for this task.

### Bootstrap in a fresh session

Follow the dotask skill's own cold-start procedure — do NOT re-read this conversation's history,
it's gone:

1. Read `C:/work/tasks/WAVE.md`
2. `docker ps --filter name=reel-task` — confirm `reel-task-t6730` is still alive
3. `tail -20 C:/work/tasks/t6730/.dotask-status` — read from the last `SPAWNED
   feature/T6730-owner-playback-seek-back-broken` line forward (the file has a lot of unrelated
   history above it from other tasks that reused this checkout lineage — ignore everything
   before that line)
4. Based on the last line for this task:
   - No `PUSHREADY`/`BLOCKED` yet, activity recent (<1h) -> the worker may still be running in a
     background shell; check if a `claude -p` process is still active in the container
     (`docker exec reel-task-t6730 ps aux`), otherwise resume with `claude -p -c` (session cache
     still warm)
   - No `PUSHREADY`/`BLOCKED`, activity stale (>1h) -> resume FRESH (not `-c`, the cache tax is
     real): `docker exec -u dev reel-task-t6730 bash -lc 'cd /workspace && claude -p --model opus
     "Read /workspace/.dotask-kickoff.md and /workspace/.dotask-status. Continue from the last
     STAGE_DONE line."'`
   - `BLOCKED <reason>` -> the worker hit a design question or was stuck; read the reason, decide,
     relay the answer back in via `-c` (if cache fresh) or a fresh-seed prompt
   - `PUSHREADY <branch> <sha>` -> the fix is done and committed but NOT pushed (workers never
     push). Sanity-check the diffstat
     (`docker exec -u dev reel-task-t6730 bash -lc 'cd /workspace && git diff origin/master --stat'`),
     then `bash scripts/task.sh push t6730`, then fetch the Branch CI verdict (commands in
     `.claude/skills/spawn-worker/SKILL.md` step 5) before telling the user it's ready to test.
     On green, delete the WAVE.md row for t6730 and tell the user which branch to pull/test/merge.
     On red, triage (fix / attribute to known-failures.md / file a follow-up task) before
     reporting.

### What the worker was asked to fix

Clicking the Intro segment on the composite scrubber (`CompositeScrubber.jsx` /
`IntroStoryPlayer.jsx` / `useIntroPlayback.js`, possibly `landingToken` in
`CollectionPlayer.jsx`) should seek playback back into the intro card's own animation. Currently
it's a no-op — the button has a real click handler (not the earlier, already-fixed z-index
issue) but the resulting seek has no observable effect. Full repro steps, candidate root-cause
lead, and acceptance criteria are in the task file. Real-browser verification is mandatory — this
exact surface has a documented history (in T6710's own task file) of bugs passing jsdom/unit
tests while failing live.

Repro account for re-verification: `imankh@gmail.com` / profile `9fa7378c`, reel "Brilliant
Control - From Air. Test Intro Image" under game "at Legends Mar 28" in My Reels.

## Landmines from this session

- **`browser_click` on a Playwright MCP element ref clicks at the element's bounding-box
  center** — when probing a bug like this, that's usually fine, but if you need to test a
  specific point within a wide element (e.g., a proportional-width scrubber segment), use
  `browser_evaluate` to dispatch a synthetic event at exact `clientX`/`clientY` instead.
- **Local dev-login (`POST /api/auth/dev-login`) sets a cookie in whatever context calls it** —
  a bare `curl` and the Playwright browser context are separate cookie jars. To authenticate the
  Playwright browser, `fetch()` the dev-login endpoint from inside the page itself via
  `browser_evaluate` with `credentials:'include'`, not via a separate curl call.
- **This local dev profile DB can silently drift behind schema head** — see the migration
  landmine above. Worth checking `PRAGMA user_version` on any profile DB before trusting a
  "doesn't persist" finding as real.
- Same shared-tree landmines as prior handoffs still apply (stale detached HEAD risk, explicit
  `git add <paths>` only, never `git add -A`) — see
  [SESSION-HANDOFF-2026-08-10-C.md](SESSION-HANDOFF-2026-08-10-C.md) for the fuller list, still
  current.

## Next

1. Land T6730 (push -> CI verdict -> user tests -> merge).
2. Nothing else from this session is queued. The two documentation docs and the results doc are
   done and don't need follow-up unless T6730's fix changes their content (it shouldn't — it's a
   pure bug fix, not a scope change).
3. Once T6730 is merged, this session's docs are fully reconciled and there's nothing left
   in flight from 2026-08-10/11's work.
